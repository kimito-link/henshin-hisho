import { accountTokenForEmail } from '../../shared/account-token.js';
import { applyMergedPlan, withSource } from '../../shared/entitlement.js';
import { playAccessTokenFromEnv } from '../../shared/play-auth.js';
import { assessPlaySubscription, playSubscriptionV2Url } from '../../shared/play-catalog.js';
import { PLAY_PACKAGE_NAME, planById } from '../../shared/plans.js';
import { appleTrustFromEnv, assessAppleTransaction, verifyAppleJws } from '../../shared/store-jws.js';
import { createCheckoutSession } from '../../chatgpt-app/src/billing.js';
import { accountPlan, applySharedEntitlement } from './auth.js';
import { nowSeconds } from './crypto.js';
import { getUser, putUser } from './kv.js';

function timingSafeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

async function pushToChatgpt(env, email, entitlement) {
  if (!env.CHATGPT_APP_URL || !env.INTERNAL_ENTITLEMENT_TOKEN) return { ok: false, skipped: true };
  const fetchImpl = env.ENTITLEMENT_FETCH || fetch;
  try {
    const response = await fetchImpl(`${String(env.CHATGPT_APP_URL).replace(/\/$/, '')}/internal/entitlement`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.INTERNAL_ENTITLEMENT_TOKEN}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ email, entitlement })
    });
    return { ok: response.ok };
  } catch {
    return { ok: false, reason: 'chatgpt_unreachable' };
  }
}

async function saveUserEntitlement(env, user, sourceName, source) {
  const entitlementRecord = applyMergedPlan(
    withSource(user.entitlementRecord || { email: user.email, trialEndsAt: user.trialEndsAt || 0 }, sourceName, source)
  );
  const updated = {
    ...user,
    plan: entitlementRecord.plan,
    licenseCurrentPeriodEnd: entitlementRecord.currentPeriodEnd,
    entitlementRecord,
    updatedAt: nowSeconds()
  };
  await putUser(env, updated);
  await pushToChatgpt(env, user.email, entitlementRecord);
  return { ok: true, account: accountPlan(updated), accountToken: await accountTokenForEmail(user.email) };
}

export async function checkoutForUser(env, user, planId) {
  const plan = planById(planId || 'monthly');
  const origin = String(env.APP_BASE_URL || 'https://henshin-hisho.link/app/').replace(/\/app\/?$/, '');
  const session = await createCheckoutSession(env, { email: user.email, origin, planId: plan.id, fetchImpl: env.STRIPE_FETCH || fetch });
  if (!session.ok) return { status: session.status || 503, body: { ok: false, reason: session.reason } };
  return { status: 200, body: { ok: true, url: session.url, planId: plan.id } };
}

export async function verifyAppleForUser(env, user, signedTransaction) {
  const trust = appleTrustFromEnv(env);
  if (!trust && !String(signedTransaction || '').includes('.')) {
    return { status: 503, body: { ok: false, reason: 'apple_not_configured' } };
  }
  const verified = await verifyAppleJws(signedTransaction, trust ? { publicJwk: trust } : {});
  if (!verified.ok) return { status: 400, body: verified };
  const assessed = assessAppleTransaction(verified.payload);
  if (!assessed.ok) return { status: 400, body: assessed };
  const accountToken = await accountTokenForEmail(user.email);
  if (assessed.accountToken && assessed.accountToken !== accountToken) {
    return { status: 400, body: { ok: false, reason: 'account_mismatch' } };
  }
  const saved = await saveUserEntitlement(env, user, 'apple', assessed);
  return { status: 200, body: saved };
}

export async function verifyGoogleForUser(env, user, purchaseToken) {
  let body = null;
  if (env.PLAY_FETCH) body = await env.PLAY_FETCH(purchaseToken);
  else {
    const token = await playAccessTokenFromEnv(env);
    if (token) {
      const http = env.PLAY_HTTP_FETCH || fetch;
      const response = await http(playSubscriptionV2Url(env.PLAY_PACKAGE_NAME || PLAY_PACKAGE_NAME, purchaseToken), {
        headers: { authorization: `Bearer ${token}` }
      });
      if (response.ok) body = await response.json().catch(() => null);
    }
  }
  if (!body) return { status: 503, body: { ok: false, reason: 'play_not_verified' } };
  const assessed = assessPlaySubscription({ ...body, purchaseToken });
  const accountToken = await accountTokenForEmail(user.email);
  if (assessed.accountToken && assessed.accountToken !== accountToken) {
    return { status: 400, body: { ok: false, reason: 'account_mismatch' } };
  }
  const saved = await saveUserEntitlement(env, user, 'google', assessed);
  return { status: 200, body: saved };
}

export async function refreshEntitlement(env, user) {
  if (!env.CHATGPT_APP_URL || !env.INTERNAL_ENTITLEMENT_TOKEN) {
    return { status: 200, body: { ok: true, account: accountPlan(user), synced: false } };
  }
  const fetchImpl = env.ENTITLEMENT_FETCH || fetch;
  const response = await fetchImpl(
    `${String(env.CHATGPT_APP_URL).replace(/\/$/, '')}/internal/entitlement?email=${encodeURIComponent(user.email)}`,
    { headers: { authorization: `Bearer ${env.INTERNAL_ENTITLEMENT_TOKEN}` } }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.entitlement) {
    return { status: 200, body: { ok: true, account: accountPlan(user), synced: false } };
  }
  const applied = await applySharedEntitlement(env, { email: user.email, entitlement: payload.entitlement });
  const fresh = await getUser(env, user.id);
  return { status: applied.status, body: { ok: applied.ok, account: accountPlan(fresh || user), synced: true } };
}

export async function storeAccountForUser(user) {
  return { ok: true, accountToken: await accountTokenForEmail(user.email) };
}

export function internalTokenOk(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return Boolean(env.INTERNAL_ENTITLEMENT_TOKEN) && timingSafeEqual(token, env.INTERNAL_ENTITLEMENT_TOKEN);
}
