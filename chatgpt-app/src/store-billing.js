import { accountTokenForEmail } from '../../shared/account-token.js';
import { playAccessTokenFromEnv } from '../../shared/play-auth.js';
import { assessPlaySubscription, playSubscriptionV2Url } from '../../shared/play-catalog.js';
import { PLAY_PACKAGE_NAME } from '../../shared/plans.js';
import { appleTrustFromEnv, assessAppleTransaction, verifyAppleJws } from '../../shared/store-jws.js';
import { upsertEntitlementSource } from './billing.js';
import { normalizeEmail, timingSafeEqual } from './http.js';

function storeWebhookAuthorized(request, env) {
  if (!env.STORE_WEBHOOK_TOKEN) return false;
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || request.headers.get('x-store-webhook-token') || '';
  return timingSafeEqual(token, env.STORE_WEBHOOK_TOKEN);
}

async function emailForAccountToken(env, token) {
  if (!token || !env.CHATGPT_KV) return '';
  return normalizeEmail(await env.CHATGPT_KV.get(`store-account:${token}`));
}

export async function rememberStoreAccount(env, email) {
  const normalized = normalizeEmail(email);
  if (!normalized || !env.CHATGPT_KV) return { ok: false, reason: 'invalid_email' };
  const accountToken = await accountTokenForEmail(normalized);
  await env.CHATGPT_KV.put(`store-account:${accountToken}`, normalized);
  return { ok: true, email: normalized, accountToken };
}

async function grantStoreSource(env, email, sourceName, assessed, nowMs) {
  return upsertEntitlementSource(
    env,
    email,
    sourceName,
    {
      active: assessed.active,
      currentPeriodEnd: assessed.currentPeriodEnd,
      productId: assessed.productId,
      planId: assessed.planId
    },
    nowMs
  );
}

export async function applyAppleNotification(env, body, nowMs = Date.now()) {
  if (!env.CHATGPT_KV) return { ok: false, reason: 'storage_not_configured' };
  const trust = appleTrustFromEnv(env);
  const outer = await verifyAppleJws(body?.signedPayload, trust ? { publicJwk: trust } : {});
  if (!outer.ok) return outer;
  const note = outer.payload || {};
  const bundleId = note.data?.bundleId;
  if (bundleId && bundleId !== 'jp.besttrust.henshinhisho') return { ok: false, reason: 'bundle_mismatch' };
  const signedTransaction = note.data?.signedTransactionInfo;
  if (!signedTransaction) return { ok: true, ignored: true };
  const transaction = await verifyAppleJws(signedTransaction, trust ? { publicJwk: trust } : {});
  if (!transaction.ok) return transaction;
  const assessed = assessAppleTransaction(transaction.payload, nowMs);
  if (!assessed.ok) return assessed;
  const email =
    (await emailForAccountToken(env, assessed.accountToken)) ||
    normalizeEmail(await env.CHATGPT_KV.get(`apple-original:${assessed.originalTransactionId}`));
  if (!email) {
    await env.CHATGPT_KV.put(`apple-pending:${assessed.originalTransactionId}`, JSON.stringify(assessed));
    return { ok: true, pending: true };
  }
  if (assessed.originalTransactionId) {
    await env.CHATGPT_KV.put(`apple-original:${assessed.originalTransactionId}`, email);
  }
  const saved = await grantStoreSource(env, email, 'apple', assessed, nowMs);
  return { ok: saved.ok, email, plan: saved.record?.plan || '' };
}

export async function applyAppleTransaction(env, { email, signedTransaction }, nowMs = Date.now()) {
  const remembered = await rememberStoreAccount(env, email);
  if (!remembered.ok) return remembered;
  const trust = appleTrustFromEnv(env);
  const verified = await verifyAppleJws(signedTransaction, trust ? { publicJwk: trust } : {});
  if (!verified.ok) return verified;
  const assessed = assessAppleTransaction(verified.payload, nowMs);
  if (!assessed.ok) return assessed;
  if (assessed.accountToken && assessed.accountToken !== remembered.accountToken) {
    return { ok: false, reason: 'account_mismatch' };
  }
  if (assessed.originalTransactionId) {
    await env.CHATGPT_KV.put(`apple-original:${assessed.originalTransactionId}`, remembered.email);
  }
  return grantStoreSource(env, remembered.email, 'apple', assessed, nowMs);
}

async function fetchPlaySubscription(env, purchaseToken) {
  if (env.PLAY_FETCH) return env.PLAY_FETCH(purchaseToken);
  const token = await playAccessTokenFromEnv(env);
  if (!token) return null;
  const http = env.PLAY_HTTP_FETCH || fetch;
  const response = await http(playSubscriptionV2Url(env.PLAY_PACKAGE_NAME || PLAY_PACKAGE_NAME, purchaseToken), {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

export async function applyGooglePurchase(env, { email, purchaseToken, subscription }, nowMs = Date.now()) {
  const remembered = await rememberStoreAccount(env, email);
  if (!remembered.ok) return remembered;
  const body = subscription || (await fetchPlaySubscription(env, purchaseToken));
  if (!body) return { ok: false, reason: 'play_not_verified' };
  const assessed = assessPlaySubscription({ ...body, purchaseToken }, nowMs);
  if (assessed.accountToken && assessed.accountToken !== remembered.accountToken) {
    return { ok: false, reason: 'account_mismatch' };
  }
  if (purchaseToken) await env.CHATGPT_KV.put(`play-token:${purchaseToken}`, remembered.email);
  return grantStoreSource(env, remembered.email, 'google', assessed, nowMs);
}

export async function applyGoogleNotification(env, body, nowMs = Date.now()) {
  if (!env.CHATGPT_KV) return { ok: false, reason: 'storage_not_configured' };
  let decoded = body;
  if (body?.message?.data) {
    try {
      decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.message.data), (char) => char.charCodeAt(0))));
    } catch {
      return { ok: false, reason: 'invalid_event' };
    }
  }
  const note = decoded.subscriptionNotification || {};
  const purchaseToken = note.purchaseToken || '';
  if (!purchaseToken) return { ok: true, ignored: true };
  const subscription = await fetchPlaySubscription(env, purchaseToken);
  if (!subscription) return { ok: false, reason: 'play_not_verified' };
  const assessed = assessPlaySubscription({ ...subscription, purchaseToken }, nowMs);
  const email =
    (await emailForAccountToken(env, assessed.accountToken)) ||
    normalizeEmail(await env.CHATGPT_KV.get(`play-token:${purchaseToken}`));
  if (!email) {
    await env.CHATGPT_KV.put(`play-pending:${purchaseToken}`, JSON.stringify(assessed));
    return { ok: true, pending: true };
  }
  await env.CHATGPT_KV.put(`play-token:${purchaseToken}`, email);
  const saved = await grantStoreSource(env, email, 'google', assessed, nowMs);
  return { ok: saved.ok, email, plan: saved.record?.plan || '' };
}

export async function handleStoreBillingRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/billing/apple/notifications' && request.method === 'POST') {
    if (!storeWebhookAuthorized(request, env)) return json({ ok: false, reason: 'invalid_signature' }, 401);
    const body = await request.json().catch(() => null);
    const result = await applyAppleNotification(env, body);
    return json(result, result.ok ? 200 : 400);
  }
  if (url.pathname === '/billing/google/notifications' && request.method === 'POST') {
    if (!storeWebhookAuthorized(request, env)) return json({ ok: false, reason: 'invalid_signature' }, 401);
    const body = await request.json().catch(() => null);
    const result = await applyGoogleNotification(env, body);
    return json(result, result.ok ? 200 : 400);
  }
  if (url.pathname === '/internal/entitlement' && request.method === 'GET') {
    return readInternalEntitlement(request, env);
  }
  if (url.pathname === '/internal/entitlement' && request.method === 'POST') {
    return writeInternalEntitlement(request, env);
  }
  return null;
}

function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function internalAuthorized(request, env) {
  return Boolean(env.INTERNAL_ENTITLEMENT_TOKEN) && timingSafeEqual(bearerToken(request), env.INTERNAL_ENTITLEMENT_TOKEN);
}

async function readInternalEntitlement(request, env) {
  if (!internalAuthorized(request, env)) return json({ ok: false, reason: 'unauthorized' }, 401);
  const email = normalizeEmail(new URL(request.url).searchParams.get('email'));
  if (!email || !env.CHATGPT_KV) return json({ ok: false, reason: 'invalid_email' }, 400);
  const raw = await env.CHATGPT_KV.get(`entitlement:${email}`);
  return json({ ok: true, email, entitlement: raw ? JSON.parse(raw) : null });
}

async function writeInternalEntitlement(request, env) {
  if (!internalAuthorized(request, env)) return json({ ok: false, reason: 'unauthorized' }, 401);
  const body = await request.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  if (!email || !env.CHATGPT_KV || !body?.entitlement) return json({ ok: false, reason: 'invalid_email' }, 400);
  const record = { ...body.entitlement, email };
  await env.CHATGPT_KV.put(`entitlement:${email}`, JSON.stringify(record));
  await rememberStoreAccount(env, email);
  return json({ ok: true, email, plan: record.plan || '' });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
