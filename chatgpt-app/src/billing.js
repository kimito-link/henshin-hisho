import { applyMergedPlan, mergeEntitlement, withSource } from '../../shared/entitlement.js';
import { ANNUAL_YEN, planById, PRICE_YEN, TRIAL_DAYS } from '../../shared/plans.js';
import { normalizeEmail, timingSafeEqual, validDeskId } from './http.js';

export { ANNUAL_YEN, PRICE_YEN, TRIAL_DAYS };

/**
 * アプリの無料枠・有料回数は、LLM を呼ぶかどうかの入口だけを見る。
 * OpenRouter の原価は backend の下書き API の中の costGuard だけが予約する。
 * 回数切れ・原価切れ・LLM 失敗のときは定型文に戻す。
 */
export const QUOTA_SEPARATION_REASON =
  'アプリの無料枠は候補作成の入口だけを止める。定型文のときはOpenRouterは呼ばない。LLMの本文はbackendの下書きAPIの中のcostGuardだけを通す。cost-guardはログイン利用者とD1の原価予約が前提で、アプリの回数カウンタとは別人である。';

const TRIAL_SECONDS = TRIAL_DAYS * 24 * 60 * 60;
const TRIAL_LIMIT = 60;
const ACTIVE_MONTHLY_LIMIT = 1500;
const PREVIEW_DAILY_LIMIT = 3;
const PREVIEW_GLOBAL_LIMIT = 500;
const TRIAL_START_LIMIT = 200;
const SIGNATURE_TOLERANCE_SECONDS = 300;

function utcDay(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function utcMonth(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 7);
}

export function entitlementKey(email) {
  return `entitlement:${email}`;
}

export function resolvePlan(record = {}, nowMs = Date.now()) {
  const merged = mergeEntitlement(record, nowMs);
  return {
    plan: merged.plan,
    trialDaysRemaining: merged.trialDaysRemaining,
    currentPeriodEnd: merged.currentPeriodEnd
  };
}

async function readJson(env, key) {
  if (!env.CHATGPT_KV) return null;
  const raw = await env.CHATGPT_KV.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJson(env, key, value) {
  if (!env.CHATGPT_KV) return false;
  await env.CHATGPT_KV.put(key, JSON.stringify(value));
  return true;
}

async function increment(env, key, ttlSeconds) {
  const current = Number((await env.CHATGPT_KV.get(key)) || '0');
  const next = (Number.isFinite(current) ? current : 0) + 1;
  await env.CHATGPT_KV.put(key, String(next), ttlSeconds ? { expirationTtl: ttlSeconds } : undefined);
  return next;
}

export async function billingView(env, email, nowMs = Date.now()) {
  const normalized = normalizeEmail(email);
  const base = {
    plan: normalized ? 'none' : 'preview',
    priceYen: PRICE_YEN,
    annualYen: ANNUAL_YEN,
    trialDays: TRIAL_DAYS,
    trialDaysRemaining: 0,
    storageReady: Boolean(env.CHATGPT_KV),
    checkoutAvailable: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID),
    email: normalized
  };
  if (!normalized || !env.CHATGPT_KV) return base;
  const record = await readJson(env, entitlementKey(normalized));
  if (!record) return base;
  const plan = resolvePlan(record, nowMs);
  return { ...base, ...plan, email: normalized };
}

export async function startTrial(env, email, nowMs = Date.now()) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'invalid_email' };
  if (!env.CHATGPT_KV) return { ok: false, reason: 'storage_not_configured' };
  const key = entitlementKey(normalized);
  const existing = await readJson(env, key);
  if (existing) {
    const billing = await billingView(env, normalized, nowMs);
    if (billing.plan === 'expired') return { ok: false, reason: 'trial_used', billing };
    return { ok: true, already: true, billing };
  }
  const starts = await increment(env, `trial-starts:${utcDay(nowMs)}`, 172800);
  if (starts > TRIAL_START_LIMIT) return { ok: false, reason: 'trial_busy' };
  const nowSec = Math.floor(nowMs / 1000);
  await writeJson(env, key, {
    email: normalized,
    plan: 'trial',
    trialStartedAt: nowSec,
    trialEndsAt: nowSec + TRIAL_SECONDS,
    currentPeriodEnd: 0
  });
  return { ok: true, billing: await billingView(env, normalized, nowMs) };
}

export async function consumeGeneration(env, input = {}, nowMs = Date.now()) {
  const email = normalizeEmail(input.email);
  const billing = await billingView(env, email, nowMs);
  if (!env.CHATGPT_KV) return { ok: true, billing: { ...billing, storageReady: false } };
  if (email) {
    if (billing.plan === 'none') return { ok: false, reason: 'trial_required', billing };
    if (billing.plan === 'expired') return { ok: false, reason: 'plan_expired', billing };
    const key = billing.plan === 'active' ? `usage:${email}:${utcMonth(nowMs)}` : `usage:${email}:trial`;
    const limit = billing.plan === 'active' ? ACTIVE_MONTHLY_LIMIT : TRIAL_LIMIT;
    const used = await increment(env, key, billing.plan === 'active' ? 3456000 : undefined);
    if (used > limit) return { ok: false, reason: 'quota_exceeded', billing: { ...billing, remaining: 0 } };
    return { ok: true, billing: { ...billing, remaining: limit - used } };
  }
  const day = utcDay(nowMs);
  const globalUsed = await increment(env, `preview:global:${day}`, 172800);
  if (globalUsed > PREVIEW_GLOBAL_LIMIT) return { ok: false, reason: 'preview_busy', billing };
  const deskId = validDeskId(input.deskId) || 'anonymous';
  const used = await increment(env, `preview:${deskId}:${day}`, 172800);
  if (used > PREVIEW_DAILY_LIMIT) {
    return { ok: false, reason: 'preview_exhausted', billing: { ...billing, previewRemaining: 0 } };
  }
  return { ok: true, billing: { ...billing, previewRemaining: PREVIEW_DAILY_LIMIT - used } };
}

export async function createCheckoutSession(env, { email, origin, planId = 'monthly', fetchImpl = fetch }) {
  const normalized = normalizeEmail(email);
  const plan = planById(planId);
  const priceId = env[plan.stripeEnv];
  if (!normalized) return { ok: false, status: 400, reason: 'invalid_email' };
  if (!env.STRIPE_SECRET_KEY || !priceId) {
    return { ok: false, status: 503, reason: 'stripe_not_configured' };
  }
  const body = new URLSearchParams();
  body.set('mode', 'subscription');
  body.set('line_items[0][price]', priceId);
  body.set('metadata[plan]', plan.id);
  body.set('line_items[0][quantity]', '1');
  body.set('customer_email', normalized);
  body.set('client_reference_id', normalized);
  body.set('metadata[email]', normalized);
  body.set('success_url', `${origin}/price/?notice=checkout_success`);
  body.set('cancel_url', `${origin}/price/?notice=checkout_cancel`);
  let response;
  try {
    response = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
  } catch {
    return { ok: false, status: 502, reason: 'stripe_error' };
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.url !== 'string' || !payload.url.startsWith('https://')) {
    return { ok: false, status: 502, reason: 'stripe_error' };
  }
  return { ok: true, url: payload.url };
}

export async function publishEntitlement(env, record) {
  if (!env.BACKEND_URL || !env.INTERNAL_ENTITLEMENT_TOKEN || !record?.email) return { ok: false, skipped: true };
  const fetchImpl = env.ENTITLEMENT_FETCH || fetch;
  try {
    const response = await fetchImpl(`${String(env.BACKEND_URL).replace(/\/$/, '')}/internal/entitlement`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.INTERNAL_ENTITLEMENT_TOKEN}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ email: record.email, entitlement: record })
    });
    return { ok: response.ok };
  } catch {
    return { ok: false, reason: 'backend_unreachable' };
  }
}

export async function upsertEntitlementSource(env, email, sourceName, source, nowMs = Date.now()) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: 'invalid_email' };
  if (!env.CHATGPT_KV) return { ok: false, reason: 'storage_not_configured' };
  const previous = (await readJson(env, entitlementKey(normalized))) || { email: normalized };
  const stored = await saveEntitlement(env, normalized, withSource(previous, sourceName, source), nowMs);
  return { ok: true, email: normalized, record: stored };
}

async function saveEntitlement(env, email, record, nowMs) {
  const stored = applyMergedPlan({ ...record, email }, nowMs);
  await writeJson(env, entitlementKey(email), stored);
  await publishEntitlement(env, stored);
  return stored;
}

async function activateEmail(env, email, { currentPeriodEnd, stripeCustomerId, planId }, nowMs) {
  const previous = (await readJson(env, entitlementKey(email))) || {};
  const next = withSource(
    {
      ...previous,
      email,
      stripeCustomerId: stripeCustomerId || previous.stripeCustomerId || '',
      trialEndsAt: previous.trialEndsAt || 0
    },
    'stripe',
    { active: true, currentPeriodEnd, customerId: stripeCustomerId || previous.stripeCustomerId || '', planId: planId || 'monthly' }
  );
  await saveEntitlement(env, email, next, nowMs);
  if (stripeCustomerId) await env.CHATGPT_KV.put(`stripe-customer:${stripeCustomerId}`, email);
}

export async function applyStripeEvent(env, event, nowMs = Date.now()) {
  if (!env.CHATGPT_KV) return { ok: false, reason: 'storage_not_configured' };
  if (!event || typeof event !== 'object') return { ok: false, reason: 'invalid_event' };
  if (event.type === 'checkout.session.completed') {
    const session = event.data?.object || {};
    const email = normalizeEmail(session.metadata?.email || session.customer_details?.email || session.customer_email);
    if (!email) return { ok: false, reason: 'email_missing' };
    await activateEmail(
      env,
      email,
      {
        currentPeriodEnd: Math.floor(nowMs / 1000) + 32 * 86400,
        stripeCustomerId: session.customer || '',
        planId: session.metadata?.plan || 'monthly'
      },
      nowMs
    );
    return { ok: true, email };
  }
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subscription = event.data?.object || {};
    const customerId = subscription.customer || '';
    const email = normalizeEmail(await env.CHATGPT_KV.get(`stripe-customer:${customerId}`));
    if (!email) return { ok: false, reason: 'customer_unmapped' };
    const active =
      event.type !== 'customer.subscription.deleted' &&
      (subscription.status === 'active' || subscription.status === 'trialing');
    if (active) {
      await activateEmail(
        env,
        email,
        { currentPeriodEnd: Number(subscription.current_period_end) || 0, stripeCustomerId: customerId },
        nowMs
      );
    } else {
      const previous = (await readJson(env, entitlementKey(email))) || { email };
      const next = withSource(previous, 'stripe', {
        active: false,
        currentPeriodEnd: Math.floor(nowMs / 1000),
        customerId
      });
      await saveEntitlement(env, email, next, nowMs);
    }
    return { ok: true, email };
  }
  return { ok: true, ignored: true };
}

export async function verifyStripeSignature(payload, header, secret, nowMs = Date.now()) {
  if (!secret || !header) return false;
  const parts = String(header)
    .split(',')
    .map((part) => {
      const index = part.indexOf('=');
      return index === -1 ? ['', ''] : [part.slice(0, index), part.slice(index + 1)];
    });
  const timestamp = parts.find((part) => part[0] === 't')?.[1];
  const signatures = parts.filter((part) => part[0] === 'v1').map((part) => part[1]);
  const stamp = Number(timestamp);
  if (!timestamp || signatures.length === 0 || !Number.isFinite(stamp)) return false;
  if (Math.abs(nowMs / 1000 - stamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return signatures.some((signature) => timingSafeEqual(hex, signature));
}
