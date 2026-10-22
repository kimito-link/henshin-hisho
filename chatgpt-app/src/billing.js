import { normalizeEmail, timingSafeEqual, validDeskId } from './http.js';

/**
 * 候補作成は定型文で、OpenRouter を呼ばない。
 * backend/src/cost-guard.js はログイン利用者と D1 の原価予約が前提で、
 * ChatGPT 側の識別子とは別人である。ここに通すと、D1 が無いだけで全停止するか、
 * 別人の LLM 予算を消費する。LLM を足すときは backend の下書き API 越しに costGuard を通す。
 */
export const QUOTA_SEPARATION_REASON =
  'chatgpt-appの候補作成はLLMを呼ばない。backendのcost-guardはOpenRouterの原価予約とD1とログイン利用者が前提なので、ChatGPTの無料枠はここには載せない。LLMを呼ぶようにする場合はbackendの下書きAPIの中のcostGuardだけを通す。';

export const PRICE_YEN = 2980;
export const ANNUAL_YEN = 29800;
export const TRIAL_DAYS = 14;
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
  const now = Math.floor(nowMs / 1000);
  const currentPeriodEnd = Number(record.currentPeriodEnd || 0);
  if (record.plan === 'active' && (!currentPeriodEnd || currentPeriodEnd > now)) {
    return { plan: 'active', trialDaysRemaining: 0, currentPeriodEnd };
  }
  if (Number(record.trialEndsAt || 0) > now) {
    return {
      plan: 'trial',
      trialDaysRemaining: Math.max(0, Math.ceil((record.trialEndsAt - now) / 86400)),
      currentPeriodEnd
    };
  }
  if (record.plan || record.trialEndsAt) return { plan: 'expired', trialDaysRemaining: 0, currentPeriodEnd };
  return { plan: 'none', trialDaysRemaining: 0, currentPeriodEnd };
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

export async function createCheckoutSession(env, { email, origin, fetchImpl = fetch }) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, status: 400, reason: 'invalid_email' };
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID) {
    return { ok: false, status: 503, reason: 'stripe_not_configured' };
  }
  const body = new URLSearchParams();
  body.set('mode', 'subscription');
  body.set('line_items[0][price]', env.STRIPE_PRICE_ID);
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

async function activateEmail(env, email, { currentPeriodEnd, stripeCustomerId }, nowMs) {
  const previous = (await readJson(env, entitlementKey(email))) || {};
  await writeJson(env, entitlementKey(email), {
    ...previous,
    email,
    plan: 'active',
    currentPeriodEnd,
    stripeCustomerId: stripeCustomerId || previous.stripeCustomerId || '',
    trialEndsAt: previous.trialEndsAt || 0,
    updatedAt: Math.floor(nowMs / 1000)
  });
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
      { currentPeriodEnd: Math.floor(nowMs / 1000) + 32 * 86400, stripeCustomerId: session.customer || '' },
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
      await writeJson(env, entitlementKey(email), {
        ...previous,
        email,
        plan: 'expired',
        currentPeriodEnd: Math.floor(nowMs / 1000)
      });
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
