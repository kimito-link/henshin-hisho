import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.js';
import { applyAppleNotification, applyGoogleNotification, applyGooglePurchase } from '../src/store-billing.js';
import { mintPlayAccessToken } from '../../shared/play-auth.js';
import { accountTokenForEmail } from '../../shared/account-token.js';
import { mergeEntitlement } from '../../shared/entitlement.js';
import { APPLE_ROOT_CA_G3_SHA256, PATENT_FOOTER } from '../../shared/plans.js';
import { ecJwkFromCert, sha256Hex } from '../../shared/store-jws.js';
import { applyStripeEvent, billingView } from '../src/billing.js';
import { PATENT_LABEL } from '../src/reply.js';
import { createMemoryKv } from './helpers.js';

const root = dirname(fileURLToPath(import.meta.url));
let pass = 0;
let fail = 0;

async function test(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    fail += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

function signer() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  function sign(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const input = `${header}.${body}`;
    const signature = createSign('SHA256').update(input).sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });
    return `${input}.${signature.toString('base64url')}`;
  }
  return { jwk, sign };
}

await test('料金の正本と特許表示が同じ', async () => {
  assert.equal(PATENT_FOOTER, PATENT_LABEL);
  assert.equal(PATENT_FOOTER.includes('22026'), false);
});

await test('Apple Root CA G3 の指紋が公開値と一致する', async () => {
  const der = readFileSync(join(root, 'fixtures/AppleRootCA-G3.cer'));
  assert.equal(await sha256Hex(der), APPLE_ROOT_CA_G3_SHA256);
  const cert = new X509Certificate(der);
  assert.equal(cert.verify(cert.publicKey), true);
  assert.equal(ecJwkFromCert(der)?.crv, 'P-384');
});

await test('Stripe が切れても Apple が有効なら契約は開いたまま', async () => {
  const now = Date.parse('2026-10-28T00:00:00Z');
  const merged = mergeEntitlement({
    email: 'owner@example.com',
    trialEndsAt: 0,
    sources: {
      stripe: { active: false, currentPeriodEnd: 1 },
      apple: { active: true, currentPeriodEnd: Math.floor(now / 1000) + 86400 }
    }
  }, now);
  assert.equal(merged.plan, 'active');
  assert.equal(merged.unlocked, true);
  const none = mergeEntitlement({
    sources: {
      stripe: { active: false, currentPeriodEnd: 1 },
      google: { active: false, currentPeriodEnd: 1 }
    }
  }, now);
  assert.equal(none.plan, 'expired');
});

await test('署名が違う Apple 通知は契約を変えない', async () => {
  const keys = signer();
  const env = {
    CHATGPT_KV: createMemoryKv(),
    STORE_WEBHOOK_TOKEN: 'hook-token',
    APPLE_IAP_TRUST_JWK: JSON.stringify(keys.jwk)
  };
  const bad = await applyAppleNotification(env, { signedPayload: 'a.b.c' });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'bad_signature');
  assert.equal(env.CHATGPT_KV.store.size, 0);
});

await test('Apple と Google の通知が同じメールアドレスの契約を更新する', async () => {
  const keys = signer();
  const email = 'owner@example.com';
  const accountToken = await accountTokenForEmail(email);
  const env = {
    CHATGPT_KV: createMemoryKv(),
    STORE_WEBHOOK_TOKEN: 'hook-token',
    APPLE_IAP_TRUST_JWK: JSON.stringify(keys.jwk)
  };
  await env.CHATGPT_KV.put(`store-account:${accountToken}`, email);
  const now = Date.parse('2026-10-28T00:00:00Z');
  const transaction = keys.sign({
    productId: 'jp.besttrust.henshinhisho.monthly',
    bundleId: 'jp.besttrust.henshinhisho',
    expiresDate: now + 10 * 86400000,
    originalTransactionId: 'orig-1',
    appAccountToken: accountToken
  });
  const signedPayload = keys.sign({
    notificationType: 'SUBSCRIBED',
    data: { bundleId: 'jp.besttrust.henshinhisho', signedTransactionInfo: transaction }
  });
  const apple = await applyAppleNotification(env, { signedPayload }, now);
  assert.equal(apple.ok, true);
  assert.equal((await billingView(env, email, now)).plan, 'active');

  await applyStripeEvent(env, {
    type: 'checkout.session.completed',
    data: { object: { metadata: { email }, customer: 'cus_both' } }
  }, now);
  await applyStripeEvent(env, {
    type: 'customer.subscription.deleted',
    data: { object: { customer: 'cus_both', status: 'canceled' } }
  }, now);
  assert.equal((await billingView(env, email, now)).plan, 'active');

  env.PLAY_FETCH = async () => ({
    subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED',
    externalAccountIdentifiers: { obfuscatedExternalAccountId: accountToken },
    lineItems: [{
      productId: 'henshin_hisho',
      expiryTime: '2020-01-01T00:00:00Z',
      offerDetails: { basePlanId: 'monthly' }
    }]
  });
  const google = await applyGoogleNotification(env, {
    message: {
      data: Buffer.from(JSON.stringify({
        packageName: 'jp.besttrust.henshinhisho',
        subscriptionNotification: { notificationType: 13, purchaseToken: 'token-1', subscriptionId: 'henshin_hisho' }
      })).toString('base64')
    }
  }, now);
  assert.equal(google.ok, true);
  assert.equal((await billingView(env, email, now)).plan, 'active');
});

await test('Play のサービスアカウントから確認用トークンを作る', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  let assertion = '';
  const token = await mintPlayAccessToken(
    JSON.stringify({ client_email: 'play@example.iam.gserviceaccount.com', private_key: pem }),
    {
      fetchImpl: async (_url, init) => {
        assertion = new URLSearchParams(init.body).get('assertion') || '';
        return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 });
      }
    }
  );
  assert.equal(token, 'ya29.test');
  const header = JSON.parse(Buffer.from(assertion.split('.')[0], 'base64url').toString());
  assert.equal(header.alg, 'RS256');
});

await test('サービスアカウントのトークンで Play の購読を確認する', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const email = 'owner@example.com';
  const accountToken = await accountTokenForEmail(email);
  const now = Date.parse('2026-10-28T00:00:00Z');
  const env = {
    CHATGPT_KV: createMemoryKv(),
    GOOGLE_PLAY_SA_JSON: JSON.stringify({ client_email: 'play@example.iam.gserviceaccount.com', private_key: pem }),
    PLAY_TOKEN_FETCH: async () => new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 }),
    PLAY_HTTP_FETCH: async (_url, init) => {
      assert.equal(init.headers.authorization, 'Bearer ya29.test');
      return new Response(JSON.stringify({
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        externalAccountIdentifiers: { obfuscatedExternalAccountId: accountToken },
        lineItems: [{
          productId: 'henshin_hisho',
          expiryTime: '2026-11-28T00:00:00Z',
          offerDetails: { basePlanId: 'monthly' }
        }]
      }));
    }
  };
  const result = await applyGooglePurchase(env, { email, purchaseToken: 'token-sa' }, now);
  assert.equal(result.ok, true);
  assert.equal((await billingView(env, email, now)).plan, 'active');
});

await test('ストア通知の入口はトークンが違うと受け取らない', async () => {
  const env = { CHATGPT_KV: createMemoryKv(), STORE_WEBHOOK_TOKEN: 'hook-token' };
  const response = await worker.fetch(new Request('https://reply.kimitotalk.link/billing/apple/notifications?token=nope', {
    method: 'POST',
    body: '{}'
  }), env);
  assert.equal(response.status, 401);
});

if (fail > 0) {
  console.error(`${fail} failed`);
  process.exit(1);
}
console.log(`${pass} passed`);
