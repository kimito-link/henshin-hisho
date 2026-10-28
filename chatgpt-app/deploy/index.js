var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../shared/entitlement.js
function mergeEntitlement(record = {}, nowMs = Date.now()) {
  const now = Math.floor(nowMs / 1e3);
  const sources = record.sources && typeof record.sources === "object" ? record.sources : null;
  const sourceNames = sources ? Object.keys(sources) : [];
  let activeEnd = null;
  if (sourceNames.length > 0) {
    for (const source of Object.values(sources)) {
      if (!source?.active) continue;
      const end = Number(source.currentPeriodEnd || 0);
      if (!end || end > now) {
        if (!end || activeEnd === 0) activeEnd = 0;
        else activeEnd = activeEnd == null ? end : Math.max(activeEnd, end);
      }
    }
  } else if (record.plan === "active") {
    const end = Number(record.currentPeriodEnd || 0);
    if (!end || end > now) activeEnd = end;
  }
  if (activeEnd != null) {
    return { plan: "active", trialDaysRemaining: 0, currentPeriodEnd: activeEnd, unlocked: true };
  }
  const trialEndsAt = Number(record.trialEndsAt || 0);
  if (trialEndsAt > now) {
    return {
      plan: "trial",
      trialDaysRemaining: Math.max(0, Math.ceil((trialEndsAt - now) / 86400)),
      currentPeriodEnd: Number(record.currentPeriodEnd || 0),
      unlocked: true
    };
  }
  if (record.plan || record.trialEndsAt || sourceNames.length > 0) {
    return {
      plan: "expired",
      trialDaysRemaining: 0,
      currentPeriodEnd: Number(record.currentPeriodEnd || 0),
      unlocked: false
    };
  }
  return { plan: "none", trialDaysRemaining: 0, currentPeriodEnd: 0, unlocked: false };
}
__name(mergeEntitlement, "mergeEntitlement");
function withSource(record = {}, name, source) {
  return {
    ...record,
    sources: {
      ...record.sources || {},
      [name]: { ...record.sources?.[name] || {}, ...source }
    }
  };
}
__name(withSource, "withSource");
function applyMergedPlan(record = {}, nowMs = Date.now()) {
  const merged = mergeEntitlement(record, nowMs);
  return {
    ...record,
    plan: merged.plan,
    currentPeriodEnd: merged.currentPeriodEnd,
    updatedAt: Math.floor(nowMs / 1e3)
  };
}
__name(applyMergedPlan, "applyMergedPlan");

// ../web-app/billing/plans.js
var APPLE_BUNDLE_ID = "jp.besttrust.henshinhisho";
var PLAY_PACKAGE_NAME = "jp.besttrust.henshinhisho";
var APPLE_ROOT_CA_G3_SHA256 = "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179";
var OPERATOR_NAME = "\u682A\u5F0F\u4F1A\u793E\u30D9\u30B9\u30C8\u30C8\u30E9\u30B9\u30C8";
var PRICE_YEN = 2980;
var ANNUAL_YEN = 29800;
var TRIAL_DAYS = 14;
var PLANS = Object.freeze([
  Object.freeze({
    id: "monthly",
    label: "\u6708\u984D",
    interval: "month",
    priceYen: PRICE_YEN,
    stripeEnv: "STRIPE_PRICE_ID",
    appleProductId: "jp.besttrust.henshinhisho.monthly",
    playProductId: "henshin_hisho",
    playBasePlanId: "monthly",
    playBillingPeriod: "P1M"
  }),
  Object.freeze({
    id: "annual",
    label: "\u5E74\u984D",
    interval: "year",
    priceYen: ANNUAL_YEN,
    stripeEnv: "STRIPE_ANNUAL_PRICE_ID",
    appleProductId: "jp.besttrust.henshinhisho.annual",
    playProductId: "henshin_hisho",
    playBasePlanId: "annual",
    playBillingPeriod: "P1Y"
  })
]);
function planById(id) {
  return PLANS.find((plan) => plan.id === id) || PLANS[0];
}
__name(planById, "planById");
function planByAppleProduct(productId) {
  return PLANS.find((plan) => plan.appleProductId === productId) || null;
}
__name(planByAppleProduct, "planByAppleProduct");

// src/http.js
function timingSafeEqual(a, b) {
  const bufA = new TextEncoder().encode(String(a || ""));
  const bufB = new TextEncoder().encode(String(b || ""));
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i += 1) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}
__name(timingSafeEqual, "timingSafeEqual");
function clip(value, max) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}
__name(clip, "clip");
function normalizeEmail(value) {
  const email = clip(value, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}
__name(normalizeEmail, "normalizeEmail");
function validDeskId(value) {
  const id = clip(value, 80);
  return /^[A-Za-z0-9_-]{8,80}$/.test(id) ? id : "";
}
__name(validDeskId, "validDeskId");
var SLASH_PATHS = /* @__PURE__ */ new Set(["/price", "/preview/reply-form"]);
function isLocalHost(host) {
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}
__name(isLocalHost, "isLocalHost");
function canonicalUrl(request) {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) url.host = forwardedHost.split(",")[0].trim();
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) url.protocol = `${forwardedProto.split(",")[0].trim()}:`;
  let host = url.host;
  const local = isLocalHost(host);
  let changed = false;
  if (host.toLowerCase().startsWith("www.")) {
    host = host.slice(4);
    changed = true;
  }
  if (!local && url.protocol === "http:") changed = true;
  if (SLASH_PATHS.has(url.pathname)) {
    url.pathname = `${url.pathname}/`;
    changed = true;
  }
  if (!changed) return null;
  url.protocol = local ? url.protocol : "https:";
  url.host = host;
  return url;
}
__name(canonicalUrl, "canonicalUrl");
function publicOrigin(request) {
  const redirected = canonicalUrl(request);
  if (redirected) return redirected.origin;
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) url.host = forwardedHost.split(",")[0].trim();
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) url.protocol = `${forwardedProto.split(",")[0].trim()}:`;
  if (!isLocalHost(url.host)) url.protocol = "https:";
  return url.origin;
}
__name(publicOrigin, "publicOrigin");
function htmlHeaders(extra = {}) {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'self'; frame-ancestors 'none'",
    ...extra
  };
}
__name(htmlHeaders, "htmlHeaders");
function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra
    }
  });
}
__name(json, "json");
async function readForm(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    try {
      return await request.json();
    } catch {
      return null;
    }
  }
  const text = await request.text();
  return Object.fromEntries(new URLSearchParams(text));
}
__name(readForm, "readForm");
function sameSitePost(request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return true;
  try {
    const originHost = new URL(origin).host.replace(/^www\./i, "");
    const requestHost = new URL(request.url).host.replace(/^www\./i, "");
    return originHost === requestHost;
  } catch {
    return false;
  }
}
__name(sameSitePost, "sameSitePost");
function mcpCorsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, mcp-session-id, authorization",
    "access-control-expose-headers": "mcp-session-id"
  };
}
__name(mcpCorsHeaders, "mcpCorsHeaders");

// src/billing.js
var TRIAL_SECONDS = TRIAL_DAYS * 24 * 60 * 60;
var TRIAL_LIMIT = 60;
var ACTIVE_MONTHLY_LIMIT = 1500;
var PREVIEW_DAILY_LIMIT = 3;
var PREVIEW_GLOBAL_LIMIT = 500;
var TRIAL_START_LIMIT = 200;
var SIGNATURE_TOLERANCE_SECONDS = 300;
function utcDay(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}
__name(utcDay, "utcDay");
function utcMonth(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 7);
}
__name(utcMonth, "utcMonth");
function entitlementKey(email) {
  return `entitlement:${email}`;
}
__name(entitlementKey, "entitlementKey");
function resolvePlan(record = {}, nowMs = Date.now()) {
  const merged = mergeEntitlement(record, nowMs);
  return {
    plan: merged.plan,
    trialDaysRemaining: merged.trialDaysRemaining,
    currentPeriodEnd: merged.currentPeriodEnd
  };
}
__name(resolvePlan, "resolvePlan");
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
__name(readJson, "readJson");
async function writeJson(env, key, value) {
  if (!env.CHATGPT_KV) return false;
  await env.CHATGPT_KV.put(key, JSON.stringify(value));
  return true;
}
__name(writeJson, "writeJson");
async function increment(env, key, ttlSeconds) {
  const current = Number(await env.CHATGPT_KV.get(key) || "0");
  const next = (Number.isFinite(current) ? current : 0) + 1;
  await env.CHATGPT_KV.put(key, String(next), ttlSeconds ? { expirationTtl: ttlSeconds } : void 0);
  return next;
}
__name(increment, "increment");
async function billingView(env, email, nowMs = Date.now()) {
  const normalized = normalizeEmail(email);
  const base = {
    plan: normalized ? "none" : "preview",
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
__name(billingView, "billingView");
async function startTrial(env, email, nowMs = Date.now()) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: "invalid_email" };
  if (!env.CHATGPT_KV) return { ok: false, reason: "storage_not_configured" };
  const key = entitlementKey(normalized);
  const existing = await readJson(env, key);
  if (existing) {
    const billing = await billingView(env, normalized, nowMs);
    if (billing.plan === "expired") return { ok: false, reason: "trial_used", billing };
    return { ok: true, already: true, billing };
  }
  const starts = await increment(env, `trial-starts:${utcDay(nowMs)}`, 172800);
  if (starts > TRIAL_START_LIMIT) return { ok: false, reason: "trial_busy" };
  const nowSec = Math.floor(nowMs / 1e3);
  await writeJson(env, key, {
    email: normalized,
    plan: "trial",
    trialStartedAt: nowSec,
    trialEndsAt: nowSec + TRIAL_SECONDS,
    currentPeriodEnd: 0
  });
  return { ok: true, billing: await billingView(env, normalized, nowMs) };
}
__name(startTrial, "startTrial");
async function consumeGeneration(env, input = {}, nowMs = Date.now()) {
  const email = normalizeEmail(input.email);
  const billing = await billingView(env, email, nowMs);
  if (!env.CHATGPT_KV) return { ok: true, billing: { ...billing, storageReady: false } };
  if (email) {
    if (billing.plan === "none") return { ok: false, reason: "trial_required", billing };
    if (billing.plan === "expired") return { ok: false, reason: "plan_expired", billing };
    const key = billing.plan === "active" ? `usage:${email}:${utcMonth(nowMs)}` : `usage:${email}:trial`;
    const limit = billing.plan === "active" ? ACTIVE_MONTHLY_LIMIT : TRIAL_LIMIT;
    const used2 = await increment(env, key, billing.plan === "active" ? 3456e3 : void 0);
    if (used2 > limit) return { ok: false, reason: "quota_exceeded", billing: { ...billing, remaining: 0 } };
    return { ok: true, billing: { ...billing, remaining: limit - used2 } };
  }
  const day = utcDay(nowMs);
  const globalUsed = await increment(env, `preview:global:${day}`, 172800);
  if (globalUsed > PREVIEW_GLOBAL_LIMIT) return { ok: false, reason: "preview_busy", billing };
  const deskId = validDeskId(input.deskId) || "anonymous";
  const used = await increment(env, `preview:${deskId}:${day}`, 172800);
  if (used > PREVIEW_DAILY_LIMIT) {
    return { ok: false, reason: "preview_exhausted", billing: { ...billing, previewRemaining: 0 } };
  }
  return { ok: true, billing: { ...billing, previewRemaining: PREVIEW_DAILY_LIMIT - used } };
}
__name(consumeGeneration, "consumeGeneration");
async function createCheckoutSession(env, { email, origin, planId = "monthly", fetchImpl = fetch }) {
  const normalized = normalizeEmail(email);
  const plan = planById(planId);
  const priceId = env[plan.stripeEnv];
  if (!normalized) return { ok: false, status: 400, reason: "invalid_email" };
  if (!env.STRIPE_SECRET_KEY || !priceId) {
    return { ok: false, status: 503, reason: "stripe_not_configured" };
  }
  const body = new URLSearchParams();
  body.set("mode", "subscription");
  body.set("line_items[0][price]", priceId);
  body.set("metadata[plan]", plan.id);
  body.set("line_items[0][quantity]", "1");
  body.set("customer_email", normalized);
  body.set("client_reference_id", normalized);
  body.set("metadata[email]", normalized);
  body.set("success_url", `${origin}/price/?notice=checkout_success`);
  body.set("cancel_url", `${origin}/price/?notice=checkout_cancel`);
  let response;
  try {
    response = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });
  } catch {
    return { ok: false, status: 502, reason: "stripe_error" };
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.url !== "string" || !payload.url.startsWith("https://")) {
    return { ok: false, status: 502, reason: "stripe_error" };
  }
  return { ok: true, url: payload.url };
}
__name(createCheckoutSession, "createCheckoutSession");
async function publishEntitlement(env, record) {
  if (!env.BACKEND_URL || !env.INTERNAL_ENTITLEMENT_TOKEN || !record?.email) return { ok: false, skipped: true };
  const fetchImpl = env.ENTITLEMENT_FETCH || fetch;
  try {
    const response = await fetchImpl(`${String(env.BACKEND_URL).replace(/\/$/, "")}/internal/entitlement`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.INTERNAL_ENTITLEMENT_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ email: record.email, entitlement: record })
    });
    return { ok: response.ok };
  } catch {
    return { ok: false, reason: "backend_unreachable" };
  }
}
__name(publishEntitlement, "publishEntitlement");
async function upsertEntitlementSource(env, email, sourceName, source, nowMs = Date.now()) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, reason: "invalid_email" };
  if (!env.CHATGPT_KV) return { ok: false, reason: "storage_not_configured" };
  const previous = await readJson(env, entitlementKey(normalized)) || { email: normalized };
  const stored = await saveEntitlement(env, normalized, withSource(previous, sourceName, source), nowMs);
  return { ok: true, email: normalized, record: stored };
}
__name(upsertEntitlementSource, "upsertEntitlementSource");
async function saveEntitlement(env, email, record, nowMs) {
  const stored = applyMergedPlan({ ...record, email }, nowMs);
  await writeJson(env, entitlementKey(email), stored);
  await publishEntitlement(env, stored);
  return stored;
}
__name(saveEntitlement, "saveEntitlement");
async function activateEmail(env, email, { currentPeriodEnd, stripeCustomerId, planId }, nowMs) {
  const previous = await readJson(env, entitlementKey(email)) || {};
  const next = withSource(
    {
      ...previous,
      email,
      stripeCustomerId: stripeCustomerId || previous.stripeCustomerId || "",
      trialEndsAt: previous.trialEndsAt || 0
    },
    "stripe",
    { active: true, currentPeriodEnd, customerId: stripeCustomerId || previous.stripeCustomerId || "", planId: planId || "monthly" }
  );
  await saveEntitlement(env, email, next, nowMs);
  if (stripeCustomerId) await env.CHATGPT_KV.put(`stripe-customer:${stripeCustomerId}`, email);
}
__name(activateEmail, "activateEmail");
async function applyStripeEvent(env, event, nowMs = Date.now()) {
  if (!env.CHATGPT_KV) return { ok: false, reason: "storage_not_configured" };
  if (!event || typeof event !== "object") return { ok: false, reason: "invalid_event" };
  if (event.type === "checkout.session.completed") {
    const session = event.data?.object || {};
    const email = normalizeEmail(session.metadata?.email || session.customer_details?.email || session.customer_email);
    if (!email) return { ok: false, reason: "email_missing" };
    await activateEmail(
      env,
      email,
      {
        currentPeriodEnd: Math.floor(nowMs / 1e3) + 32 * 86400,
        stripeCustomerId: session.customer || "",
        planId: session.metadata?.plan || "monthly"
      },
      nowMs
    );
    return { ok: true, email };
  }
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = event.data?.object || {};
    const customerId = subscription.customer || "";
    const email = normalizeEmail(await env.CHATGPT_KV.get(`stripe-customer:${customerId}`));
    if (!email) return { ok: false, reason: "customer_unmapped" };
    const active = event.type !== "customer.subscription.deleted" && (subscription.status === "active" || subscription.status === "trialing");
    if (active) {
      await activateEmail(
        env,
        email,
        { currentPeriodEnd: Number(subscription.current_period_end) || 0, stripeCustomerId: customerId },
        nowMs
      );
    } else {
      const previous = await readJson(env, entitlementKey(email)) || { email };
      const next = withSource(previous, "stripe", {
        active: false,
        currentPeriodEnd: Math.floor(nowMs / 1e3),
        customerId
      });
      await saveEntitlement(env, email, next, nowMs);
    }
    return { ok: true, email };
  }
  return { ok: true, ignored: true };
}
__name(applyStripeEvent, "applyStripeEvent");
async function verifyStripeSignature(payload, header, secret, nowMs = Date.now()) {
  if (!secret || !header) return false;
  const parts = String(header).split(",").map((part) => {
    const index = part.indexOf("=");
    return index === -1 ? ["", ""] : [part.slice(0, index), part.slice(index + 1)];
  });
  const timestamp = parts.find((part) => part[0] === "t")?.[1];
  const signatures = parts.filter((part) => part[0] === "v1").map((part) => part[1]);
  const stamp = Number(timestamp);
  if (!timestamp || signatures.length === 0 || !Number.isFinite(stamp)) return false;
  if (Math.abs(nowMs / 1e3 - stamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return signatures.some((signature) => timingSafeEqual(hex, signature));
}
__name(verifyStripeSignature, "verifyStripeSignature");

// ../shared/account-token.js
var NAMESPACE = "6ba7b8119dad11d180b400c04fd430c8";
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
__name(hexToBytes, "hexToBytes");
async function accountTokenForEmail(email) {
  const name = new TextEncoder().encode(String(email || "").trim().toLowerCase());
  const ns = hexToBytes(NAMESPACE);
  const data = new Uint8Array(ns.length + name.length);
  data.set(ns, 0);
  data.set(name, ns.length);
  const digest2 = new Uint8Array(await crypto.subtle.digest("SHA-1", data)).slice(0, 16);
  digest2[6] = digest2[6] & 15 | 80;
  digest2[8] = digest2[8] & 63 | 128;
  const hex = [...digest2].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
__name(accountTokenForEmail, "accountTokenForEmail");

// ../shared/play-auth.js
var TOKEN_URL = "https://oauth2.googleapis.com/token";
var SCOPE = "https://www.googleapis.com/auth/androidpublisher";
function bytesToBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(bytesToBase64Url, "bytesToBase64Url");
function textToBase64Url(text) {
  return bytesToBase64Url(new TextEncoder().encode(text));
}
__name(textToBase64Url, "textToBase64Url");
function pemToDer(pem) {
  const b64 = String(pem).replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
__name(pemToDer, "pemToDer");
async function mintPlayAccessToken(saJson, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  let sa = saJson;
  if (typeof saJson === "string") {
    try {
      sa = JSON.parse(saJson);
    } catch {
      return "";
    }
  }
  if (!sa?.client_email || !sa?.private_key) return "";
  const header = textToBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(nowMs / 1e3);
  const claims = textToBase64Url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600
    })
  );
  const signingInput = `${header}.${claims}`;
  let key;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      pemToDer(sa.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
  } catch {
    return "";
  }
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput))
  );
  const assertion = `${signingInput}.${bytesToBase64Url(signature)}`;
  let response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion
      })
    });
  } catch {
    return "";
  }
  if (!response?.ok) return "";
  const payload = await response.json().catch(() => null);
  return payload?.access_token || "";
}
__name(mintPlayAccessToken, "mintPlayAccessToken");
async function playAccessTokenFromEnv(env) {
  if (env.PLAY_ACCESS_TOKEN) return env.PLAY_ACCESS_TOKEN;
  if (!env.GOOGLE_PLAY_SA_JSON) return "";
  return mintPlayAccessToken(env.GOOGLE_PLAY_SA_JSON, {
    fetchImpl: env.PLAY_TOKEN_FETCH || fetch
  });
}
__name(playAccessTokenFromEnv, "playAccessTokenFromEnv");

// ../shared/play-catalog.js
function playSubscriptionV2Url(packageName, purchaseToken) {
  const pkg = encodeURIComponent(packageName || PLAY_PACKAGE_NAME);
  const token2 = encodeURIComponent(purchaseToken || "");
  return `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/purchases/subscriptionsv2/tokens/${token2}`;
}
__name(playSubscriptionV2Url, "playSubscriptionV2Url");
var ACTIVE_STATES = /* @__PURE__ */ new Set([
  "SUBSCRIPTION_STATE_ACTIVE",
  "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
  "SUBSCRIPTION_STATE_CANCELED"
]);
function assessPlaySubscription(body = {}, nowMs = Date.now()) {
  const line = (body.lineItems || [])[0] || {};
  const expiryMs = Date.parse(line.expiryTime || "") || 0;
  const active = ACTIVE_STATES.has(body.subscriptionState) && (!expiryMs || expiryMs > nowMs);
  const basePlanId = line.offerDetails?.basePlanId || "";
  const plan = PLANS.find((item) => item.playBasePlanId === basePlanId) || null;
  return {
    active,
    currentPeriodEnd: expiryMs ? Math.floor(expiryMs / 1e3) : 0,
    productId: line.productId || PLANS[0].playProductId,
    planId: plan?.id || basePlanId,
    accountToken: String(body.externalAccountIdentifiers?.obfuscatedExternalAccountId || ""),
    purchaseToken: String(body.linkedPurchaseToken || body.purchaseToken || "")
  };
}
__name(assessPlaySubscription, "assessPlaySubscription");

// ../shared/store-jws.js
var CURVES = [
  { oid: [6, 8, 42, 134, 72, 206, 61, 3, 1, 7], crv: "P-256", size: 32 },
  { oid: [6, 5, 43, 129, 4, 0, 34], crv: "P-384", size: 48 }
];
function bytesToB64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(bytesToB64Url, "bytesToB64Url");
function b64UrlToBytes(value) {
  const padded = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(padded.length + (4 - padded.length % 4) % 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
__name(b64UrlToBytes, "b64UrlToBytes");
function b64DerToBytes(value) {
  const binary = atob(String(value || "").replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
__name(b64DerToBytes, "b64DerToBytes");
async function sha256Hex(bytes) {
  const digest2 = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest2)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
function curveKeyFromCert(der, wanted) {
  const bytes = der instanceof Uint8Array ? der : new Uint8Array(der);
  for (const curve of CURVES) {
    if (wanted && curve.crv !== wanted) continue;
    for (let i = 0; i < bytes.length - curve.oid.length - curve.size * 2; i += 1) {
      let match = true;
      for (let j = 0; j < curve.oid.length; j += 1) {
        if (bytes[i + j] !== curve.oid[j]) match = false;
      }
      if (!match || bytes[i + curve.oid.length] !== 3) continue;
      const length = bytes[i + curve.oid.length + 1];
      const start = i + curve.oid.length + 2;
      if (length !== curve.size * 2 + 2 || bytes[start] !== 0 || bytes[start + 1] !== 4) continue;
      const point = start + 2;
      return {
        kty: "EC",
        crv: curve.crv,
        x: bytesToB64Url(bytes.slice(point, point + curve.size)),
        y: bytesToB64Url(bytes.slice(point + curve.size, point + curve.size * 2))
      };
    }
  }
  return null;
}
__name(curveKeyFromCert, "curveKeyFromCert");
function p256JwkFromCert(der) {
  return curveKeyFromCert(der, "P-256");
}
__name(p256JwkFromCert, "p256JwkFromCert");
async function importVerifyKey(publicJwk) {
  return crypto.subtle.importKey(
    "jwk",
    { ...publicJwk, key_ops: ["verify"], ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
}
__name(importVerifyKey, "importVerifyKey");
async function verifyEs256Jws(jws, publicJwk) {
  try {
    const parts = String(jws || "").split(".");
    if (parts.length !== 3 || !publicJwk || publicJwk.kty !== "EC" || publicJwk.crv !== "P-256") {
      return { ok: false, reason: "bad_signature" };
    }
    const key = await importVerifyKey(publicJwk);
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = b64UrlToBytes(parts[2]);
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, data);
    if (!valid) return { ok: false, reason: "bad_signature" };
    const payload = JSON.parse(new TextDecoder().decode(b64UrlToBytes(parts[1])));
    return { ok: true, payload, header: JSON.parse(new TextDecoder().decode(b64UrlToBytes(parts[0]))) };
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
}
__name(verifyEs256Jws, "verifyEs256Jws");
async function certSignedByIssuer(childDer, issuerDer) {
  const { X509Certificate } = await import("node:crypto");
  const child = new X509Certificate(childDer);
  const issuer = new X509Certificate(issuerDer);
  return child.verify(issuer.publicKey);
}
__name(certSignedByIssuer, "certSignedByIssuer");
async function verifyAppleJws(jws, options = {}) {
  if (options.publicJwk) return verifyEs256Jws(jws, options.publicJwk);
  const parts = String(jws || "").split(".");
  if (parts.length !== 3) return { ok: false, reason: "bad_signature" };
  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(b64UrlToBytes(parts[0])));
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  const chain = Array.isArray(header.x5c) ? header.x5c.map(b64DerToBytes) : [];
  if (chain.length === 0) return { ok: false, reason: "bad_signature" };
  const rootHash = await sha256Hex(chain[chain.length - 1]);
  if (rootHash !== APPLE_ROOT_CA_G3_SHA256) return { ok: false, reason: "bad_signature" };
  try {
    for (let i = 0; i < chain.length - 1; i += 1) {
      if (!await certSignedByIssuer(chain[i], chain[i + 1])) return { ok: false, reason: "bad_signature" };
    }
    if (chain.length === 1 && !await certSignedByIssuer(chain[0], chain[0])) {
      return { ok: false, reason: "bad_signature" };
    }
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  const leaf = p256JwkFromCert(chain[0]);
  if (!leaf) return { ok: false, reason: "bad_signature" };
  return verifyEs256Jws(jws, leaf);
}
__name(verifyAppleJws, "verifyAppleJws");
function assessAppleTransaction(claims = {}, nowMs = Date.now()) {
  const product = planByAppleProduct(claims.productId);
  if (!product) return { ok: false, reason: "unknown_product" };
  if (claims.bundleId && claims.bundleId !== APPLE_BUNDLE_ID) return { ok: false, reason: "bundle_mismatch" };
  const expiresMs = Number(claims.expiresDate || 0);
  const revoked = Boolean(claims.revocationDate);
  const active = !revoked && (!expiresMs || expiresMs > nowMs);
  return {
    ok: true,
    active,
    currentPeriodEnd: expiresMs ? Math.floor(expiresMs / 1e3) : 0,
    productId: claims.productId,
    planId: product.id,
    originalTransactionId: String(claims.originalTransactionId || ""),
    accountToken: String(claims.appAccountToken || "")
  };
}
__name(assessAppleTransaction, "assessAppleTransaction");
function appleTrustFromEnv(env = {}) {
  if (!env.APPLE_IAP_TRUST_JWK) return null;
  try {
    const parsed = JSON.parse(env.APPLE_IAP_TRUST_JWK);
    return parsed && parsed.kty === "EC" ? parsed : null;
  } catch {
    return null;
  }
}
__name(appleTrustFromEnv, "appleTrustFromEnv");

// src/store-billing.js
function storeWebhookAuthorized(request, env) {
  if (!env.STORE_WEBHOOK_TOKEN) return false;
  const url = new URL(request.url);
  const token2 = url.searchParams.get("token") || request.headers.get("x-store-webhook-token") || "";
  return timingSafeEqual(token2, env.STORE_WEBHOOK_TOKEN);
}
__name(storeWebhookAuthorized, "storeWebhookAuthorized");
async function emailForAccountToken(env, token2) {
  if (!token2 || !env.CHATGPT_KV) return "";
  return normalizeEmail(await env.CHATGPT_KV.get(`store-account:${token2}`));
}
__name(emailForAccountToken, "emailForAccountToken");
async function rememberStoreAccount(env, email) {
  const normalized = normalizeEmail(email);
  if (!normalized || !env.CHATGPT_KV) return { ok: false, reason: "invalid_email" };
  const accountToken = await accountTokenForEmail(normalized);
  await env.CHATGPT_KV.put(`store-account:${accountToken}`, normalized);
  return { ok: true, email: normalized, accountToken };
}
__name(rememberStoreAccount, "rememberStoreAccount");
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
__name(grantStoreSource, "grantStoreSource");
async function applyAppleNotification(env, body, nowMs = Date.now()) {
  if (!env.CHATGPT_KV) return { ok: false, reason: "storage_not_configured" };
  const trust = appleTrustFromEnv(env);
  const outer = await verifyAppleJws(body?.signedPayload, trust ? { publicJwk: trust } : {});
  if (!outer.ok) return outer;
  const note = outer.payload || {};
  const bundleId = note.data?.bundleId;
  if (bundleId && bundleId !== "jp.besttrust.henshinhisho") return { ok: false, reason: "bundle_mismatch" };
  const signedTransaction = note.data?.signedTransactionInfo;
  if (!signedTransaction) return { ok: true, ignored: true };
  const transaction = await verifyAppleJws(signedTransaction, trust ? { publicJwk: trust } : {});
  if (!transaction.ok) return transaction;
  const assessed = assessAppleTransaction(transaction.payload, nowMs);
  if (!assessed.ok) return assessed;
  const email = await emailForAccountToken(env, assessed.accountToken) || normalizeEmail(await env.CHATGPT_KV.get(`apple-original:${assessed.originalTransactionId}`));
  if (!email) {
    await env.CHATGPT_KV.put(`apple-pending:${assessed.originalTransactionId}`, JSON.stringify(assessed));
    return { ok: true, pending: true };
  }
  if (assessed.originalTransactionId) {
    await env.CHATGPT_KV.put(`apple-original:${assessed.originalTransactionId}`, email);
  }
  const saved = await grantStoreSource(env, email, "apple", assessed, nowMs);
  return { ok: saved.ok, email, plan: saved.record?.plan || "" };
}
__name(applyAppleNotification, "applyAppleNotification");
async function fetchPlaySubscription(env, purchaseToken) {
  if (env.PLAY_FETCH) return env.PLAY_FETCH(purchaseToken);
  const token2 = await playAccessTokenFromEnv(env);
  if (!token2) return null;
  const http = env.PLAY_HTTP_FETCH || fetch;
  const response = await http(playSubscriptionV2Url(env.PLAY_PACKAGE_NAME || PLAY_PACKAGE_NAME, purchaseToken), {
    headers: { authorization: `Bearer ${token2}` }
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}
__name(fetchPlaySubscription, "fetchPlaySubscription");
async function applyGoogleNotification(env, body, nowMs = Date.now()) {
  if (!env.CHATGPT_KV) return { ok: false, reason: "storage_not_configured" };
  let decoded = body;
  if (body?.message?.data) {
    try {
      decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.message.data), (char) => char.charCodeAt(0))));
    } catch {
      return { ok: false, reason: "invalid_event" };
    }
  }
  const note = decoded.subscriptionNotification || {};
  const purchaseToken = note.purchaseToken || "";
  if (!purchaseToken) return { ok: true, ignored: true };
  const subscription = await fetchPlaySubscription(env, purchaseToken);
  if (!subscription) return { ok: false, reason: "play_not_verified" };
  const assessed = assessPlaySubscription({ ...subscription, purchaseToken }, nowMs);
  const email = await emailForAccountToken(env, assessed.accountToken) || normalizeEmail(await env.CHATGPT_KV.get(`play-token:${purchaseToken}`));
  if (!email) {
    await env.CHATGPT_KV.put(`play-pending:${purchaseToken}`, JSON.stringify(assessed));
    return { ok: true, pending: true };
  }
  await env.CHATGPT_KV.put(`play-token:${purchaseToken}`, email);
  const saved = await grantStoreSource(env, email, "google", assessed, nowMs);
  return { ok: saved.ok, email, plan: saved.record?.plan || "" };
}
__name(applyGoogleNotification, "applyGoogleNotification");
async function handleStoreBillingRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/billing/apple/notifications" && request.method === "POST") {
    if (!storeWebhookAuthorized(request, env)) return json2({ ok: false, reason: "invalid_signature" }, 401);
    const body = await request.json().catch(() => null);
    const result = await applyAppleNotification(env, body);
    return json2(result, result.ok ? 200 : 400);
  }
  if (url.pathname === "/billing/google/notifications" && request.method === "POST") {
    if (!storeWebhookAuthorized(request, env)) return json2({ ok: false, reason: "invalid_signature" }, 401);
    const body = await request.json().catch(() => null);
    const result = await applyGoogleNotification(env, body);
    return json2(result, result.ok ? 200 : 400);
  }
  if (url.pathname === "/internal/entitlement" && request.method === "GET") {
    return readInternalEntitlement(request, env);
  }
  if (url.pathname === "/internal/entitlement" && request.method === "POST") {
    return writeInternalEntitlement(request, env);
  }
  return null;
}
__name(handleStoreBillingRequest, "handleStoreBillingRequest");
function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}
__name(bearerToken, "bearerToken");
function internalAuthorized(request, env) {
  return Boolean(env.INTERNAL_ENTITLEMENT_TOKEN) && timingSafeEqual(bearerToken(request), env.INTERNAL_ENTITLEMENT_TOKEN);
}
__name(internalAuthorized, "internalAuthorized");
async function readInternalEntitlement(request, env) {
  if (!internalAuthorized(request, env)) return json2({ ok: false, reason: "unauthorized" }, 401);
  const email = normalizeEmail(new URL(request.url).searchParams.get("email"));
  if (!email || !env.CHATGPT_KV) return json2({ ok: false, reason: "invalid_email" }, 400);
  const raw = await env.CHATGPT_KV.get(`entitlement:${email}`);
  return json2({ ok: true, email, entitlement: raw ? JSON.parse(raw) : null });
}
__name(readInternalEntitlement, "readInternalEntitlement");
async function writeInternalEntitlement(request, env) {
  if (!internalAuthorized(request, env)) return json2({ ok: false, reason: "unauthorized" }, 401);
  const body = await request.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  if (!email || !env.CHATGPT_KV || !body?.entitlement) return json2({ ok: false, reason: "invalid_email" }, 400);
  const record = { ...body.entitlement, email };
  await env.CHATGPT_KV.put(`entitlement:${email}`, JSON.stringify(record));
  await rememberStoreAccount(env, email);
  return json2({ ok: true, email, plan: record.plan || "" });
}
__name(writeInternalEntitlement, "writeInternalEntitlement");
function json2(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
__name(json2, "json");

// src/mail/providers.js
var GMAIL_SCOPES = Object.freeze([
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send"
]);
var PRESETS = {
  icloud: { smtp: { host: "smtp.mail.me.com", port: 587, tls: "starttls" }, imap: { host: "imap.mail.me.com", port: 993 } },
  microsoft: { smtp: { host: "smtp.office365.com", port: 587, tls: "starttls" }, imap: { host: "outlook.office365.com", port: 993 } },
  yahoojp: { smtp: { host: "smtp.mail.yahoo.co.jp", port: 465, tls: "on" }, imap: { host: "imap.mail.yahoo.co.jp", port: 993 } },
  yahoo: { smtp: { host: "smtp.mail.yahoo.com", port: 465, tls: "on" }, imap: { host: "imap.mail.yahoo.com", port: 993 } },
  docomo: { smtp: { host: "smtp.spmode.ne.jp", port: 465, tls: "on" }, imap: { host: "imap.spmode.ne.jp", port: 993 }, loginIsId: true },
  zoho: { smtp: { host: "smtp.zoho.com", port: 465, tls: "on" }, imap: { host: "imap.zoho.com", port: 993 } },
  isoftbank: { smtp: { host: "smtp.softbank.jp", port: 465, tls: "on" }, imap: { host: "imap.softbank.jp", port: 993 } },
  softbank: { smtp: { host: "smtp.softbank.ne.jp", port: 465, tls: "on" }, imap: { host: "imap.softbank.ne.jp", port: 993 } },
  ocn: { smtp: { host: "smtp.ocn.ne.jp", port: 465, tls: "on" }, imap: { host: "imap.ocn.ne.jp", port: 993 } },
  biglobe: { smtp: { host: "mail.biglobe.ne.jp", port: 465, tls: "on" }, imap: { host: "mail.biglobe.ne.jp", port: 993 } },
  sonet: { smtp: { host: "mail.so-net.ne.jp", port: 587, tls: "starttls" }, imap: { host: "imap.so-net.ne.jp", port: 993 } },
  nifty: { smtp: { host: "smtp.nifty.com", port: 465, tls: "on" }, imap: { host: "imap.nifty.com", port: 993 }, sentMailbox: "Sent" }
};
var LABELS = {
  gmail: "Gmail",
  workspace: "Google Workspace",
  microsoft: "Microsoft",
  icloud: "iCloud",
  yahoojp: "Yahoo!\u30E1\u30FC\u30EB",
  yahoo: "Yahoo",
  docomo: "\u30C9\u30B3\u30E2\u30E1\u30FC\u30EB",
  softbank: "\u30BD\u30D5\u30C8\u30D0\u30F3\u30AF",
  isoftbank: "E\u30E1\u30FC\u30EB(i)",
  au: "au",
  ocn: "OCN",
  biglobe: "BIGLOBE",
  sonet: "So-net",
  nifty: "@nifty",
  zoho: "Zoho",
  other: "\u30E1\u30FC\u30EB"
};
var PROVIDER_IDS = Object.freeze([
  "gmail",
  "workspace",
  "microsoft",
  "icloud",
  "yahoojp",
  "yahoo",
  "docomo",
  "softbank",
  "isoftbank",
  "au",
  "ocn",
  "biglobe",
  "sonet",
  "nifty",
  "zoho",
  "other"
]);
var DOMAIN_RULES = [
  [/^(gmail\.com|googlemail\.com)$/i, "gmail"],
  [/^(outlook|hotmail|live|msn)\.(com|jp|co\.jp)$/i, "microsoft"],
  [/^(icloud\.com|me\.com|mac\.com)$/i, "icloud"],
  [/^(yahoo\.co\.jp|ymail\.ne\.jp)$/i, "yahoojp"],
  [/^yahoo\.com$/i, "yahoo"],
  [/^docomo\.ne\.jp$/i, "docomo"],
  [/^i\.softbank\.jp$/i, "isoftbank"],
  [/^softbank\.ne\.jp$/i, "softbank"],
  [/^(au\.com|ezweb\.ne\.jp)$/i, "au"],
  [/^ocn\.ne\.jp$/i, "ocn"],
  [/^biglobe\.ne\.jp$/i, "biglobe"],
  [/^so-net\.ne\.jp$/i, "sonet"],
  [/^(nifty\.com|nifty\.ne\.jp)$/i, "nifty"],
  [/^(zoho\.com|zohomail\.com)$/i, "zoho"]
];
function providerLabel(id) {
  return LABELS[id] || LABELS.other;
}
__name(providerLabel, "providerLabel");
function sendPath(id, env = {}) {
  if (id === "gmail" || id === "workspace") return "google";
  if (id === "microsoft") {
    if (env.MS_OAUTH_ENABLED === "1" && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET) return "password";
    return "forward_only";
  }
  return "password";
}
__name(sendPath, "sendPath");
var WIRED_PROVIDERS = Object.freeze(
  PROVIDER_IDS.map(
    (id) => Object.freeze({
      id,
      label: providerLabel(id),
      inbound: true,
      outbound: id === "microsoft" ? false : true,
      path: id === "gmail" || id === "workspace" ? "google" : id === "microsoft" ? "forward_only" : "password",
      scopes: id === "gmail" || id === "workspace" ? GMAIL_SCOPES : Object.freeze([])
    })
  )
);
function domainOf(address) {
  const at = String(address || "").toLowerCase().lastIndexOf("@");
  if (at < 1) return "";
  return String(address).slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
}
__name(domainOf, "domainOf");
function providerOf(address) {
  const domain = domainOf(address);
  if (!domain) return "other";
  for (const [pattern, id] of DOMAIN_RULES) {
    if (pattern.test(domain)) return id;
  }
  return "other";
}
__name(providerOf, "providerOf");
function isHostname(value) {
  const host = String(value || "").trim().toLowerCase();
  if (!host || host.length > 253) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return false;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host);
}
__name(isHostname, "isHostname");
function validateServers(input) {
  const smtp = input?.smtp || {};
  const imap = input?.imap || {};
  const port = Number(smtp.port);
  const imapPort = Number(imap.port);
  if (!isHostname(smtp.host) || !isHostname(imap.host)) return { ok: false, reason: "invalid_server" };
  if (port !== 465 && port !== 587) return { ok: false, reason: "invalid_server" };
  if (imapPort !== 993) return { ok: false, reason: "invalid_server" };
  const tls = port === 587 ? "starttls" : "on";
  return {
    ok: true,
    smtp: { host: String(smtp.host).trim().toLowerCase(), port, tls },
    imap: { host: String(imap.host).trim().toLowerCase(), port: 993 },
    login: String(input.login || "").trim()
  };
}
__name(validateServers, "validateServers");
function serversFor(providerId, serversJson) {
  const preset = PRESETS[providerId];
  if (preset?.smtp) {
    return {
      ok: true,
      smtp: preset.smtp,
      imap: preset.imap,
      login: String(serversJson?.login || "").trim(),
      loginIsId: Boolean(preset.loginIsId),
      sentMailbox: preset.sentMailbox || ""
    };
  }
  return validateServers(serversJson);
}
__name(serversFor, "serversFor");
async function detectProvider(domain, fetchImpl = fetch) {
  const name = String(domain || "").trim().toLowerCase().replace(/\.$/, "");
  if (!isHostname(name)) return "other";
  try {
    const response = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=MX`, {
      headers: { accept: "application/dns-json" }
    });
    if (!response.ok) return "other";
    const json4 = await response.json();
    const data = (Array.isArray(json4.Answer) ? json4.Answer : []).map((answer) => String(answer.data || "").toLowerCase()).join(" ");
    if (data.includes("aspmx.l.google.com")) return "workspace";
    if (data.includes("mail.protection.outlook.com")) return "microsoft";
    if (/mx\d*\.mail\.icloud\.com/.test(data)) return "icloud";
    if (data.includes("zoho")) return "zoho";
  } catch {
    return "other";
  }
  return "other";
}
__name(detectProvider, "detectProvider");

// src/gmail.js
var LINEBOT_GOOGLE_CLIENT_ID = "899798982543-2jk3d2fp97c02js71opg7l1j9fa7oh5a.apps.googleusercontent.com";
var LINEBOT_GOOGLE_REDIRECT = "https://reply.kimitotalk.link/oauth/google/callback";
var TOKEN_URL2 = "https://oauth2.googleapis.com/token";
var AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
var SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
var USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
function gmailScopeString() {
  return GMAIL_SCOPES.join(" ");
}
__name(gmailScopeString, "gmailScopeString");
function googleRedirectUri(env) {
  return env.GOOGLE_REDIRECT_URI || LINEBOT_GOOGLE_REDIRECT;
}
__name(googleRedirectUri, "googleRedirectUri");
function googleClientId(env) {
  return env.GOOGLE_CLIENT_ID || LINEBOT_GOOGLE_CLIENT_ID;
}
__name(googleClientId, "googleClientId");
function buildGoogleAuthUrl(env, state) {
  const params = new URLSearchParams({
    client_id: googleClientId(env),
    redirect_uri: googleRedirectUri(env),
    response_type: "code",
    scope: gmailScopeString(),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state
  });
  return `${AUTH_URL}?${params.toString()}`;
}
__name(buildGoogleAuthUrl, "buildGoogleAuthUrl");
function accountKey(email) {
  return `gmail-account:${email}`;
}
__name(accountKey, "accountKey");
async function readGmailAccount(env, email) {
  if (!env.CHATGPT_KV || !email) return null;
  const raw = await env.CHATGPT_KV.get(accountKey(email));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.refreshToken ? parsed : null;
  } catch {
    return null;
  }
}
__name(readGmailAccount, "readGmailAccount");
async function readPrimaryGmailAccount(env) {
  if (!env.CHATGPT_KV) return null;
  const raw = await env.CHATGPT_KV.get("gmail-primary");
  if (!raw) return null;
  return readGmailAccount(env, raw);
}
__name(readPrimaryGmailAccount, "readPrimaryGmailAccount");
async function saveGmailAccount(env, account) {
  await env.CHATGPT_KV.put(accountKey(account.email), JSON.stringify(account));
  await env.CHATGPT_KV.put("gmail-primary", account.email);
}
__name(saveGmailAccount, "saveGmailAccount");
function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(base64Url, "base64Url");
function encodedHeader(value) {
  const bytes = new TextEncoder().encode(value);
  return `=?UTF-8?B?${base64Url(bytes)}?=`;
}
__name(encodedHeader, "encodedHeader");
function buildRawMessage({ from, to, cc, bcc, subject, body }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : "",
    bcc ? `Bcc: ${bcc}` : "",
    `Subject: ${encodedHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit"
  ].filter(Boolean);
  const raw = `${headers.join("\r\n")}\r
\r
${body || ""}`;
  return base64Url(new TextEncoder().encode(raw));
}
__name(buildRawMessage, "buildRawMessage");
async function refreshAccessToken(env, refreshToken, fetchImpl) {
  if (!env.GOOGLE_CLIENT_SECRET) return { ok: false, reason: "gmail_not_configured" };
  const response = await fetchImpl(TOKEN_URL2, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: googleClientId(env),
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const json4 = await response.json().catch(() => ({}));
  if (!response.ok || !json4.access_token) return { ok: false, reason: "gmail_refresh_failed" };
  return { ok: true, accessToken: json4.access_token };
}
__name(refreshAccessToken, "refreshAccessToken");
async function sendViaGmail(env, account, message, fetchImpl = fetch) {
  if (!account?.refreshToken) return { ok: false, reason: "gmail_not_connected", sent: false };
  if (gmailScopeString().includes("gmail.readonly") || gmailScopeString().includes("gmail.compose") || gmailScopeString().includes("gmail.modify")) {
    return { ok: false, reason: "scope_refused", sent: false };
  }
  const token2 = await refreshAccessToken(env, account.refreshToken, fetchImpl);
  if (!token2.ok) return { ok: false, reason: token2.reason, sent: false };
  const profile = await fetchImpl(USERINFO_URL, { headers: { authorization: `Bearer ${token2.accessToken}` } });
  const user = await profile.json().catch(() => ({}));
  const email = String(user.email || "").toLowerCase();
  const expected = String(message.expectedSender || account.email || "").toLowerCase();
  if (!profile.ok || !email || email !== expected) return { ok: false, reason: "sender_mismatch", sent: false };
  const raw = message.rfc822 ? base64Url(new TextEncoder().encode(message.rfc822)) : buildRawMessage({ ...message, from: email });
  const response = await fetchImpl(SEND_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${token2.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ raw })
  });
  if (!response.ok) return { ok: false, reason: "gmail_send_failed", sent: false };
  const json4 = await response.json().catch(() => ({}));
  return { ok: true, sent: true, provider: "gmail", messageId: message.messageId || json4.id || "", gmailId: json4.id || "" };
}
__name(sendViaGmail, "sendViaGmail");
async function exchangeGoogleCode(env, code, fetchImpl = fetch) {
  if (!env.GOOGLE_CLIENT_SECRET || !env.CHATGPT_KV) return { ok: false, reason: "gmail_not_configured" };
  const response = await fetchImpl(TOKEN_URL2, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: googleClientId(env),
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: googleRedirectUri(env)
    })
  });
  const json4 = await response.json().catch(() => ({}));
  if (!response.ok || !json4.refresh_token) return { ok: false, reason: "gmail_code_rejected" };
  const profile = await fetchImpl(USERINFO_URL, { headers: { authorization: `Bearer ${json4.access_token}` } });
  const user = await profile.json().catch(() => ({}));
  const email = String(user.email || "").toLowerCase();
  if (!profile.ok || !email) return { ok: false, reason: "gmail_profile_failed" };
  if (env.ALLOWED_GMAIL && !timingSafeEqual(email, String(env.ALLOWED_GMAIL).toLowerCase())) {
    return { ok: false, reason: "gmail_account_rejected" };
  }
  let provider = providerOf(email);
  if (provider === "other") provider = await detectProvider(domainOf(email), fetchImpl);
  if (provider !== "gmail" && provider !== "workspace") provider = "workspace";
  await saveGmailAccount(env, { email, refreshToken: json4.refresh_token, provider });
  return { ok: true, email };
}
__name(exchangeGoogleCode, "exchangeGoogleCode");

// src/compose.js
async function digest(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(digest, "digest");
function replySubject(subject) {
  const value = clip(subject, 200);
  if (!value) return "\u8FD4\u4FE1";
  if (/^re\s*:/i.test(value)) return value;
  return `Re: ${value}`.slice(0, 200);
}
__name(replySubject, "replySubject");
function resolveRecipient(input = {}, reference = {}) {
  const direct = normalizeEmail(input.to || input.recipient || "");
  if (direct) return direct;
  const sender = normalizeEmail(input.sender || "");
  if (sender) return sender;
  const previous = normalizeEmail(reference.sender || "");
  return previous;
}
__name(resolveRecipient, "resolveRecipient");
function buildCompose(input = {}, reference = {}) {
  return {
    from: normalizeEmail(input.from || ""),
    provider: "",
    providerLabel: "",
    linked: false,
    connectUrl: "",
    transport: "",
    to: resolveRecipient(input, reference),
    cc: normalizeEmail(input.cc || ""),
    bcc: normalizeEmail(input.bcc || ""),
    subject: replySubject(input.subject),
    body: "",
    incomingId: clip(input.incomingId, 80),
    threadId: clip(input.incomingId, 80)
  };
}
__name(buildCompose, "buildCompose");
function fallbackText(payload = {}) {
  const compose = payload.compose || {};
  const who = compose.linked === false ? "\u672A\u9023\u643A" : compose.providerLabel ? `${compose.providerLabel} \xB7 ${compose.from || ""}` : compose.from || "";
  const lines = [
    payload.sent === true ? "\u9001\u4FE1\u3057\u307E\u3057\u305F\u3002" : "\u3053\u306E\u30E1\u30FC\u30EB\u306F\u672A\u9001\u4FE1\u3067\u3059\u3002",
    `\u5DEE\u51FA\u4EBA: ${who}`,
    `\u5B9B\u5148: ${compose.to || ""}`,
    compose.cc ? `Cc: ${compose.cc}` : "",
    compose.bcc ? `Bcc: ${compose.bcc}` : "",
    `\u4EF6\u540D: ${compose.subject || ""}`,
    "\u672C\u6587:",
    compose.body || "",
    "\u5019\u88DC:"
  ];
  for (const candidate of payload.candidates || []) {
    const emotion = candidate.emotion || {};
    lines.push(`- ${candidate.label || ""}\uFF08${emotion.category || ""} ${emotion.score ?? ""}\uFF09${candidate.text || ""}`);
  }
  if (payload.reason) lines.push(`\u7406\u7531: ${payload.reason}`);
  return lines.filter((line) => line !== "").join("\n");
}
__name(fallbackText, "fallbackText");
function compareSendState(snapshot, thread, request = {}) {
  if (!snapshot || snapshot.sendNonce !== request.sendNonce) return { ok: false, reason: "approval_required" };
  if (request.userApproved !== true) return { ok: false, reason: "approval_required" };
  if (!snapshot.threadId) return { ok: false, reason: "thread_required" };
  if (!thread || thread.id !== snapshot.threadId) return { ok: false, reason: "state_mismatch" };
  const hash = thread.recipient_hash || thread.hash || "";
  const savedHash = snapshot.threadHash || snapshot.incomingHash || "";
  if (hash !== savedHash && request.reconfirmed !== true) return { ok: false, reason: "state_mismatch" };
  const recipients = {
    to: thread.reply_to_address || thread.from_address || thread.to || "",
    cc: thread.cc_address || "",
    bcc: thread.bcc_address || ""
  };
  const typedSame = String(request.to || "") === recipients.to && String(request.cc || "") === recipients.cc && String(request.bcc || "") === recipients.bcc;
  const draftSame = String(request.subject || "") === String(snapshot.subject || "") && String(request.body || "") === String(snapshot.body || "");
  if ((!typedSame || !draftSame) && request.reconfirmed !== true) return { ok: false, reason: "state_mismatch" };
  return { ok: true };
}
__name(compareSendState, "compareSendState");

// src/mail/threads.js
var INDEX_KEY = "email-thread-index";
function threadKey(id) {
  return `email-thread:${id}`;
}
__name(threadKey, "threadKey");
function messageKey(messageId) {
  return `email-thread-msgid:${messageId}`;
}
__name(messageKey, "messageKey");
function addressList(value) {
  const parts = String(value || "").split(/[,;]/);
  const emails = [];
  for (const part of parts) {
    const angled = part.match(/<([^>]+)>/);
    const email = normalizeEmail(angled ? angled[1] : part);
    if (email && !emails.includes(email)) emails.push(email);
  }
  return emails.join(", ");
}
__name(addressList, "addressList");
function threadRecipients(thread) {
  if (!thread) return { to: "", cc: "", bcc: "" };
  return {
    to: thread.reply_to_address || thread.from_address || "",
    cc: thread.cc_address || "",
    bcc: thread.bcc_address || ""
  };
}
__name(threadRecipients, "threadRecipients");
async function recipientHash(thread) {
  return digest(
    [
      thread.reply_to_address || "",
      thread.from_address || "",
      thread.to_address || "",
      thread.cc_address || "",
      thread.bcc_address || "",
      thread.message_id || ""
    ].join("\n")
  );
}
__name(recipientHash, "recipientHash");
async function getEmailThread(env, id) {
  if (!env.CHATGPT_KV || !id) return null;
  const raw = await env.CHATGPT_KV.get(threadKey(clip(id, 80)));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}
__name(getEmailThread, "getEmailThread");
async function threadByMessageId(env, messageId) {
  if (!env.CHATGPT_KV || !messageId) return null;
  const id = await env.CHATGPT_KV.get(messageKey(messageId));
  if (!id) return null;
  return getEmailThread(env, id);
}
__name(threadByMessageId, "threadByMessageId");
async function recordEmailThread(env, fields) {
  if (!env.CHATGPT_KV) return { ok: false, reason: "storage_not_configured" };
  const messageId = clip(fields.message_id, 300);
  if (!messageId) return { ok: false, reason: "invalid_incoming" };
  const existingId = await env.CHATGPT_KV.get(messageKey(messageId));
  if (existingId) {
    const existing = await getEmailThread(env, existingId);
    return { ok: true, duplicate: true, item: existing };
  }
  const thread = {
    id: crypto.randomUUID(),
    message_id: messageId,
    reply_to_address: addressList(fields.reply_to_address),
    from_address: normalizeEmail(fields.from_address),
    to_address: addressList(fields.to_address),
    cc_address: addressList(fields.cc_address),
    bcc_address: addressList(fields.bcc_address),
    subject: clip(fields.subject, 200),
    in_reply_to: clip(fields.in_reply_to, 500),
    reference_ids: clip(fields.reference_ids, 2e3),
    quote_text: clip(fields.quote_text, 280),
    received_at: Number(fields.received_at) || Date.now(),
    owner: normalizeEmail(fields.owner) || ""
  };
  if (!thread.from_address && !thread.reply_to_address) return { ok: false, reason: "invalid_incoming" };
  thread.recipient_hash = await recipientHash(thread);
  await env.CHATGPT_KV.put(threadKey(thread.id), JSON.stringify(thread));
  await env.CHATGPT_KV.put(messageKey(messageId), thread.id);
  const rawIndex = await env.CHATGPT_KV.get(INDEX_KEY);
  let index = [];
  try {
    index = JSON.parse(rawIndex || "[]");
  } catch {
    index = [];
  }
  if (!Array.isArray(index)) index = [];
  await env.CHATGPT_KV.put(INDEX_KEY, JSON.stringify([thread.id, ...index.filter((id) => id !== thread.id)].slice(0, 50)));
  return { ok: true, item: thread };
}
__name(recordEmailThread, "recordEmailThread");
async function listEmailThreads(env) {
  if (!env.CHATGPT_KV) return [];
  const raw = await env.CHATGPT_KV.get(INDEX_KEY);
  let index = [];
  try {
    index = JSON.parse(raw || "[]");
  } catch {
    index = [];
  }
  const items = [];
  for (const id of Array.isArray(index) ? index : []) {
    const thread = await getEmailThread(env, id);
    if (thread) items.push(thread);
  }
  return items;
}
__name(listEmailThreads, "listEmailThreads");
async function markThreadAnswered(env, messageId, at = Date.now()) {
  const thread = await threadByMessageId(env, messageId);
  if (!thread) return { ok: false };
  thread.answered_at = at;
  await env.CHATGPT_KV.put(threadKey(thread.id), JSON.stringify(thread));
  return { ok: true, item: thread };
}
__name(markThreadAnswered, "markThreadAnswered");
async function markAnsweredFromHeaders(env, headerText) {
  const lines = String(headerText || "").split(/\r?\n/);
  let marked = 0;
  for (const line of lines) {
    const match = line.match(/^\s*in-reply-to:\s*(.+)$/i);
    if (!match) continue;
    for (const token2 of match[1].split(/\s+/)) {
      const id = token2.trim();
      if (!id) continue;
      const saved = await markThreadAnswered(env, id);
      if (saved.ok) marked += 1;
    }
  }
  return { ok: true, marked };
}
__name(markAnsweredFromHeaders, "markAnsweredFromHeaders");

// src/incoming.js
function adapt(thread) {
  if (!thread) return null;
  return {
    ...thread,
    provider: "email_routing",
    from: thread.from_address,
    to: thread.reply_to_address || thread.from_address,
    body: thread.quote_text || "",
    hash: thread.recipient_hash,
    receivedAt: thread.received_at
  };
}
__name(adapt, "adapt");
async function saveIncoming(env, input = {}) {
  const from = input.from || input.sender || "";
  const quote = clip(input.quote_text || input.body || input.text || "", 280);
  if (!from || !quote) return { ok: false, reason: "invalid_incoming" };
  const messageId = clip(input.message_id || input.messageId, 300) || `<${crypto.randomUUID()}@forward.kimitotalk.link>`;
  const saved = await recordEmailThread(env, {
    message_id: messageId,
    reply_to_address: input.reply_to || input.replyTo || from,
    from_address: from,
    to_address: input.to || "",
    cc_address: input.cc || "",
    bcc_address: input.bcc || "",
    subject: input.subject,
    in_reply_to: input.in_reply_to || input.inReplyTo || "",
    reference_ids: input.reference_ids || input.references || "",
    quote_text: quote,
    received_at: input.receivedAt,
    owner: input.owner || ""
  });
  if (!saved.ok) return saved;
  return { ok: true, duplicate: Boolean(saved.duplicate), item: adapt(saved.item) };
}
__name(saveIncoming, "saveIncoming");
async function getIncoming(env, id) {
  return adapt(await getEmailThread(env, id));
}
__name(getIncoming, "getIncoming");
async function listIncoming(env) {
  if (!env.CHATGPT_KV) return { ok: false, reason: "storage_not_configured", items: [] };
  const items = [];
  for (const thread of await listEmailThreads(env)) items.push(adapt(thread));
  return { ok: true, items };
}
__name(listIncoming, "listIncoming");

// node_modules/postal-mime/dist/esm/decode-strings.js
var textEncoder = new TextEncoder();
var isWsp = /* @__PURE__ */ __name((c) => c === 32 || c === 9, "isWsp");
var base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var base64Lookup = new Uint8Array(256);
for (let i = 0; i < base64Chars.length; i++) {
  base64Lookup[base64Chars.charCodeAt(i)] = i;
}
function decodeBase64(base642) {
  let len = base642.length;
  while (len > 0 && base642.charAt(len - 1) === "=") {
    len--;
  }
  if (len % 4 === 1) {
    len--;
  }
  const remainder = len % 4;
  const bufferLength = Math.floor(len / 4) * 3 + (remainder ? remainder - 1 : 0);
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const bytes = new Uint8Array(arrayBuffer);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    let encoded1 = base64Lookup[base642.charCodeAt(i)];
    let encoded2 = base64Lookup[base642.charCodeAt(i + 1)];
    let encoded3 = base64Lookup[base642.charCodeAt(i + 2)];
    let encoded4 = base64Lookup[base642.charCodeAt(i + 3)];
    bytes[p++] = encoded1 << 2 | encoded2 >> 4;
    if (p < bufferLength) {
      bytes[p++] = (encoded2 & 15) << 4 | encoded3 >> 2;
    }
    if (p < bufferLength) {
      bytes[p++] = (encoded3 & 3) << 6 | encoded4 & 63;
    }
  }
  return arrayBuffer;
}
__name(decodeBase64, "decodeBase64");
var charsetAliases = /* @__PURE__ */ new Map([
  // Hebrew. The logical and explicit ordering variants share the iso-8859-8 index.
  ["iso88598i", "iso-8859-8"],
  ["iso88598e", "iso-8859-8"],
  // Japanese. WHATWG shift_jis is the Windows-31J index, so cp932 text decodes
  // identically, including the NEC and IBM extension rows.
  ["shiftjis", "shift_jis"],
  ["windows31j", "shift_jis"],
  ["mskanji", "shift_jis"],
  ["eucjp", "euc-jp"],
  // ISO-2022-JP, including the -1 / -2 supersets. Escape sequences outside plain
  // ISO-2022-JP (JIS X 0212, the non-Japanese G2 sets, and the SO/SI katakana shifts
  // cp50222 uses) decode to replacement characters, but the Japanese text around them
  // still comes out right.
  ["iso2022jp", "iso-2022-jp"],
  ["iso2022jp1", "iso-2022-jp"],
  ["iso2022jp2", "iso-2022-jp"],
  ["junet", "iso-2022-jp"],
  // Korean. The WHATWG euc-kr index is the extended cp949 / UHC index.
  ["euckr", "euc-kr"],
  ["uhc", "euc-kr"],
  // Thai.
  ["tis620", "windows-874"]
]);
var codePageAliases = /* @__PURE__ */ new Map([
  ["932", "shift_jis"],
  ["936", "gbk"],
  ["949", "euc-kr"],
  ["950", "big5"],
  ["874", "windows-874"],
  // Microsoft's EUC-JP and ISO-2022-JP variants. euc-jp and iso-2022-jp cover
  // everything they can express.
  ["51932", "euc-jp"],
  ["50220", "iso-2022-jp"],
  ["50221", "iso-2022-jp"],
  ["50222", "iso-2022-jp"]
]);
var codePagePattern = /^(?:cp|windows|ms|ibm)(\d+)$/;
function normalizeCharset(charset) {
  return charset.replace(/^(?:x-ms-|x-|cs)/, "").replace(/[\s._-]+/g, "");
}
__name(normalizeCharset, "normalizeCharset");
var ENCODING_LABELS = new Set([
  // UTF-8
  "unicode-1-1-utf-8 unicode11utf8 unicode20utf8 utf-8 utf8 x-unicode20utf8",
  // IBM866
  "866 cp866 csibm866 ibm866",
  // ISO-8859-2
  "csisolatin2 iso-8859-2 iso-ir-101 iso8859-2 iso88592 iso_8859-2 iso_8859-2:1987 l2 latin2",
  // ISO-8859-3
  "csisolatin3 iso-8859-3 iso-ir-109 iso8859-3 iso88593 iso_8859-3 iso_8859-3:1988 l3 latin3",
  // ISO-8859-4
  "csisolatin4 iso-8859-4 iso-ir-110 iso8859-4 iso88594 iso_8859-4 iso_8859-4:1988 l4 latin4",
  // ISO-8859-5
  "csisolatincyrillic cyrillic iso-8859-5 iso-ir-144 iso8859-5 iso88595 iso_8859-5 iso_8859-5:1988",
  // ISO-8859-6
  "arabic asmo-708 csiso88596e csiso88596i csisolatinarabic ecma-114 iso-8859-6 iso-8859-6-e",
  "iso-8859-6-i iso-ir-127 iso8859-6 iso88596 iso_8859-6 iso_8859-6:1987",
  // ISO-8859-7
  "csisolatingreek ecma-118 elot_928 greek greek8 iso-8859-7 iso-ir-126 iso8859-7 iso88597 iso_8859-7",
  "iso_8859-7:1987 sun_eu_greek",
  // ISO-8859-8
  "csiso88598e csisolatinhebrew hebrew iso-8859-8 iso-8859-8-e iso-ir-138 iso8859-8 iso88598 iso_8859-8",
  "iso_8859-8:1988 visual",
  // ISO-8859-8-I
  "csiso88598i iso-8859-8-i logical",
  // ISO-8859-10
  "csisolatin6 iso-8859-10 iso-ir-157 iso8859-10 iso885910 l6 latin6",
  // ISO-8859-13
  "iso-8859-13 iso8859-13 iso885913",
  // ISO-8859-14
  "iso-8859-14 iso8859-14 iso885914",
  // ISO-8859-15
  "csisolatin9 iso-8859-15 iso8859-15 iso885915 iso_8859-15 l9",
  // ISO-8859-16
  "iso-8859-16",
  // KOI8-R
  "cskoi8r koi koi8 koi8-r koi8_r",
  // KOI8-U
  "koi8-ru koi8-u",
  // macintosh
  "csmacintosh mac macintosh x-mac-roman",
  // windows-874
  "dos-874 iso-8859-11 iso8859-11 iso885911 tis-620 windows-874",
  // windows-1250
  "cp1250 windows-1250 x-cp1250",
  // windows-1251
  "cp1251 windows-1251 x-cp1251",
  // windows-1252
  "ansi_x3.4-1968 ascii cp1252 cp819 csisolatin1 ibm819 iso-8859-1 iso-ir-100 iso8859-1 iso88591",
  "iso_8859-1 iso_8859-1:1987 l1 latin1 us-ascii windows-1252 x-cp1252",
  // windows-1253
  "cp1253 windows-1253 x-cp1253",
  // windows-1254
  "cp1254 csisolatin5 iso-8859-9 iso-ir-148 iso8859-9 iso88599 iso_8859-9 iso_8859-9:1989 l5 latin5",
  "windows-1254 x-cp1254",
  // windows-1255
  "cp1255 windows-1255 x-cp1255",
  // windows-1256
  "cp1256 windows-1256 x-cp1256",
  // windows-1257
  "cp1257 windows-1257 x-cp1257",
  // windows-1258
  "cp1258 windows-1258 x-cp1258",
  // x-mac-cyrillic
  "x-mac-cyrillic x-mac-ukrainian",
  // GBK
  "chinese csgb2312 csiso58gb231280 gb2312 gb_2312 gb_2312-80 gbk iso-ir-58 x-gbk",
  // gb18030
  "gb18030",
  // Big5
  "big5 big5-hkscs cn-big5 csbig5 x-x-big5",
  // EUC-JP
  "cseucpkdfmtjapanese euc-jp x-euc-jp",
  // ISO-2022-JP
  "csiso2022jp iso-2022-jp",
  // Shift_JIS
  "csshiftjis ms932 ms_kanji shift-jis shift_jis sjis windows-31j x-sjis",
  // EUC-KR
  "cseuckr csksc56011987 euc-kr iso-ir-149 korean ks_c_5601-1987 ks_c_5601-1989 ksc5601 ksc_5601",
  "windows-949",
  // replacement
  "csiso2022kr hz-gb-2312 iso-2022-cn iso-2022-cn-ext iso-2022-kr replacement",
  // x-user-defined
  "x-user-defined"
].join(" ").split(" "));
var REPLACEMENT_LABELS = /* @__PURE__ */ new Set([
  "csiso2022kr",
  "hz-gb-2312",
  "iso-2022-cn",
  "iso-2022-cn-ext",
  "iso-2022-kr",
  "replacement"
]);
var replacementDecoder = {
  encoding: "replacement",
  decode: /* @__PURE__ */ __name((input) => input && input.byteLength ? "\uFFFD" : "", "decode")
};
var UTF16_LABELS = /* @__PURE__ */ new Map([
  ["utf-16", "utf-16"],
  ["utf16", "utf-16"],
  ["utf_16", "utf-16"],
  ["utf-16le", "utf-16le"],
  ["utf-16be", "utf-16be"]
]);
function resolveLabel(charset) {
  charset = (charset || "utf8").trim().toLowerCase();
  if (ENCODING_LABELS.has(charset)) {
    return charset;
  }
  const utf16 = UTF16_LABELS.get(charset);
  if (utf16) {
    return utf16;
  }
  const normalized = normalizeCharset(charset);
  const codePage = normalized.match(codePagePattern);
  const alias = codePage && codePageAliases.get(codePage[1]) || charsetAliases.get(normalized) || normalized;
  return ENCODING_LABELS.has(alias) ? alias : null;
}
__name(resolveLabel, "resolveLabel");
var decoders = /* @__PURE__ */ new Map();
function tryDecoder(label) {
  if (REPLACEMENT_LABELS.has(label)) {
    return replacementDecoder;
  }
  let decoder = decoders.get(label);
  if (decoder === void 0) {
    decoder = null;
    try {
      decoder = new TextDecoder(label);
    } catch {
    }
    decoders.set(label, decoder);
  }
  return decoder;
}
__name(tryDecoder, "tryDecoder");
var utf8Decoder = new TextDecoder();
function findDecoder(charset) {
  const label = resolveLabel(charset);
  return label ? tryDecoder(label) : null;
}
__name(findDecoder, "findDecoder");
function getDecoder(charset) {
  return findDecoder(charset) || tryDecoder("windows-1252") || utf8Decoder;
}
__name(getDecoder, "getDecoder");
var UTF16_ENCODINGS = /* @__PURE__ */ new Set(["utf-16le", "utf-16be"]);
var UTF16_UNORDERED_LABELS = /* @__PURE__ */ new Set(["utf-16"]);
function bomByteOrder(bytes) {
  if (bytes[0] === 254 && bytes[1] === 255) {
    return "utf-16be";
  }
  if (bytes[0] === 255 && bytes[1] === 254) {
    return "utf-16le";
  }
  return null;
}
__name(bomByteOrder, "bomByteOrder");
function isUtf8(bytes) {
  for (let i = 0; i < bytes.length; ) {
    const lead = bytes[i];
    if (lead < 128) {
      i++;
      continue;
    }
    let count;
    if (lead >= 194 && lead <= 223) {
      count = 1;
    } else if (lead >= 224 && lead <= 239) {
      count = 2;
    } else if (lead >= 240 && lead <= 244) {
      count = 3;
    } else {
      return false;
    }
    if (i + count >= bytes.length) {
      return false;
    }
    const second = bytes[i + 1];
    const min = lead === 224 ? 160 : lead === 240 ? 144 : 128;
    const max = lead === 237 ? 159 : lead === 244 ? 143 : 191;
    if (second < min || second > max) {
      return false;
    }
    for (let k = 2; k <= count; k++) {
      if ((bytes[i + k] & 192) !== 128) {
        return false;
      }
    }
    i += count + 1;
  }
  return true;
}
__name(isUtf8, "isUtf8");
function decodeUtf8OrWindows1252(bytes, utf8 = utf8Decoder) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return isUtf8(view) ? utf8.decode(view) : getDecoder("windows-1252").decode(view);
}
__name(decodeUtf8OrWindows1252, "decodeUtf8OrWindows1252");
function decodeCharset(bytes, charset) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const label = resolveLabel(charset);
  let decoder = label ? tryDecoder(label) : null;
  if (label && UTF16_UNORDERED_LABELS.has(label)) {
    const order = bomByteOrder(view);
    decoder = order && tryDecoder(order) || decoder;
  }
  return decoder ? decoder.decode(view) : decodeUtf8OrWindows1252(view);
}
__name(decodeCharset, "decodeCharset");
var META_PRESCAN_BYTES = 1024;
var CHARSET_ATTRIBUTE = /charset\s*=\s*["']?\s*([^\s"';>]+)/;
function sniffHtmlCharset(bytes) {
  const head = utf8Decoder.decode(bytes.subarray(0, META_PRESCAN_BYTES)).toLowerCase();
  let pos = 0;
  while ((pos = head.indexOf("<meta", pos)) >= 0) {
    let end = head.indexOf(">", pos);
    if (end < 0) {
      end = head.length;
    }
    const match = CHARSET_ATTRIBUTE.exec(head.slice(pos, end));
    if (match) {
      return match[1];
    }
    pos = end;
  }
  return null;
}
__name(sniffHtmlCharset, "sniffHtmlCharset");
function decodeText(bytes, charset, html) {
  const view = new Uint8Array(bytes);
  if (charset) {
    return decodeCharset(view, charset);
  }
  const sniffed = html ? sniffHtmlCharset(view) : null;
  const decoder = sniffed ? findDecoder(sniffed) : null;
  if (!decoder || UTF16_ENCODINGS.has(decoder.encoding)) {
    return decodeUtf8OrWindows1252(view);
  }
  return (decoder.encoding === "x-user-defined" ? getDecoder("windows-1252") : decoder).decode(view);
}
__name(decodeText, "decodeText");
async function blobToArrayBuffer(blob) {
  if ("arrayBuffer" in blob) {
    return await blob.arrayBuffer();
  }
  const fr = new FileReader();
  return new Promise((resolve, reject) => {
    fr.onload = () => {
      resolve(fr.result);
    };
    fr.onerror = () => {
      reject(fr.error);
    };
    fr.readAsArrayBuffer(blob);
  });
}
__name(blobToArrayBuffer, "blobToArrayBuffer");
function hexNibble(c) {
  if (c >= 48 && c <= 57) {
    return c - 48;
  }
  if (c >= 97 && c <= 102) {
    return c - 97 + 10;
  }
  if (c >= 65 && c <= 70) {
    return c - 65 + 10;
  }
  return -1;
}
__name(hexNibble, "hexNibble");
function foldLineBreaks(str) {
  return str.replace(/[\r\n]+/g, " ");
}
__name(foldLineBreaks, "foldLineBreaks");
function decodeWord(charset, encoding, str) {
  let splitPos = charset.indexOf("*");
  if (splitPos >= 0) {
    charset = charset.slice(0, splitPos);
  }
  encoding = encoding.toUpperCase();
  let byteStr;
  if (encoding === "Q") {
    str = str.replace(/=\s+([0-9a-fA-F])/g, "=$1").replace(/[_\s]/g, " ");
    let buf = textEncoder.encode(str);
    let encodedBytes = [];
    for (let i = 0, len = buf.length; i < len; i++) {
      let c = buf[i];
      if (i <= len - 2 && c === 61) {
        let high = hexNibble(buf[i + 1]);
        let low = hexNibble(buf[i + 2]);
        if (high >= 0 && low >= 0) {
          encodedBytes.push(high << 4 | low);
          i += 2;
          continue;
        }
      }
      encodedBytes.push(c);
    }
    byteStr = new ArrayBuffer(encodedBytes.length);
    let dataView = new DataView(byteStr);
    for (let i = 0, len = encodedBytes.length; i < len; i++) {
      dataView.setUint8(i, encodedBytes[i]);
    }
  } else if (encoding === "B") {
    byteStr = decodeBase64(str.replace(/[^a-zA-Z0-9\+\/=]+/g, ""));
  } else {
    byteStr = textEncoder.encode(str);
  }
  return foldLineBreaks(decodeCharset(byteStr, charset));
}
__name(decodeWord, "decodeWord");
var ENCODED_WORD_PATTERN = "=\\?([^?\\s]+)\\?([QqBb])\\?([^?]*)\\?=";
var ENCODED_WORD_REGEX = new RegExp(ENCODED_WORD_PATTERN, "g");
var WORD_SEPARATOR_REGEX = /^[ \t\r\n]+$/;
var ENCODED_WORDS_ONLY_REGEX = new RegExp(`^(?:${ENCODED_WORD_PATTERN}\\s*)+$`);
function isEncodedWordsOnly(str) {
  return ENCODED_WORDS_ONLY_REGEX.test(str);
}
__name(isEncodedWordsOnly, "isEncodedWordsOnly");
function splitEncodedWords(str) {
  const tokens = [];
  ENCODED_WORD_REGEX.lastIndex = 0;
  let pos = 0;
  let match;
  while (match = ENCODED_WORD_REGEX.exec(str)) {
    if (match.index > pos) {
      tokens.push({ text: str.substring(pos, match.index) });
    }
    tokens.push({ charset: match[1], encoding: match[2], encodedText: match[3] });
    pos = match.index + match[0].length;
  }
  if (pos < str.length) {
    tokens.push({ text: str.substring(pos) });
  }
  return tokens;
}
__name(splitEncodedWords, "splitEncodedWords");
function canJoinWords(left, right) {
  const encoding = left.encoding.toUpperCase();
  if (left.charset !== right.charset || encoding !== right.encoding.toUpperCase()) {
    return false;
  }
  if (encoding === "B") {
    return left.encodedText.length % 4 === 0 && !left.padded;
  }
  return true;
}
__name(canJoinWords, "canJoinWords");
function renderTokens(tokens, joinWords) {
  let result = "";
  let pending = null;
  for (let i = 0; i < tokens.length; i++) {
    const token2 = tokens[i];
    if (token2.text !== void 0) {
      const nextToken = tokens[i + 1];
      if (pending && nextToken && nextToken.text === void 0 && WORD_SEPARATOR_REGEX.test(token2.text)) {
        continue;
      }
      if (pending) {
        result += decodeWord(pending.charset, pending.encoding, pending.encodedText);
        pending = null;
      }
      result += token2.text;
      continue;
    }
    if (pending && joinWords && canJoinWords(pending, token2)) {
      pending.encodedText += token2.encodedText;
      pending.padded = token2.encodedText.endsWith("=");
      continue;
    }
    if (pending) {
      result += decodeWord(pending.charset, pending.encoding, pending.encodedText);
    }
    pending = {
      charset: token2.charset,
      encoding: token2.encoding,
      encodedText: token2.encodedText,
      padded: token2.encodedText.endsWith("=")
    };
  }
  if (pending) {
    result += decodeWord(pending.charset, pending.encoding, pending.encodedText);
  }
  return result;
}
__name(renderTokens, "renderTokens");
function decodeWords(str) {
  const tokens = splitEncodedWords((str || "").toString());
  const result = renderTokens(tokens, true);
  return result.indexOf("\uFFFD") < 0 ? result : renderTokens(tokens, false);
}
__name(decodeWords, "decodeWords");
function decodeURIComponentWithCharset(encodedStr, charset) {
  charset = charset || "utf-8";
  let encodedBytes = [];
  for (let i = 0; i < encodedStr.length; i++) {
    let c = encodedStr.charAt(i);
    const high = c === "%" ? hexNibble(encodedStr.charCodeAt(i + 1)) : -1;
    const low = high >= 0 ? hexNibble(encodedStr.charCodeAt(i + 2)) : -1;
    if (low >= 0) {
      encodedBytes.push(high << 4 | low);
      i += 2;
    } else if (c.charCodeAt(0) > 126) {
      const bytes = textEncoder.encode(c);
      for (let j = 0; j < bytes.length; j++) {
        encodedBytes.push(bytes[j]);
      }
    } else {
      encodedBytes.push(c.charCodeAt(0));
    }
  }
  const byteStr = new ArrayBuffer(encodedBytes.length);
  const dataView = new DataView(byteStr);
  for (let i = 0, len = encodedBytes.length; i < len; i++) {
    dataView.setUint8(i, encodedBytes[i]);
  }
  return decodeCharset(byteStr, charset);
}
__name(decodeURIComponentWithCharset, "decodeURIComponentWithCharset");
function decodeParameterValueContinuations(header) {
  let paramKeys = /* @__PURE__ */ new Map();
  Object.keys(header.params).forEach((key) => {
    let match = key.match(/\*((\d+)\*?)?$/);
    if (!match) {
      return;
    }
    let actualKey = key.slice(0, match.index).toLowerCase();
    let nr = Number(match[2]) || 0;
    let paramVal = paramKeys.get(actualKey);
    if (!paramVal) {
      paramVal = {
        charset: null,
        values: []
      };
      paramKeys.set(actualKey, paramVal);
    }
    let value = header.params[key];
    let encoded = match[0].charAt(match[0].length - 1) === "*";
    if (nr === 0 && encoded && (match = value.match(/^([^']*)'[^']*'(.*)$/))) {
      paramVal.charset = match[1] || "utf-8";
      value = match[2];
    }
    paramVal.values.push({ nr, value, encoded });
    delete header.params[key];
  });
  paramKeys.forEach((paramVal, key) => {
    if (Object.prototype.hasOwnProperty.call(header.params, key)) {
      return;
    }
    let result = "";
    let pending = "";
    for (let part of paramVal.values.sort((a, b) => a.nr - b.nr)) {
      if (part.encoded) {
        pending += part.value;
        continue;
      }
      if (pending) {
        result += decodeURIComponentWithCharset(pending, paramVal.charset);
        pending = "";
      }
      result += part.value;
    }
    if (pending) {
      result += decodeURIComponentWithCharset(pending, paramVal.charset);
    }
    header.params[key] = result;
  });
}
__name(decodeParameterValueContinuations, "decodeParameterValueContinuations");

// node_modules/postal-mime/dist/esm/pass-through-decoder.js
var PassThroughDecoder = class {
  static {
    __name(this, "PassThroughDecoder");
  }
  constructor() {
    this.chunks = [];
    this.runBuffer = null;
    this.runStart = 0;
    this.runEnd = 0;
    this.pendingLineBreak = null;
  }
  // Whether the bytes sit in the run's buffer right at the end of the run
  continuesRun(bytes) {
    return bytes.buffer === this.runBuffer && bytes.byteOffset === this.runEnd;
  }
  flushRun() {
    if (this.runBuffer && this.runEnd > this.runStart) {
      this.chunks.push(new Uint8Array(this.runBuffer, this.runStart, this.runEnd - this.runStart));
    }
    this.runBuffer = null;
  }
  update(line, lineBreak) {
    const pending = this.pendingLineBreak;
    if (pending && this.continuesRun(pending) && line.buffer === this.runBuffer && line.byteOffset === this.runEnd + pending.byteLength) {
      this.runEnd = line.byteOffset + line.byteLength;
    } else {
      this.flushRun();
      if (pending) {
        this.chunks.push(pending);
      }
      this.runBuffer = line.buffer;
      this.runStart = line.byteOffset;
      this.runEnd = line.byteOffset + line.byteLength;
    }
    this.pendingLineBreak = lineBreak;
  }
  // A part ended by the end of the message has no boundary to own its final line
  // break, so there it stays content
  finalize(boundaryEnded = false) {
    const pending = this.pendingLineBreak;
    if (!boundaryEnded && pending) {
      if (this.continuesRun(pending)) {
        this.runEnd += pending.byteLength;
      } else {
        this.flushRun();
        this.chunks.push(pending);
      }
    }
    this.flushRun();
    return blobToArrayBuffer(new Blob(this.chunks, { type: "application/octet-stream" }));
  }
};

// node_modules/postal-mime/dist/esm/chunk-writer.js
var ChunkWriter = class {
  static {
    __name(this, "ChunkWriter");
  }
  constructor(maxChunkSize = 100 * 1024) {
    this.maxChunkSize = maxChunkSize;
    this.buffer = null;
    this.bufferPos = 0;
    this.chunks = [];
  }
  writeByte(byte) {
    if (!this.buffer || this.bufferPos >= this.buffer.length) {
      this.flush();
      this.buffer ??= new Uint8Array(this.maxChunkSize);
    }
    this.buffer[this.bufferPos++] = byte;
  }
  // Copied in runs rather than a byte at a time
  writeBytes(bytes, start = 0, end = bytes.length) {
    while (start < end) {
      if (!this.buffer || this.bufferPos >= this.buffer.length) {
        this.flush();
        this.buffer ??= new Uint8Array(this.maxChunkSize);
      }
      const count = Math.min(end - start, this.buffer.length - this.bufferPos);
      this.buffer.set(bytes.subarray(start, start + count), this.bufferPos);
      this.bufferPos += count;
      start += count;
    }
  }
  /**
   * Keeps a buffer the caller hands over and will not touch again. A large one is kept as
   * a chunk of its own instead of being copied, a small one is copied like any other write.
   */
  append(bytes) {
    if (bytes.length >= this.maxChunkSize / 2) {
      this.flush();
      this.chunks.push(bytes);
    } else {
      this.writeBytes(bytes);
    }
  }
  flush() {
    if (this.buffer && this.bufferPos) {
      this.chunks.push(this.buffer.slice(0, this.bufferPos));
      this.bufferPos = 0;
    }
  }
  finalize() {
    this.flush();
    return blobToArrayBuffer(new Blob(this.chunks, { type: "application/octet-stream" }));
  }
};

// node_modules/postal-mime/dist/esm/base64-decoder.js
var Base64Decoder = class {
  static {
    __name(this, "Base64Decoder");
  }
  constructor(opts) {
    opts = opts || {};
    this.decoder = opts.decoder || new TextDecoder();
    this.maxChunkSize = 100 * 1024;
    this.output = new ChunkWriter();
    this.remainder = "";
  }
  pushChunk(base64Str) {
    if (base64Str.length) {
      this.output.append(new Uint8Array(decodeBase64(base64Str)));
    }
  }
  flushRemainder() {
    this.pushChunk(this.remainder);
    this.remainder = "";
  }
  update(buffer) {
    let str = this.decoder.decode(buffer).replace(/[^a-zA-Z0-9+/=]+/g, "");
    let start = 0;
    let end;
    while ((end = str.indexOf("=", start)) >= 0) {
      this.remainder += str.substring(start, end);
      this.flushRemainder();
      start = end + 1;
    }
    this.remainder += str.substring(start);
    if (this.remainder.length >= this.maxChunkSize) {
      const alignedLength = Math.floor(this.remainder.length / 4) * 4;
      this.pushChunk(this.remainder.substring(0, alignedLength));
      this.remainder = this.remainder.substring(alignedLength);
    }
  }
  finalize() {
    this.flushRemainder();
    return this.output.finalize();
  }
};

// node_modules/postal-mime/dist/esm/qp-decoder.js
var CHR_EQUALS = 61;
var QPDecoder = class {
  static {
    __name(this, "QPDecoder");
  }
  constructor() {
    this.output = new ChunkWriter();
    this.pendingLineBreak = null;
  }
  writeLineBreak() {
    if (this.pendingLineBreak) {
      this.output.writeBytes(this.pendingLineBreak);
    }
  }
  // Quoted-printable source is 7 bit by definition, so it is decoded byte by byte and
  // the result is handed on as bytes. Running the body charset over the encoded source
  // instead corrupted every part whose charset was not ASCII compatible: the same
  // content that decoded correctly in base64 came out as mojibake in quoted-printable.
  //
  // As in PassThroughDecoder, a hard line break is only written once the next line
  // arrives, so the CRLF that belongs to a following boundary is not decoded as content,
  // and the break written is the one the line came with.
  update(line, lineBreak) {
    this.writeLineBreak();
    let len = line.length;
    while (len > 0 && isWsp(line[len - 1])) {
      len--;
    }
    const softBreak = len > 0 && line[len - 1] === CHR_EQUALS;
    if (softBreak) {
      len--;
    }
    let literalStart = 0;
    for (let i = 0; i < len; i++) {
      if (line[i] !== CHR_EQUALS || i + 2 >= len) {
        continue;
      }
      const high = hexNibble(line[i + 1]);
      const low = hexNibble(line[i + 2]);
      if (high < 0 || low < 0) {
        continue;
      }
      this.output.writeBytes(line, literalStart, i);
      this.output.writeByte(high << 4 | low);
      i += 2;
      literalStart = i + 1;
    }
    this.output.writeBytes(line, literalStart, len);
    this.pendingLineBreak = softBreak ? null : lineBreak;
  }
  // see PassThroughDecoder.finalize
  finalize(boundaryEnded = false) {
    if (!boundaryEnded) {
      this.writeLineBreak();
    }
    return this.output.finalize();
  }
};

// node_modules/postal-mime/dist/esm/errors.js
var ERROR_TYPES = {
  EINVALIDOPTION: TypeError,
  EINVALIDINPUT: TypeError,
  EPARSERREUSED: Error,
  EMAXNESTINGDEPTH: Error,
  EMAXHEADERSIZE: Error,
  EMAXPARTCOUNT: Error,
  EMAXFORWARDEDADDRESSES: Error
};
function createError(code, message) {
  const error = new ERROR_TYPES[code](message);
  error.code = code;
  return error;
}
__name(createError, "createError");

// node_modules/postal-mime/dist/esm/mime-node.js
var headerDecoder = new TextDecoder("utf-8", { ignoreBOM: true });
var FLOWED_JOIN_INTERVAL = 4096;
var HEADER_LINE_MIN_COST = 64;
var trimWsp = /* @__PURE__ */ __name((str) => {
  let start = 0;
  let end = str.length;
  while (start < end && isWsp(str.charCodeAt(start))) {
    start++;
  }
  while (end > start && isWsp(str.charCodeAt(end - 1))) {
    end--;
  }
  return str.slice(start, end);
}, "trimWsp");
var FIELD_START = /^(?:From |[!-9;-~]*[ \t]*:)/;
var CONTENT_HEADERS = /* @__PURE__ */ new Set([
  "content-type",
  "content-transfer-encoding",
  "content-disposition",
  "content-id",
  "content-description"
]);
var MimeNode = class {
  static {
    __name(this, "MimeNode");
  }
  constructor(options) {
    this.options = options;
    this.postalMime = options.postalMime;
    const limits = this.postalMime.limits;
    this.postalMime.counters.partCount++;
    if (this.postalMime.counters.partCount > limits.maxPartCount) {
      throw createError("EMAXPARTCOUNT", `Maximum MIME part count of ${limits.maxPartCount} parts exceeded`);
    }
    this.childNodes = [];
    this.finalizedChildCount = 0;
    if (options.parentNode) {
      this.parentNode = options.parentNode;
      this.depth = this.parentNode.depth + 1;
      if (this.depth > limits.maxNestingDepth) {
        throw createError("EMAXNESTINGDEPTH", `Maximum MIME nesting depth of ${limits.maxNestingDepth} levels exceeded`);
      }
      options.parentNode.childNodes.push(this);
    } else {
      this.depth = 0;
    }
    this.state = "header";
    this.headerLines = [];
    const parentMultipartType = options.parentMultipartType || null;
    const defaultContentType = parentMultipartType === "digest" ? "message/rfc822" : "text/plain";
    this.contentType = {
      value: defaultContentType,
      parsed: { value: defaultContentType, params: {} },
      multipart: false
    };
    this.contentTransferEncoding = {
      value: "8bit",
      encoding: ""
    };
    this.contentDisposition = {
      value: "",
      parsed: { value: "", params: {} }
    };
    this.headers = [];
    this.rawHeaderLines = [];
    this.contentDecoder = null;
    this.content = null;
  }
  // `transferEncoding` is the lowercased token of the header, see processHeaders. It is
  // matched whole: `x-base64` or `7bit-base64` is no encoding Python or mailparser
  // decode, and decoding it here rendered as markup a body every other reader keeps as
  // inert base64
  setupContentDecoder(transferEncoding) {
    if (transferEncoding === "base64") {
      this.contentDecoder = new Base64Decoder();
    } else if (transferEncoding === "quoted-printable") {
      this.contentDecoder = new QPDecoder();
    } else {
      this.contentDecoder = new PassThroughDecoder();
    }
  }
  // `boundaryEnded` tells that the part was ended by a multipart boundary, which owns
  // the line break after the last line of the part (RFC 2046 5.1.1)
  async finalize(boundaryEnded = false) {
    if (this.state === "finished") {
      return;
    }
    if (this.state === "header") {
      this.endHeaders();
    }
    let boundaries = this.postalMime.boundaries;
    for (let i = boundaries.length - 1; i >= 0; i--) {
      let boundary = boundaries[i];
      if (boundary.node === this) {
        boundaries.splice(i, 1);
        break;
      }
    }
    await this.finalizeChildNodes(boundaryEnded);
    this.content = this.contentDecoder ? await this.contentDecoder.finalize(boundaryEnded) : null;
    this.contentDecoder = null;
    this.state = "finished";
  }
  async finalizeChildNodes(boundaryEnded = false) {
    while (this.finalizedChildCount < this.childNodes.length) {
      await this.childNodes[this.finalizedChildCount++].finalize(boundaryEnded);
    }
  }
  // Strip RFC 822 comments (parenthesized text) from structured header values.
  //
  // Inside an unquoted parameter value a parenthesis that continues the current token is
  // content, because `filename=Invoice(1).pdf` is a filename and not a token followed by
  // a comment, and deleting the parens silently renames the attachment.
  stripComments(str) {
    let result = "";
    let depth = 0;
    let escaped = false;
    let inQuote = false;
    let commentStart = -1;
    let inParameterValue = false;
    let runStart = 0;
    const drop = /* @__PURE__ */ __name((i) => {
      result += str.slice(runStart, i);
      runStart = i + 1;
    }, "drop");
    let keptAny = false;
    let endsWithWsp = false;
    const keep = /* @__PURE__ */ __name((i) => {
      keptAny = true;
      endsWithWsp = isWsp(str.charCodeAt(i));
    }, "keep");
    const opensComment = /* @__PURE__ */ __name(() => !inParameterValue || !keptAny || endsWithWsp, "opensComment");
    for (let i = 0; i < str.length; i++) {
      const chr = str.charAt(i);
      if (escaped) {
        escaped = false;
      } else if (chr === "\\") {
        escaped = true;
      } else if (chr === '"' && depth === 0) {
        inQuote = !inQuote;
      } else if (!inQuote) {
        if (chr === "(" && opensComment()) {
          if (depth === 0) {
            commentStart = i;
          }
          depth++;
          drop(i);
          continue;
        }
        if (chr === ")" && depth > 0) {
          depth--;
          drop(i);
          continue;
        }
        if (depth === 0) {
          if (chr === "=") {
            inParameterValue = true;
          } else if (chr === ";") {
            inParameterValue = false;
          }
        }
      }
      if (depth === 0) {
        keep(i);
      } else {
        drop(i);
      }
    }
    if (depth === 0) {
      return result + str.slice(runStart);
    }
    return str.indexOf(";", commentStart) < 0 ? result + str.slice(runStart) : str;
  }
  parseStructuredHeader(str) {
    str = this.stripComments(str);
    let response = {
      value: "",
      params: {}
    };
    let key = false;
    let value = "";
    let stage = "value";
    let pendingSpace = "";
    let quoteClosed = false;
    let quote = false;
    let escaped = false;
    let chr;
    const flushSpace = /* @__PURE__ */ __name(() => {
      if (value.length) {
        value += pendingSpace;
      }
      pendingSpace = "";
    }, "flushSpace");
    let runStart = -1;
    const closeRun = /* @__PURE__ */ __name((end) => {
      if (runStart >= 0) {
        value += str.slice(runStart, end);
        runStart = -1;
      }
    }, "closeRun");
    const addChr = /* @__PURE__ */ __name((i) => {
      if (runStart < 0) {
        flushSpace();
        runStart = i;
      }
    }, "addChr");
    const takeValue = /* @__PURE__ */ __name(() => {
      const result = value;
      value = "";
      pendingSpace = "";
      quoteClosed = false;
      return result;
    }, "takeValue");
    const storeParam = /* @__PURE__ */ __name((name, result) => {
      if (name && !Object.prototype.hasOwnProperty.call(response.params, name)) {
        response.params[name] = result;
      }
    }, "storeParam");
    const storeValue = /* @__PURE__ */ __name(() => {
      const result = takeValue();
      if (key === false) {
        response.value = result;
      } else {
        storeParam(key, result);
      }
    }, "storeValue");
    const storeEmptyKey = /* @__PURE__ */ __name(() => {
      storeParam(takeValue().trim().toLowerCase(), "");
    }, "storeEmptyKey");
    for (let i = 0, len = str.length; i < len; i++) {
      chr = str.charAt(i);
      switch (stage) {
        case "key":
          if (chr === "=") {
            closeRun(i);
            key = takeValue().trim().toLowerCase();
            stage = "value";
            break;
          }
          if (chr === ";") {
            closeRun(i);
            storeEmptyKey();
            break;
          }
          if (runStart < 0) {
            runStart = i;
          }
          break;
        case "value":
          if (quoteClosed && chr !== ";") {
            escaped = false;
            break;
          }
          if (escaped) {
            addChr(i);
          } else if (quote && chr === "\\") {
            closeRun(i);
            escaped = true;
            continue;
          } else if (quote && chr === quote) {
            closeRun(i);
            quote = false;
            quoteClosed = true;
          } else if (!quote && chr === '"') {
            closeRun(i);
            quote = chr;
            flushSpace();
          } else if (!quote && chr === ";") {
            closeRun(i);
            storeValue();
            stage = "key";
          } else if (!quote && (chr === " " || chr === "	")) {
            closeRun(i);
            pendingSpace += chr;
          } else {
            addChr(i);
          }
          escaped = false;
          break;
      }
    }
    closeRun(str.length);
    if (stage === "value") {
      storeValue();
    } else {
      storeEmptyKey();
    }
    if (response.value) {
      response.value = response.value.toLowerCase();
    }
    decodeParameterValueContinuations(response);
    return response;
  }
  // Unfolds format=flowed text (RFC 3676 4.1). A line is read as its quote marks, one
  // space of stuffing and its content, in that order, and a line whose content ends in a
  // space is flowed: the next line of the same quote depth continues its paragraph. The
  // paragraph ends at a fixed line, at a change of quote depth and at the signature
  // separator, which is neither flowed nor fixed. Joining a quoted paragraph used to
  // leave the quote marks of the continuation lines inside the text, so a quoted reply
  // read `> one > two` instead of `> one two`.
  //
  // The quote marks and stuffing of the first line of a paragraph are kept as they were
  // written, so a fixed quoted line comes out exactly as it went in. An unquoted stuffed
  // line loses its stuffing, which is all the stuffing is for.
  decodeFlowedText(str, delSp) {
    const chunks = [];
    let parts = [];
    let flowed = false;
    let depth = 0;
    for (let lineStart = 0; lineStart <= str.length; ) {
      let lineEnd = str.indexOf("\n", lineStart);
      if (lineEnd < 0) {
        lineEnd = str.length;
      }
      const line = str.slice(lineStart, lineEnd);
      let quoteDepth = 0;
      while (line.charCodeAt(quoteDepth) === 62) {
        quoteDepth++;
      }
      const contentStart = line.charCodeAt(quoteDepth) === 32 ? quoteDepth + 1 : quoteDepth;
      const content = line.slice(contentStart);
      const isSignature = content === "-- ";
      if (flowed && quoteDepth === depth && !isSignature) {
        if (delSp) {
          const last = parts[parts.length - 1];
          parts[parts.length - 1] = last.slice(0, -1);
        }
        parts.push(content);
      } else {
        if (lineStart) {
          parts.push("\n");
        }
        parts.push(quoteDepth ? line : content);
      }
      flowed = !isSignature && content.endsWith(" ");
      depth = quoteDepth;
      if (parts.length >= FLOWED_JOIN_INTERVAL) {
        const last = parts.pop();
        chunks.push(parts.join(""));
        parts = [last];
      }
      lineStart = lineEnd + 1;
    }
    chunks.push(parts.join(""));
    return chunks.join("");
  }
  getTextContent() {
    if (!this.content) {
      return "";
    }
    let str = decodeText(this.content, this.contentType.parsed.params.charset, this.contentType.parsed.value === "text/html").replace(/\r\n/g, "\n");
    if (this.contentType.parsed.value === "text/plain" && /^flowed$/i.test(this.contentType.parsed.params.format)) {
      str = this.decodeFlowedText(str, /^yes$/i.test(this.contentType.parsed.params.delsp));
    }
    return str;
  }
  processHeaders() {
    let foldedLines = [];
    for (let line of this.headerLines) {
      if (foldedLines.length && /^[ \t]/.test(line)) {
        foldedLines[foldedLines.length - 1].push(line);
      } else {
        foldedLines.push([line]);
      }
    }
    let seenContentHeaders = /* @__PURE__ */ new Set();
    for (let parts of foldedLines) {
      let rawLine = parts.join("\n");
      let sep = rawLine.indexOf(":");
      let rawKey = sep < 0 ? rawLine : rawLine.slice(0, sep);
      this.rawHeaderLines.push({
        key: rawKey.toLowerCase(),
        line: rawLine
      });
      let unfoldedLine = parts.join("");
      sep = unfoldedLine.indexOf(":");
      let key = sep < 0 ? unfoldedLine : unfoldedLine.slice(0, sep);
      let value = sep < 0 ? "" : trimWsp(foldLineBreaks(unfoldedLine.slice(sep + 1)));
      this.headers.push({ key: key.toLowerCase(), originalKey: key, value });
      const lowerKey = key.toLowerCase();
      if (CONTENT_HEADERS.has(lowerKey) && !seenContentHeaders.has(lowerKey)) {
        seenContentHeaders.add(lowerKey);
        switch (lowerKey) {
          case "content-type":
            this.contentType.value = value;
            break;
          case "content-transfer-encoding":
            this.contentTransferEncoding.value = value;
            break;
          case "content-disposition":
            this.contentDisposition.value = value;
            break;
          case "content-id":
            this.contentId = value;
            break;
          case "content-description":
            this.contentDescription = value;
            break;
        }
      }
    }
    this.contentType.parsed = this.parseStructuredHeader(this.contentType.value);
    this.contentType.multipart = /^multipart\//i.test(this.contentType.parsed.value) ? this.contentType.parsed.value.slice(this.contentType.parsed.value.indexOf("/") + 1) : false;
    let boundary = this.contentType.multipart ? (this.contentType.parsed.params.boundary || "").trimEnd() : "";
    if (/[^\x00-\x7f]/.test(boundary)) {
      boundary = "";
    }
    if (this.contentType.multipart && !boundary) {
      this.contentType.parsed.value = "text/plain";
      this.contentType.multipart = false;
    }
    if (this.contentType.multipart) {
      this.postalMime.boundaries.push({
        value: textEncoder.encode(boundary),
        node: this
      });
    }
    this.contentDisposition.parsed = this.parseStructuredHeader(this.contentDisposition.value);
    const disposition = this.contentDisposition.parsed.value;
    const dispositionEnd = disposition.search(/[ \t]/);
    if (dispositionEnd >= 0) {
      this.contentDisposition.parsed.value = disposition.slice(0, dispositionEnd);
    }
    this.contentTransferEncoding.encoding = (this.stripComments(this.contentTransferEncoding.value).toLowerCase().match(/^[ \t]*([\w-]+)/) || ["", ""])[1];
    this.setupContentDecoder(this.contentTransferEncoding.encoding);
    this.headerLines = [];
  }
  // Ends the header section and sets up the body
  endHeaders() {
    this.state = "body";
    this.processHeaders();
  }
  // Returns true when the line was not consumed: the headers ended with the line before
  // it, and the parser has to read it again, since the boundary this part declares was
  // not known yet when the line was checked for one
  feed(line, lineBreak) {
    switch (this.state) {
      case "header": {
        if (!line.length) {
          this.endHeaders();
          return false;
        }
        this.postalMime.counters.headerSize += Math.max(line.length, HEADER_LINE_MIN_COST);
        const maxHeadersSize = this.postalMime.limits.maxHeadersSize;
        if (this.postalMime.counters.headerSize > maxHeadersSize) {
          throw createError("EMAXHEADERSIZE", `Maximum header size of ${maxHeadersSize} bytes exceeded`);
        }
        const text = decodeUtf8OrWindows1252(line, headerDecoder);
        if (!isWsp(line[0]) && !FIELD_START.test(text)) {
          this.endHeaders();
          return true;
        }
        this.headerLines.push(text);
        break;
      }
      case "body":
        if (this.contentDecoder) {
          this.contentDecoder.update(line, lineBreak);
        }
        break;
    }
    return false;
  }
};

// node_modules/postal-mime/dist/esm/html-entities.js
var htmlEntities = {
  "&AElig": "\xC6",
  "&AElig;": "\xC6",
  "&AMP": "&",
  "&AMP;": "&",
  "&Aacute": "\xC1",
  "&Aacute;": "\xC1",
  "&Abreve;": "\u0102",
  "&Acirc": "\xC2",
  "&Acirc;": "\xC2",
  "&Acy;": "\u0410",
  "&Afr;": "\u{1D504}",
  "&Agrave": "\xC0",
  "&Agrave;": "\xC0",
  "&Alpha;": "\u0391",
  "&Amacr;": "\u0100",
  "&And;": "\u2A53",
  "&Aogon;": "\u0104",
  "&Aopf;": "\u{1D538}",
  "&ApplyFunction;": "\u2061",
  "&Aring": "\xC5",
  "&Aring;": "\xC5",
  "&Ascr;": "\u{1D49C}",
  "&Assign;": "\u2254",
  "&Atilde": "\xC3",
  "&Atilde;": "\xC3",
  "&Auml": "\xC4",
  "&Auml;": "\xC4",
  "&Backslash;": "\u2216",
  "&Barv;": "\u2AE7",
  "&Barwed;": "\u2306",
  "&Bcy;": "\u0411",
  "&Because;": "\u2235",
  "&Bernoullis;": "\u212C",
  "&Beta;": "\u0392",
  "&Bfr;": "\u{1D505}",
  "&Bopf;": "\u{1D539}",
  "&Breve;": "\u02D8",
  "&Bscr;": "\u212C",
  "&Bumpeq;": "\u224E",
  "&CHcy;": "\u0427",
  "&COPY": "\xA9",
  "&COPY;": "\xA9",
  "&Cacute;": "\u0106",
  "&Cap;": "\u22D2",
  "&CapitalDifferentialD;": "\u2145",
  "&Cayleys;": "\u212D",
  "&Ccaron;": "\u010C",
  "&Ccedil": "\xC7",
  "&Ccedil;": "\xC7",
  "&Ccirc;": "\u0108",
  "&Cconint;": "\u2230",
  "&Cdot;": "\u010A",
  "&Cedilla;": "\xB8",
  "&CenterDot;": "\xB7",
  "&Cfr;": "\u212D",
  "&Chi;": "\u03A7",
  "&CircleDot;": "\u2299",
  "&CircleMinus;": "\u2296",
  "&CirclePlus;": "\u2295",
  "&CircleTimes;": "\u2297",
  "&ClockwiseContourIntegral;": "\u2232",
  "&CloseCurlyDoubleQuote;": "\u201D",
  "&CloseCurlyQuote;": "\u2019",
  "&Colon;": "\u2237",
  "&Colone;": "\u2A74",
  "&Congruent;": "\u2261",
  "&Conint;": "\u222F",
  "&ContourIntegral;": "\u222E",
  "&Copf;": "\u2102",
  "&Coproduct;": "\u2210",
  "&CounterClockwiseContourIntegral;": "\u2233",
  "&Cross;": "\u2A2F",
  "&Cscr;": "\u{1D49E}",
  "&Cup;": "\u22D3",
  "&CupCap;": "\u224D",
  "&DD;": "\u2145",
  "&DDotrahd;": "\u2911",
  "&DJcy;": "\u0402",
  "&DScy;": "\u0405",
  "&DZcy;": "\u040F",
  "&Dagger;": "\u2021",
  "&Darr;": "\u21A1",
  "&Dashv;": "\u2AE4",
  "&Dcaron;": "\u010E",
  "&Dcy;": "\u0414",
  "&Del;": "\u2207",
  "&Delta;": "\u0394",
  "&Dfr;": "\u{1D507}",
  "&DiacriticalAcute;": "\xB4",
  "&DiacriticalDot;": "\u02D9",
  "&DiacriticalDoubleAcute;": "\u02DD",
  "&DiacriticalGrave;": "`",
  "&DiacriticalTilde;": "\u02DC",
  "&Diamond;": "\u22C4",
  "&DifferentialD;": "\u2146",
  "&Dopf;": "\u{1D53B}",
  "&Dot;": "\xA8",
  "&DotDot;": "\u20DC",
  "&DotEqual;": "\u2250",
  "&DoubleContourIntegral;": "\u222F",
  "&DoubleDot;": "\xA8",
  "&DoubleDownArrow;": "\u21D3",
  "&DoubleLeftArrow;": "\u21D0",
  "&DoubleLeftRightArrow;": "\u21D4",
  "&DoubleLeftTee;": "\u2AE4",
  "&DoubleLongLeftArrow;": "\u27F8",
  "&DoubleLongLeftRightArrow;": "\u27FA",
  "&DoubleLongRightArrow;": "\u27F9",
  "&DoubleRightArrow;": "\u21D2",
  "&DoubleRightTee;": "\u22A8",
  "&DoubleUpArrow;": "\u21D1",
  "&DoubleUpDownArrow;": "\u21D5",
  "&DoubleVerticalBar;": "\u2225",
  "&DownArrow;": "\u2193",
  "&DownArrowBar;": "\u2913",
  "&DownArrowUpArrow;": "\u21F5",
  "&DownBreve;": "\u0311",
  "&DownLeftRightVector;": "\u2950",
  "&DownLeftTeeVector;": "\u295E",
  "&DownLeftVector;": "\u21BD",
  "&DownLeftVectorBar;": "\u2956",
  "&DownRightTeeVector;": "\u295F",
  "&DownRightVector;": "\u21C1",
  "&DownRightVectorBar;": "\u2957",
  "&DownTee;": "\u22A4",
  "&DownTeeArrow;": "\u21A7",
  "&Downarrow;": "\u21D3",
  "&Dscr;": "\u{1D49F}",
  "&Dstrok;": "\u0110",
  "&ENG;": "\u014A",
  "&ETH": "\xD0",
  "&ETH;": "\xD0",
  "&Eacute": "\xC9",
  "&Eacute;": "\xC9",
  "&Ecaron;": "\u011A",
  "&Ecirc": "\xCA",
  "&Ecirc;": "\xCA",
  "&Ecy;": "\u042D",
  "&Edot;": "\u0116",
  "&Efr;": "\u{1D508}",
  "&Egrave": "\xC8",
  "&Egrave;": "\xC8",
  "&Element;": "\u2208",
  "&Emacr;": "\u0112",
  "&EmptySmallSquare;": "\u25FB",
  "&EmptyVerySmallSquare;": "\u25AB",
  "&Eogon;": "\u0118",
  "&Eopf;": "\u{1D53C}",
  "&Epsilon;": "\u0395",
  "&Equal;": "\u2A75",
  "&EqualTilde;": "\u2242",
  "&Equilibrium;": "\u21CC",
  "&Escr;": "\u2130",
  "&Esim;": "\u2A73",
  "&Eta;": "\u0397",
  "&Euml": "\xCB",
  "&Euml;": "\xCB",
  "&Exists;": "\u2203",
  "&ExponentialE;": "\u2147",
  "&Fcy;": "\u0424",
  "&Ffr;": "\u{1D509}",
  "&FilledSmallSquare;": "\u25FC",
  "&FilledVerySmallSquare;": "\u25AA",
  "&Fopf;": "\u{1D53D}",
  "&ForAll;": "\u2200",
  "&Fouriertrf;": "\u2131",
  "&Fscr;": "\u2131",
  "&GJcy;": "\u0403",
  "&GT": ">",
  "&GT;": ">",
  "&Gamma;": "\u0393",
  "&Gammad;": "\u03DC",
  "&Gbreve;": "\u011E",
  "&Gcedil;": "\u0122",
  "&Gcirc;": "\u011C",
  "&Gcy;": "\u0413",
  "&Gdot;": "\u0120",
  "&Gfr;": "\u{1D50A}",
  "&Gg;": "\u22D9",
  "&Gopf;": "\u{1D53E}",
  "&GreaterEqual;": "\u2265",
  "&GreaterEqualLess;": "\u22DB",
  "&GreaterFullEqual;": "\u2267",
  "&GreaterGreater;": "\u2AA2",
  "&GreaterLess;": "\u2277",
  "&GreaterSlantEqual;": "\u2A7E",
  "&GreaterTilde;": "\u2273",
  "&Gscr;": "\u{1D4A2}",
  "&Gt;": "\u226B",
  "&HARDcy;": "\u042A",
  "&Hacek;": "\u02C7",
  "&Hat;": "^",
  "&Hcirc;": "\u0124",
  "&Hfr;": "\u210C",
  "&HilbertSpace;": "\u210B",
  "&Hopf;": "\u210D",
  "&HorizontalLine;": "\u2500",
  "&Hscr;": "\u210B",
  "&Hstrok;": "\u0126",
  "&HumpDownHump;": "\u224E",
  "&HumpEqual;": "\u224F",
  "&IEcy;": "\u0415",
  "&IJlig;": "\u0132",
  "&IOcy;": "\u0401",
  "&Iacute": "\xCD",
  "&Iacute;": "\xCD",
  "&Icirc": "\xCE",
  "&Icirc;": "\xCE",
  "&Icy;": "\u0418",
  "&Idot;": "\u0130",
  "&Ifr;": "\u2111",
  "&Igrave": "\xCC",
  "&Igrave;": "\xCC",
  "&Im;": "\u2111",
  "&Imacr;": "\u012A",
  "&ImaginaryI;": "\u2148",
  "&Implies;": "\u21D2",
  "&Int;": "\u222C",
  "&Integral;": "\u222B",
  "&Intersection;": "\u22C2",
  "&InvisibleComma;": "\u2063",
  "&InvisibleTimes;": "\u2062",
  "&Iogon;": "\u012E",
  "&Iopf;": "\u{1D540}",
  "&Iota;": "\u0399",
  "&Iscr;": "\u2110",
  "&Itilde;": "\u0128",
  "&Iukcy;": "\u0406",
  "&Iuml": "\xCF",
  "&Iuml;": "\xCF",
  "&Jcirc;": "\u0134",
  "&Jcy;": "\u0419",
  "&Jfr;": "\u{1D50D}",
  "&Jopf;": "\u{1D541}",
  "&Jscr;": "\u{1D4A5}",
  "&Jsercy;": "\u0408",
  "&Jukcy;": "\u0404",
  "&KHcy;": "\u0425",
  "&KJcy;": "\u040C",
  "&Kappa;": "\u039A",
  "&Kcedil;": "\u0136",
  "&Kcy;": "\u041A",
  "&Kfr;": "\u{1D50E}",
  "&Kopf;": "\u{1D542}",
  "&Kscr;": "\u{1D4A6}",
  "&LJcy;": "\u0409",
  "&LT": "<",
  "&LT;": "<",
  "&Lacute;": "\u0139",
  "&Lambda;": "\u039B",
  "&Lang;": "\u27EA",
  "&Laplacetrf;": "\u2112",
  "&Larr;": "\u219E",
  "&Lcaron;": "\u013D",
  "&Lcedil;": "\u013B",
  "&Lcy;": "\u041B",
  "&LeftAngleBracket;": "\u27E8",
  "&LeftArrow;": "\u2190",
  "&LeftArrowBar;": "\u21E4",
  "&LeftArrowRightArrow;": "\u21C6",
  "&LeftCeiling;": "\u2308",
  "&LeftDoubleBracket;": "\u27E6",
  "&LeftDownTeeVector;": "\u2961",
  "&LeftDownVector;": "\u21C3",
  "&LeftDownVectorBar;": "\u2959",
  "&LeftFloor;": "\u230A",
  "&LeftRightArrow;": "\u2194",
  "&LeftRightVector;": "\u294E",
  "&LeftTee;": "\u22A3",
  "&LeftTeeArrow;": "\u21A4",
  "&LeftTeeVector;": "\u295A",
  "&LeftTriangle;": "\u22B2",
  "&LeftTriangleBar;": "\u29CF",
  "&LeftTriangleEqual;": "\u22B4",
  "&LeftUpDownVector;": "\u2951",
  "&LeftUpTeeVector;": "\u2960",
  "&LeftUpVector;": "\u21BF",
  "&LeftUpVectorBar;": "\u2958",
  "&LeftVector;": "\u21BC",
  "&LeftVectorBar;": "\u2952",
  "&Leftarrow;": "\u21D0",
  "&Leftrightarrow;": "\u21D4",
  "&LessEqualGreater;": "\u22DA",
  "&LessFullEqual;": "\u2266",
  "&LessGreater;": "\u2276",
  "&LessLess;": "\u2AA1",
  "&LessSlantEqual;": "\u2A7D",
  "&LessTilde;": "\u2272",
  "&Lfr;": "\u{1D50F}",
  "&Ll;": "\u22D8",
  "&Lleftarrow;": "\u21DA",
  "&Lmidot;": "\u013F",
  "&LongLeftArrow;": "\u27F5",
  "&LongLeftRightArrow;": "\u27F7",
  "&LongRightArrow;": "\u27F6",
  "&Longleftarrow;": "\u27F8",
  "&Longleftrightarrow;": "\u27FA",
  "&Longrightarrow;": "\u27F9",
  "&Lopf;": "\u{1D543}",
  "&LowerLeftArrow;": "\u2199",
  "&LowerRightArrow;": "\u2198",
  "&Lscr;": "\u2112",
  "&Lsh;": "\u21B0",
  "&Lstrok;": "\u0141",
  "&Lt;": "\u226A",
  "&Map;": "\u2905",
  "&Mcy;": "\u041C",
  "&MediumSpace;": "\u205F",
  "&Mellintrf;": "\u2133",
  "&Mfr;": "\u{1D510}",
  "&MinusPlus;": "\u2213",
  "&Mopf;": "\u{1D544}",
  "&Mscr;": "\u2133",
  "&Mu;": "\u039C",
  "&NJcy;": "\u040A",
  "&Nacute;": "\u0143",
  "&Ncaron;": "\u0147",
  "&Ncedil;": "\u0145",
  "&Ncy;": "\u041D",
  "&NegativeMediumSpace;": "\u200B",
  "&NegativeThickSpace;": "\u200B",
  "&NegativeThinSpace;": "\u200B",
  "&NegativeVeryThinSpace;": "\u200B",
  "&NestedGreaterGreater;": "\u226B",
  "&NestedLessLess;": "\u226A",
  "&NewLine;": "\n",
  "&Nfr;": "\u{1D511}",
  "&NoBreak;": "\u2060",
  "&NonBreakingSpace;": "\xA0",
  "&Nopf;": "\u2115",
  "&Not;": "\u2AEC",
  "&NotCongruent;": "\u2262",
  "&NotCupCap;": "\u226D",
  "&NotDoubleVerticalBar;": "\u2226",
  "&NotElement;": "\u2209",
  "&NotEqual;": "\u2260",
  "&NotEqualTilde;": "\u2242\u0338",
  "&NotExists;": "\u2204",
  "&NotGreater;": "\u226F",
  "&NotGreaterEqual;": "\u2271",
  "&NotGreaterFullEqual;": "\u2267\u0338",
  "&NotGreaterGreater;": "\u226B\u0338",
  "&NotGreaterLess;": "\u2279",
  "&NotGreaterSlantEqual;": "\u2A7E\u0338",
  "&NotGreaterTilde;": "\u2275",
  "&NotHumpDownHump;": "\u224E\u0338",
  "&NotHumpEqual;": "\u224F\u0338",
  "&NotLeftTriangle;": "\u22EA",
  "&NotLeftTriangleBar;": "\u29CF\u0338",
  "&NotLeftTriangleEqual;": "\u22EC",
  "&NotLess;": "\u226E",
  "&NotLessEqual;": "\u2270",
  "&NotLessGreater;": "\u2278",
  "&NotLessLess;": "\u226A\u0338",
  "&NotLessSlantEqual;": "\u2A7D\u0338",
  "&NotLessTilde;": "\u2274",
  "&NotNestedGreaterGreater;": "\u2AA2\u0338",
  "&NotNestedLessLess;": "\u2AA1\u0338",
  "&NotPrecedes;": "\u2280",
  "&NotPrecedesEqual;": "\u2AAF\u0338",
  "&NotPrecedesSlantEqual;": "\u22E0",
  "&NotReverseElement;": "\u220C",
  "&NotRightTriangle;": "\u22EB",
  "&NotRightTriangleBar;": "\u29D0\u0338",
  "&NotRightTriangleEqual;": "\u22ED",
  "&NotSquareSubset;": "\u228F\u0338",
  "&NotSquareSubsetEqual;": "\u22E2",
  "&NotSquareSuperset;": "\u2290\u0338",
  "&NotSquareSupersetEqual;": "\u22E3",
  "&NotSubset;": "\u2282\u20D2",
  "&NotSubsetEqual;": "\u2288",
  "&NotSucceeds;": "\u2281",
  "&NotSucceedsEqual;": "\u2AB0\u0338",
  "&NotSucceedsSlantEqual;": "\u22E1",
  "&NotSucceedsTilde;": "\u227F\u0338",
  "&NotSuperset;": "\u2283\u20D2",
  "&NotSupersetEqual;": "\u2289",
  "&NotTilde;": "\u2241",
  "&NotTildeEqual;": "\u2244",
  "&NotTildeFullEqual;": "\u2247",
  "&NotTildeTilde;": "\u2249",
  "&NotVerticalBar;": "\u2224",
  "&Nscr;": "\u{1D4A9}",
  "&Ntilde": "\xD1",
  "&Ntilde;": "\xD1",
  "&Nu;": "\u039D",
  "&OElig;": "\u0152",
  "&Oacute": "\xD3",
  "&Oacute;": "\xD3",
  "&Ocirc": "\xD4",
  "&Ocirc;": "\xD4",
  "&Ocy;": "\u041E",
  "&Odblac;": "\u0150",
  "&Ofr;": "\u{1D512}",
  "&Ograve": "\xD2",
  "&Ograve;": "\xD2",
  "&Omacr;": "\u014C",
  "&Omega;": "\u03A9",
  "&Omicron;": "\u039F",
  "&Oopf;": "\u{1D546}",
  "&OpenCurlyDoubleQuote;": "\u201C",
  "&OpenCurlyQuote;": "\u2018",
  "&Or;": "\u2A54",
  "&Oscr;": "\u{1D4AA}",
  "&Oslash": "\xD8",
  "&Oslash;": "\xD8",
  "&Otilde": "\xD5",
  "&Otilde;": "\xD5",
  "&Otimes;": "\u2A37",
  "&Ouml": "\xD6",
  "&Ouml;": "\xD6",
  "&OverBar;": "\u203E",
  "&OverBrace;": "\u23DE",
  "&OverBracket;": "\u23B4",
  "&OverParenthesis;": "\u23DC",
  "&PartialD;": "\u2202",
  "&Pcy;": "\u041F",
  "&Pfr;": "\u{1D513}",
  "&Phi;": "\u03A6",
  "&Pi;": "\u03A0",
  "&PlusMinus;": "\xB1",
  "&Poincareplane;": "\u210C",
  "&Popf;": "\u2119",
  "&Pr;": "\u2ABB",
  "&Precedes;": "\u227A",
  "&PrecedesEqual;": "\u2AAF",
  "&PrecedesSlantEqual;": "\u227C",
  "&PrecedesTilde;": "\u227E",
  "&Prime;": "\u2033",
  "&Product;": "\u220F",
  "&Proportion;": "\u2237",
  "&Proportional;": "\u221D",
  "&Pscr;": "\u{1D4AB}",
  "&Psi;": "\u03A8",
  "&QUOT": '"',
  "&QUOT;": '"',
  "&Qfr;": "\u{1D514}",
  "&Qopf;": "\u211A",
  "&Qscr;": "\u{1D4AC}",
  "&RBarr;": "\u2910",
  "&REG": "\xAE",
  "&REG;": "\xAE",
  "&Racute;": "\u0154",
  "&Rang;": "\u27EB",
  "&Rarr;": "\u21A0",
  "&Rarrtl;": "\u2916",
  "&Rcaron;": "\u0158",
  "&Rcedil;": "\u0156",
  "&Rcy;": "\u0420",
  "&Re;": "\u211C",
  "&ReverseElement;": "\u220B",
  "&ReverseEquilibrium;": "\u21CB",
  "&ReverseUpEquilibrium;": "\u296F",
  "&Rfr;": "\u211C",
  "&Rho;": "\u03A1",
  "&RightAngleBracket;": "\u27E9",
  "&RightArrow;": "\u2192",
  "&RightArrowBar;": "\u21E5",
  "&RightArrowLeftArrow;": "\u21C4",
  "&RightCeiling;": "\u2309",
  "&RightDoubleBracket;": "\u27E7",
  "&RightDownTeeVector;": "\u295D",
  "&RightDownVector;": "\u21C2",
  "&RightDownVectorBar;": "\u2955",
  "&RightFloor;": "\u230B",
  "&RightTee;": "\u22A2",
  "&RightTeeArrow;": "\u21A6",
  "&RightTeeVector;": "\u295B",
  "&RightTriangle;": "\u22B3",
  "&RightTriangleBar;": "\u29D0",
  "&RightTriangleEqual;": "\u22B5",
  "&RightUpDownVector;": "\u294F",
  "&RightUpTeeVector;": "\u295C",
  "&RightUpVector;": "\u21BE",
  "&RightUpVectorBar;": "\u2954",
  "&RightVector;": "\u21C0",
  "&RightVectorBar;": "\u2953",
  "&Rightarrow;": "\u21D2",
  "&Ropf;": "\u211D",
  "&RoundImplies;": "\u2970",
  "&Rrightarrow;": "\u21DB",
  "&Rscr;": "\u211B",
  "&Rsh;": "\u21B1",
  "&RuleDelayed;": "\u29F4",
  "&SHCHcy;": "\u0429",
  "&SHcy;": "\u0428",
  "&SOFTcy;": "\u042C",
  "&Sacute;": "\u015A",
  "&Sc;": "\u2ABC",
  "&Scaron;": "\u0160",
  "&Scedil;": "\u015E",
  "&Scirc;": "\u015C",
  "&Scy;": "\u0421",
  "&Sfr;": "\u{1D516}",
  "&ShortDownArrow;": "\u2193",
  "&ShortLeftArrow;": "\u2190",
  "&ShortRightArrow;": "\u2192",
  "&ShortUpArrow;": "\u2191",
  "&Sigma;": "\u03A3",
  "&SmallCircle;": "\u2218",
  "&Sopf;": "\u{1D54A}",
  "&Sqrt;": "\u221A",
  "&Square;": "\u25A1",
  "&SquareIntersection;": "\u2293",
  "&SquareSubset;": "\u228F",
  "&SquareSubsetEqual;": "\u2291",
  "&SquareSuperset;": "\u2290",
  "&SquareSupersetEqual;": "\u2292",
  "&SquareUnion;": "\u2294",
  "&Sscr;": "\u{1D4AE}",
  "&Star;": "\u22C6",
  "&Sub;": "\u22D0",
  "&Subset;": "\u22D0",
  "&SubsetEqual;": "\u2286",
  "&Succeeds;": "\u227B",
  "&SucceedsEqual;": "\u2AB0",
  "&SucceedsSlantEqual;": "\u227D",
  "&SucceedsTilde;": "\u227F",
  "&SuchThat;": "\u220B",
  "&Sum;": "\u2211",
  "&Sup;": "\u22D1",
  "&Superset;": "\u2283",
  "&SupersetEqual;": "\u2287",
  "&Supset;": "\u22D1",
  "&THORN": "\xDE",
  "&THORN;": "\xDE",
  "&TRADE;": "\u2122",
  "&TSHcy;": "\u040B",
  "&TScy;": "\u0426",
  "&Tab;": "	",
  "&Tau;": "\u03A4",
  "&Tcaron;": "\u0164",
  "&Tcedil;": "\u0162",
  "&Tcy;": "\u0422",
  "&Tfr;": "\u{1D517}",
  "&Therefore;": "\u2234",
  "&Theta;": "\u0398",
  "&ThickSpace;": "\u205F\u200A",
  "&ThinSpace;": "\u2009",
  "&Tilde;": "\u223C",
  "&TildeEqual;": "\u2243",
  "&TildeFullEqual;": "\u2245",
  "&TildeTilde;": "\u2248",
  "&Topf;": "\u{1D54B}",
  "&TripleDot;": "\u20DB",
  "&Tscr;": "\u{1D4AF}",
  "&Tstrok;": "\u0166",
  "&Uacute": "\xDA",
  "&Uacute;": "\xDA",
  "&Uarr;": "\u219F",
  "&Uarrocir;": "\u2949",
  "&Ubrcy;": "\u040E",
  "&Ubreve;": "\u016C",
  "&Ucirc": "\xDB",
  "&Ucirc;": "\xDB",
  "&Ucy;": "\u0423",
  "&Udblac;": "\u0170",
  "&Ufr;": "\u{1D518}",
  "&Ugrave": "\xD9",
  "&Ugrave;": "\xD9",
  "&Umacr;": "\u016A",
  "&UnderBar;": "_",
  "&UnderBrace;": "\u23DF",
  "&UnderBracket;": "\u23B5",
  "&UnderParenthesis;": "\u23DD",
  "&Union;": "\u22C3",
  "&UnionPlus;": "\u228E",
  "&Uogon;": "\u0172",
  "&Uopf;": "\u{1D54C}",
  "&UpArrow;": "\u2191",
  "&UpArrowBar;": "\u2912",
  "&UpArrowDownArrow;": "\u21C5",
  "&UpDownArrow;": "\u2195",
  "&UpEquilibrium;": "\u296E",
  "&UpTee;": "\u22A5",
  "&UpTeeArrow;": "\u21A5",
  "&Uparrow;": "\u21D1",
  "&Updownarrow;": "\u21D5",
  "&UpperLeftArrow;": "\u2196",
  "&UpperRightArrow;": "\u2197",
  "&Upsi;": "\u03D2",
  "&Upsilon;": "\u03A5",
  "&Uring;": "\u016E",
  "&Uscr;": "\u{1D4B0}",
  "&Utilde;": "\u0168",
  "&Uuml": "\xDC",
  "&Uuml;": "\xDC",
  "&VDash;": "\u22AB",
  "&Vbar;": "\u2AEB",
  "&Vcy;": "\u0412",
  "&Vdash;": "\u22A9",
  "&Vdashl;": "\u2AE6",
  "&Vee;": "\u22C1",
  "&Verbar;": "\u2016",
  "&Vert;": "\u2016",
  "&VerticalBar;": "\u2223",
  "&VerticalLine;": "|",
  "&VerticalSeparator;": "\u2758",
  "&VerticalTilde;": "\u2240",
  "&VeryThinSpace;": "\u200A",
  "&Vfr;": "\u{1D519}",
  "&Vopf;": "\u{1D54D}",
  "&Vscr;": "\u{1D4B1}",
  "&Vvdash;": "\u22AA",
  "&Wcirc;": "\u0174",
  "&Wedge;": "\u22C0",
  "&Wfr;": "\u{1D51A}",
  "&Wopf;": "\u{1D54E}",
  "&Wscr;": "\u{1D4B2}",
  "&Xfr;": "\u{1D51B}",
  "&Xi;": "\u039E",
  "&Xopf;": "\u{1D54F}",
  "&Xscr;": "\u{1D4B3}",
  "&YAcy;": "\u042F",
  "&YIcy;": "\u0407",
  "&YUcy;": "\u042E",
  "&Yacute": "\xDD",
  "&Yacute;": "\xDD",
  "&Ycirc;": "\u0176",
  "&Ycy;": "\u042B",
  "&Yfr;": "\u{1D51C}",
  "&Yopf;": "\u{1D550}",
  "&Yscr;": "\u{1D4B4}",
  "&Yuml;": "\u0178",
  "&ZHcy;": "\u0416",
  "&Zacute;": "\u0179",
  "&Zcaron;": "\u017D",
  "&Zcy;": "\u0417",
  "&Zdot;": "\u017B",
  "&ZeroWidthSpace;": "\u200B",
  "&Zeta;": "\u0396",
  "&Zfr;": "\u2128",
  "&Zopf;": "\u2124",
  "&Zscr;": "\u{1D4B5}",
  "&aacute": "\xE1",
  "&aacute;": "\xE1",
  "&abreve;": "\u0103",
  "&ac;": "\u223E",
  "&acE;": "\u223E\u0333",
  "&acd;": "\u223F",
  "&acirc": "\xE2",
  "&acirc;": "\xE2",
  "&acute": "\xB4",
  "&acute;": "\xB4",
  "&acy;": "\u0430",
  "&aelig": "\xE6",
  "&aelig;": "\xE6",
  "&af;": "\u2061",
  "&afr;": "\u{1D51E}",
  "&agrave": "\xE0",
  "&agrave;": "\xE0",
  "&alefsym;": "\u2135",
  "&aleph;": "\u2135",
  "&alpha;": "\u03B1",
  "&amacr;": "\u0101",
  "&amalg;": "\u2A3F",
  "&amp": "&",
  "&amp;": "&",
  "&and;": "\u2227",
  "&andand;": "\u2A55",
  "&andd;": "\u2A5C",
  "&andslope;": "\u2A58",
  "&andv;": "\u2A5A",
  "&ang;": "\u2220",
  "&ange;": "\u29A4",
  "&angle;": "\u2220",
  "&angmsd;": "\u2221",
  "&angmsdaa;": "\u29A8",
  "&angmsdab;": "\u29A9",
  "&angmsdac;": "\u29AA",
  "&angmsdad;": "\u29AB",
  "&angmsdae;": "\u29AC",
  "&angmsdaf;": "\u29AD",
  "&angmsdag;": "\u29AE",
  "&angmsdah;": "\u29AF",
  "&angrt;": "\u221F",
  "&angrtvb;": "\u22BE",
  "&angrtvbd;": "\u299D",
  "&angsph;": "\u2222",
  "&angst;": "\xC5",
  "&angzarr;": "\u237C",
  "&aogon;": "\u0105",
  "&aopf;": "\u{1D552}",
  "&ap;": "\u2248",
  "&apE;": "\u2A70",
  "&apacir;": "\u2A6F",
  "&ape;": "\u224A",
  "&apid;": "\u224B",
  "&apos;": "'",
  "&approx;": "\u2248",
  "&approxeq;": "\u224A",
  "&aring": "\xE5",
  "&aring;": "\xE5",
  "&ascr;": "\u{1D4B6}",
  "&ast;": "*",
  "&asymp;": "\u2248",
  "&asympeq;": "\u224D",
  "&atilde": "\xE3",
  "&atilde;": "\xE3",
  "&auml": "\xE4",
  "&auml;": "\xE4",
  "&awconint;": "\u2233",
  "&awint;": "\u2A11",
  "&bNot;": "\u2AED",
  "&backcong;": "\u224C",
  "&backepsilon;": "\u03F6",
  "&backprime;": "\u2035",
  "&backsim;": "\u223D",
  "&backsimeq;": "\u22CD",
  "&barvee;": "\u22BD",
  "&barwed;": "\u2305",
  "&barwedge;": "\u2305",
  "&bbrk;": "\u23B5",
  "&bbrktbrk;": "\u23B6",
  "&bcong;": "\u224C",
  "&bcy;": "\u0431",
  "&bdquo;": "\u201E",
  "&becaus;": "\u2235",
  "&because;": "\u2235",
  "&bemptyv;": "\u29B0",
  "&bepsi;": "\u03F6",
  "&bernou;": "\u212C",
  "&beta;": "\u03B2",
  "&beth;": "\u2136",
  "&between;": "\u226C",
  "&bfr;": "\u{1D51F}",
  "&bigcap;": "\u22C2",
  "&bigcirc;": "\u25EF",
  "&bigcup;": "\u22C3",
  "&bigodot;": "\u2A00",
  "&bigoplus;": "\u2A01",
  "&bigotimes;": "\u2A02",
  "&bigsqcup;": "\u2A06",
  "&bigstar;": "\u2605",
  "&bigtriangledown;": "\u25BD",
  "&bigtriangleup;": "\u25B3",
  "&biguplus;": "\u2A04",
  "&bigvee;": "\u22C1",
  "&bigwedge;": "\u22C0",
  "&bkarow;": "\u290D",
  "&blacklozenge;": "\u29EB",
  "&blacksquare;": "\u25AA",
  "&blacktriangle;": "\u25B4",
  "&blacktriangledown;": "\u25BE",
  "&blacktriangleleft;": "\u25C2",
  "&blacktriangleright;": "\u25B8",
  "&blank;": "\u2423",
  "&blk12;": "\u2592",
  "&blk14;": "\u2591",
  "&blk34;": "\u2593",
  "&block;": "\u2588",
  "&bne;": "=\u20E5",
  "&bnequiv;": "\u2261\u20E5",
  "&bnot;": "\u2310",
  "&bopf;": "\u{1D553}",
  "&bot;": "\u22A5",
  "&bottom;": "\u22A5",
  "&bowtie;": "\u22C8",
  "&boxDL;": "\u2557",
  "&boxDR;": "\u2554",
  "&boxDl;": "\u2556",
  "&boxDr;": "\u2553",
  "&boxH;": "\u2550",
  "&boxHD;": "\u2566",
  "&boxHU;": "\u2569",
  "&boxHd;": "\u2564",
  "&boxHu;": "\u2567",
  "&boxUL;": "\u255D",
  "&boxUR;": "\u255A",
  "&boxUl;": "\u255C",
  "&boxUr;": "\u2559",
  "&boxV;": "\u2551",
  "&boxVH;": "\u256C",
  "&boxVL;": "\u2563",
  "&boxVR;": "\u2560",
  "&boxVh;": "\u256B",
  "&boxVl;": "\u2562",
  "&boxVr;": "\u255F",
  "&boxbox;": "\u29C9",
  "&boxdL;": "\u2555",
  "&boxdR;": "\u2552",
  "&boxdl;": "\u2510",
  "&boxdr;": "\u250C",
  "&boxh;": "\u2500",
  "&boxhD;": "\u2565",
  "&boxhU;": "\u2568",
  "&boxhd;": "\u252C",
  "&boxhu;": "\u2534",
  "&boxminus;": "\u229F",
  "&boxplus;": "\u229E",
  "&boxtimes;": "\u22A0",
  "&boxuL;": "\u255B",
  "&boxuR;": "\u2558",
  "&boxul;": "\u2518",
  "&boxur;": "\u2514",
  "&boxv;": "\u2502",
  "&boxvH;": "\u256A",
  "&boxvL;": "\u2561",
  "&boxvR;": "\u255E",
  "&boxvh;": "\u253C",
  "&boxvl;": "\u2524",
  "&boxvr;": "\u251C",
  "&bprime;": "\u2035",
  "&breve;": "\u02D8",
  "&brvbar": "\xA6",
  "&brvbar;": "\xA6",
  "&bscr;": "\u{1D4B7}",
  "&bsemi;": "\u204F",
  "&bsim;": "\u223D",
  "&bsime;": "\u22CD",
  "&bsol;": "\\",
  "&bsolb;": "\u29C5",
  "&bsolhsub;": "\u27C8",
  "&bull;": "\u2022",
  "&bullet;": "\u2022",
  "&bump;": "\u224E",
  "&bumpE;": "\u2AAE",
  "&bumpe;": "\u224F",
  "&bumpeq;": "\u224F",
  "&cacute;": "\u0107",
  "&cap;": "\u2229",
  "&capand;": "\u2A44",
  "&capbrcup;": "\u2A49",
  "&capcap;": "\u2A4B",
  "&capcup;": "\u2A47",
  "&capdot;": "\u2A40",
  "&caps;": "\u2229\uFE00",
  "&caret;": "\u2041",
  "&caron;": "\u02C7",
  "&ccaps;": "\u2A4D",
  "&ccaron;": "\u010D",
  "&ccedil": "\xE7",
  "&ccedil;": "\xE7",
  "&ccirc;": "\u0109",
  "&ccups;": "\u2A4C",
  "&ccupssm;": "\u2A50",
  "&cdot;": "\u010B",
  "&cedil": "\xB8",
  "&cedil;": "\xB8",
  "&cemptyv;": "\u29B2",
  "&cent": "\xA2",
  "&cent;": "\xA2",
  "&centerdot;": "\xB7",
  "&cfr;": "\u{1D520}",
  "&chcy;": "\u0447",
  "&check;": "\u2713",
  "&checkmark;": "\u2713",
  "&chi;": "\u03C7",
  "&cir;": "\u25CB",
  "&cirE;": "\u29C3",
  "&circ;": "\u02C6",
  "&circeq;": "\u2257",
  "&circlearrowleft;": "\u21BA",
  "&circlearrowright;": "\u21BB",
  "&circledR;": "\xAE",
  "&circledS;": "\u24C8",
  "&circledast;": "\u229B",
  "&circledcirc;": "\u229A",
  "&circleddash;": "\u229D",
  "&cire;": "\u2257",
  "&cirfnint;": "\u2A10",
  "&cirmid;": "\u2AEF",
  "&cirscir;": "\u29C2",
  "&clubs;": "\u2663",
  "&clubsuit;": "\u2663",
  "&colon;": ":",
  "&colone;": "\u2254",
  "&coloneq;": "\u2254",
  "&comma;": ",",
  "&commat;": "@",
  "&comp;": "\u2201",
  "&compfn;": "\u2218",
  "&complement;": "\u2201",
  "&complexes;": "\u2102",
  "&cong;": "\u2245",
  "&congdot;": "\u2A6D",
  "&conint;": "\u222E",
  "&copf;": "\u{1D554}",
  "&coprod;": "\u2210",
  "&copy": "\xA9",
  "&copy;": "\xA9",
  "&copysr;": "\u2117",
  "&crarr;": "\u21B5",
  "&cross;": "\u2717",
  "&cscr;": "\u{1D4B8}",
  "&csub;": "\u2ACF",
  "&csube;": "\u2AD1",
  "&csup;": "\u2AD0",
  "&csupe;": "\u2AD2",
  "&ctdot;": "\u22EF",
  "&cudarrl;": "\u2938",
  "&cudarrr;": "\u2935",
  "&cuepr;": "\u22DE",
  "&cuesc;": "\u22DF",
  "&cularr;": "\u21B6",
  "&cularrp;": "\u293D",
  "&cup;": "\u222A",
  "&cupbrcap;": "\u2A48",
  "&cupcap;": "\u2A46",
  "&cupcup;": "\u2A4A",
  "&cupdot;": "\u228D",
  "&cupor;": "\u2A45",
  "&cups;": "\u222A\uFE00",
  "&curarr;": "\u21B7",
  "&curarrm;": "\u293C",
  "&curlyeqprec;": "\u22DE",
  "&curlyeqsucc;": "\u22DF",
  "&curlyvee;": "\u22CE",
  "&curlywedge;": "\u22CF",
  "&curren": "\xA4",
  "&curren;": "\xA4",
  "&curvearrowleft;": "\u21B6",
  "&curvearrowright;": "\u21B7",
  "&cuvee;": "\u22CE",
  "&cuwed;": "\u22CF",
  "&cwconint;": "\u2232",
  "&cwint;": "\u2231",
  "&cylcty;": "\u232D",
  "&dArr;": "\u21D3",
  "&dHar;": "\u2965",
  "&dagger;": "\u2020",
  "&daleth;": "\u2138",
  "&darr;": "\u2193",
  "&dash;": "\u2010",
  "&dashv;": "\u22A3",
  "&dbkarow;": "\u290F",
  "&dblac;": "\u02DD",
  "&dcaron;": "\u010F",
  "&dcy;": "\u0434",
  "&dd;": "\u2146",
  "&ddagger;": "\u2021",
  "&ddarr;": "\u21CA",
  "&ddotseq;": "\u2A77",
  "&deg": "\xB0",
  "&deg;": "\xB0",
  "&delta;": "\u03B4",
  "&demptyv;": "\u29B1",
  "&dfisht;": "\u297F",
  "&dfr;": "\u{1D521}",
  "&dharl;": "\u21C3",
  "&dharr;": "\u21C2",
  "&diam;": "\u22C4",
  "&diamond;": "\u22C4",
  "&diamondsuit;": "\u2666",
  "&diams;": "\u2666",
  "&die;": "\xA8",
  "&digamma;": "\u03DD",
  "&disin;": "\u22F2",
  "&div;": "\xF7",
  "&divide": "\xF7",
  "&divide;": "\xF7",
  "&divideontimes;": "\u22C7",
  "&divonx;": "\u22C7",
  "&djcy;": "\u0452",
  "&dlcorn;": "\u231E",
  "&dlcrop;": "\u230D",
  "&dollar;": "$",
  "&dopf;": "\u{1D555}",
  "&dot;": "\u02D9",
  "&doteq;": "\u2250",
  "&doteqdot;": "\u2251",
  "&dotminus;": "\u2238",
  "&dotplus;": "\u2214",
  "&dotsquare;": "\u22A1",
  "&doublebarwedge;": "\u2306",
  "&downarrow;": "\u2193",
  "&downdownarrows;": "\u21CA",
  "&downharpoonleft;": "\u21C3",
  "&downharpoonright;": "\u21C2",
  "&drbkarow;": "\u2910",
  "&drcorn;": "\u231F",
  "&drcrop;": "\u230C",
  "&dscr;": "\u{1D4B9}",
  "&dscy;": "\u0455",
  "&dsol;": "\u29F6",
  "&dstrok;": "\u0111",
  "&dtdot;": "\u22F1",
  "&dtri;": "\u25BF",
  "&dtrif;": "\u25BE",
  "&duarr;": "\u21F5",
  "&duhar;": "\u296F",
  "&dwangle;": "\u29A6",
  "&dzcy;": "\u045F",
  "&dzigrarr;": "\u27FF",
  "&eDDot;": "\u2A77",
  "&eDot;": "\u2251",
  "&eacute": "\xE9",
  "&eacute;": "\xE9",
  "&easter;": "\u2A6E",
  "&ecaron;": "\u011B",
  "&ecir;": "\u2256",
  "&ecirc": "\xEA",
  "&ecirc;": "\xEA",
  "&ecolon;": "\u2255",
  "&ecy;": "\u044D",
  "&edot;": "\u0117",
  "&ee;": "\u2147",
  "&efDot;": "\u2252",
  "&efr;": "\u{1D522}",
  "&eg;": "\u2A9A",
  "&egrave": "\xE8",
  "&egrave;": "\xE8",
  "&egs;": "\u2A96",
  "&egsdot;": "\u2A98",
  "&el;": "\u2A99",
  "&elinters;": "\u23E7",
  "&ell;": "\u2113",
  "&els;": "\u2A95",
  "&elsdot;": "\u2A97",
  "&emacr;": "\u0113",
  "&empty;": "\u2205",
  "&emptyset;": "\u2205",
  "&emptyv;": "\u2205",
  "&emsp13;": "\u2004",
  "&emsp14;": "\u2005",
  "&emsp;": "\u2003",
  "&eng;": "\u014B",
  "&ensp;": "\u2002",
  "&eogon;": "\u0119",
  "&eopf;": "\u{1D556}",
  "&epar;": "\u22D5",
  "&eparsl;": "\u29E3",
  "&eplus;": "\u2A71",
  "&epsi;": "\u03B5",
  "&epsilon;": "\u03B5",
  "&epsiv;": "\u03F5",
  "&eqcirc;": "\u2256",
  "&eqcolon;": "\u2255",
  "&eqsim;": "\u2242",
  "&eqslantgtr;": "\u2A96",
  "&eqslantless;": "\u2A95",
  "&equals;": "=",
  "&equest;": "\u225F",
  "&equiv;": "\u2261",
  "&equivDD;": "\u2A78",
  "&eqvparsl;": "\u29E5",
  "&erDot;": "\u2253",
  "&erarr;": "\u2971",
  "&escr;": "\u212F",
  "&esdot;": "\u2250",
  "&esim;": "\u2242",
  "&eta;": "\u03B7",
  "&eth": "\xF0",
  "&eth;": "\xF0",
  "&euml": "\xEB",
  "&euml;": "\xEB",
  "&euro;": "\u20AC",
  "&excl;": "!",
  "&exist;": "\u2203",
  "&expectation;": "\u2130",
  "&exponentiale;": "\u2147",
  "&fallingdotseq;": "\u2252",
  "&fcy;": "\u0444",
  "&female;": "\u2640",
  "&ffilig;": "\uFB03",
  "&fflig;": "\uFB00",
  "&ffllig;": "\uFB04",
  "&ffr;": "\u{1D523}",
  "&filig;": "\uFB01",
  "&fjlig;": "fj",
  "&flat;": "\u266D",
  "&fllig;": "\uFB02",
  "&fltns;": "\u25B1",
  "&fnof;": "\u0192",
  "&fopf;": "\u{1D557}",
  "&forall;": "\u2200",
  "&fork;": "\u22D4",
  "&forkv;": "\u2AD9",
  "&fpartint;": "\u2A0D",
  "&frac12": "\xBD",
  "&frac12;": "\xBD",
  "&frac13;": "\u2153",
  "&frac14": "\xBC",
  "&frac14;": "\xBC",
  "&frac15;": "\u2155",
  "&frac16;": "\u2159",
  "&frac18;": "\u215B",
  "&frac23;": "\u2154",
  "&frac25;": "\u2156",
  "&frac34": "\xBE",
  "&frac34;": "\xBE",
  "&frac35;": "\u2157",
  "&frac38;": "\u215C",
  "&frac45;": "\u2158",
  "&frac56;": "\u215A",
  "&frac58;": "\u215D",
  "&frac78;": "\u215E",
  "&frasl;": "\u2044",
  "&frown;": "\u2322",
  "&fscr;": "\u{1D4BB}",
  "&gE;": "\u2267",
  "&gEl;": "\u2A8C",
  "&gacute;": "\u01F5",
  "&gamma;": "\u03B3",
  "&gammad;": "\u03DD",
  "&gap;": "\u2A86",
  "&gbreve;": "\u011F",
  "&gcirc;": "\u011D",
  "&gcy;": "\u0433",
  "&gdot;": "\u0121",
  "&ge;": "\u2265",
  "&gel;": "\u22DB",
  "&geq;": "\u2265",
  "&geqq;": "\u2267",
  "&geqslant;": "\u2A7E",
  "&ges;": "\u2A7E",
  "&gescc;": "\u2AA9",
  "&gesdot;": "\u2A80",
  "&gesdoto;": "\u2A82",
  "&gesdotol;": "\u2A84",
  "&gesl;": "\u22DB\uFE00",
  "&gesles;": "\u2A94",
  "&gfr;": "\u{1D524}",
  "&gg;": "\u226B",
  "&ggg;": "\u22D9",
  "&gimel;": "\u2137",
  "&gjcy;": "\u0453",
  "&gl;": "\u2277",
  "&glE;": "\u2A92",
  "&gla;": "\u2AA5",
  "&glj;": "\u2AA4",
  "&gnE;": "\u2269",
  "&gnap;": "\u2A8A",
  "&gnapprox;": "\u2A8A",
  "&gne;": "\u2A88",
  "&gneq;": "\u2A88",
  "&gneqq;": "\u2269",
  "&gnsim;": "\u22E7",
  "&gopf;": "\u{1D558}",
  "&grave;": "`",
  "&gscr;": "\u210A",
  "&gsim;": "\u2273",
  "&gsime;": "\u2A8E",
  "&gsiml;": "\u2A90",
  "&gt": ">",
  "&gt;": ">",
  "&gtcc;": "\u2AA7",
  "&gtcir;": "\u2A7A",
  "&gtdot;": "\u22D7",
  "&gtlPar;": "\u2995",
  "&gtquest;": "\u2A7C",
  "&gtrapprox;": "\u2A86",
  "&gtrarr;": "\u2978",
  "&gtrdot;": "\u22D7",
  "&gtreqless;": "\u22DB",
  "&gtreqqless;": "\u2A8C",
  "&gtrless;": "\u2277",
  "&gtrsim;": "\u2273",
  "&gvertneqq;": "\u2269\uFE00",
  "&gvnE;": "\u2269\uFE00",
  "&hArr;": "\u21D4",
  "&hairsp;": "\u200A",
  "&half;": "\xBD",
  "&hamilt;": "\u210B",
  "&hardcy;": "\u044A",
  "&harr;": "\u2194",
  "&harrcir;": "\u2948",
  "&harrw;": "\u21AD",
  "&hbar;": "\u210F",
  "&hcirc;": "\u0125",
  "&hearts;": "\u2665",
  "&heartsuit;": "\u2665",
  "&hellip;": "\u2026",
  "&hercon;": "\u22B9",
  "&hfr;": "\u{1D525}",
  "&hksearow;": "\u2925",
  "&hkswarow;": "\u2926",
  "&hoarr;": "\u21FF",
  "&homtht;": "\u223B",
  "&hookleftarrow;": "\u21A9",
  "&hookrightarrow;": "\u21AA",
  "&hopf;": "\u{1D559}",
  "&horbar;": "\u2015",
  "&hscr;": "\u{1D4BD}",
  "&hslash;": "\u210F",
  "&hstrok;": "\u0127",
  "&hybull;": "\u2043",
  "&hyphen;": "\u2010",
  "&iacute": "\xED",
  "&iacute;": "\xED",
  "&ic;": "\u2063",
  "&icirc": "\xEE",
  "&icirc;": "\xEE",
  "&icy;": "\u0438",
  "&iecy;": "\u0435",
  "&iexcl": "\xA1",
  "&iexcl;": "\xA1",
  "&iff;": "\u21D4",
  "&ifr;": "\u{1D526}",
  "&igrave": "\xEC",
  "&igrave;": "\xEC",
  "&ii;": "\u2148",
  "&iiiint;": "\u2A0C",
  "&iiint;": "\u222D",
  "&iinfin;": "\u29DC",
  "&iiota;": "\u2129",
  "&ijlig;": "\u0133",
  "&imacr;": "\u012B",
  "&image;": "\u2111",
  "&imagline;": "\u2110",
  "&imagpart;": "\u2111",
  "&imath;": "\u0131",
  "&imof;": "\u22B7",
  "&imped;": "\u01B5",
  "&in;": "\u2208",
  "&incare;": "\u2105",
  "&infin;": "\u221E",
  "&infintie;": "\u29DD",
  "&inodot;": "\u0131",
  "&int;": "\u222B",
  "&intcal;": "\u22BA",
  "&integers;": "\u2124",
  "&intercal;": "\u22BA",
  "&intlarhk;": "\u2A17",
  "&intprod;": "\u2A3C",
  "&iocy;": "\u0451",
  "&iogon;": "\u012F",
  "&iopf;": "\u{1D55A}",
  "&iota;": "\u03B9",
  "&iprod;": "\u2A3C",
  "&iquest": "\xBF",
  "&iquest;": "\xBF",
  "&iscr;": "\u{1D4BE}",
  "&isin;": "\u2208",
  "&isinE;": "\u22F9",
  "&isindot;": "\u22F5",
  "&isins;": "\u22F4",
  "&isinsv;": "\u22F3",
  "&isinv;": "\u2208",
  "&it;": "\u2062",
  "&itilde;": "\u0129",
  "&iukcy;": "\u0456",
  "&iuml": "\xEF",
  "&iuml;": "\xEF",
  "&jcirc;": "\u0135",
  "&jcy;": "\u0439",
  "&jfr;": "\u{1D527}",
  "&jmath;": "\u0237",
  "&jopf;": "\u{1D55B}",
  "&jscr;": "\u{1D4BF}",
  "&jsercy;": "\u0458",
  "&jukcy;": "\u0454",
  "&kappa;": "\u03BA",
  "&kappav;": "\u03F0",
  "&kcedil;": "\u0137",
  "&kcy;": "\u043A",
  "&kfr;": "\u{1D528}",
  "&kgreen;": "\u0138",
  "&khcy;": "\u0445",
  "&kjcy;": "\u045C",
  "&kopf;": "\u{1D55C}",
  "&kscr;": "\u{1D4C0}",
  "&lAarr;": "\u21DA",
  "&lArr;": "\u21D0",
  "&lAtail;": "\u291B",
  "&lBarr;": "\u290E",
  "&lE;": "\u2266",
  "&lEg;": "\u2A8B",
  "&lHar;": "\u2962",
  "&lacute;": "\u013A",
  "&laemptyv;": "\u29B4",
  "&lagran;": "\u2112",
  "&lambda;": "\u03BB",
  "&lang;": "\u27E8",
  "&langd;": "\u2991",
  "&langle;": "\u27E8",
  "&lap;": "\u2A85",
  "&laquo": "\xAB",
  "&laquo;": "\xAB",
  "&larr;": "\u2190",
  "&larrb;": "\u21E4",
  "&larrbfs;": "\u291F",
  "&larrfs;": "\u291D",
  "&larrhk;": "\u21A9",
  "&larrlp;": "\u21AB",
  "&larrpl;": "\u2939",
  "&larrsim;": "\u2973",
  "&larrtl;": "\u21A2",
  "&lat;": "\u2AAB",
  "&latail;": "\u2919",
  "&late;": "\u2AAD",
  "&lates;": "\u2AAD\uFE00",
  "&lbarr;": "\u290C",
  "&lbbrk;": "\u2772",
  "&lbrace;": "{",
  "&lbrack;": "[",
  "&lbrke;": "\u298B",
  "&lbrksld;": "\u298F",
  "&lbrkslu;": "\u298D",
  "&lcaron;": "\u013E",
  "&lcedil;": "\u013C",
  "&lceil;": "\u2308",
  "&lcub;": "{",
  "&lcy;": "\u043B",
  "&ldca;": "\u2936",
  "&ldquo;": "\u201C",
  "&ldquor;": "\u201E",
  "&ldrdhar;": "\u2967",
  "&ldrushar;": "\u294B",
  "&ldsh;": "\u21B2",
  "&le;": "\u2264",
  "&leftarrow;": "\u2190",
  "&leftarrowtail;": "\u21A2",
  "&leftharpoondown;": "\u21BD",
  "&leftharpoonup;": "\u21BC",
  "&leftleftarrows;": "\u21C7",
  "&leftrightarrow;": "\u2194",
  "&leftrightarrows;": "\u21C6",
  "&leftrightharpoons;": "\u21CB",
  "&leftrightsquigarrow;": "\u21AD",
  "&leftthreetimes;": "\u22CB",
  "&leg;": "\u22DA",
  "&leq;": "\u2264",
  "&leqq;": "\u2266",
  "&leqslant;": "\u2A7D",
  "&les;": "\u2A7D",
  "&lescc;": "\u2AA8",
  "&lesdot;": "\u2A7F",
  "&lesdoto;": "\u2A81",
  "&lesdotor;": "\u2A83",
  "&lesg;": "\u22DA\uFE00",
  "&lesges;": "\u2A93",
  "&lessapprox;": "\u2A85",
  "&lessdot;": "\u22D6",
  "&lesseqgtr;": "\u22DA",
  "&lesseqqgtr;": "\u2A8B",
  "&lessgtr;": "\u2276",
  "&lesssim;": "\u2272",
  "&lfisht;": "\u297C",
  "&lfloor;": "\u230A",
  "&lfr;": "\u{1D529}",
  "&lg;": "\u2276",
  "&lgE;": "\u2A91",
  "&lhard;": "\u21BD",
  "&lharu;": "\u21BC",
  "&lharul;": "\u296A",
  "&lhblk;": "\u2584",
  "&ljcy;": "\u0459",
  "&ll;": "\u226A",
  "&llarr;": "\u21C7",
  "&llcorner;": "\u231E",
  "&llhard;": "\u296B",
  "&lltri;": "\u25FA",
  "&lmidot;": "\u0140",
  "&lmoust;": "\u23B0",
  "&lmoustache;": "\u23B0",
  "&lnE;": "\u2268",
  "&lnap;": "\u2A89",
  "&lnapprox;": "\u2A89",
  "&lne;": "\u2A87",
  "&lneq;": "\u2A87",
  "&lneqq;": "\u2268",
  "&lnsim;": "\u22E6",
  "&loang;": "\u27EC",
  "&loarr;": "\u21FD",
  "&lobrk;": "\u27E6",
  "&longleftarrow;": "\u27F5",
  "&longleftrightarrow;": "\u27F7",
  "&longmapsto;": "\u27FC",
  "&longrightarrow;": "\u27F6",
  "&looparrowleft;": "\u21AB",
  "&looparrowright;": "\u21AC",
  "&lopar;": "\u2985",
  "&lopf;": "\u{1D55D}",
  "&loplus;": "\u2A2D",
  "&lotimes;": "\u2A34",
  "&lowast;": "\u2217",
  "&lowbar;": "_",
  "&loz;": "\u25CA",
  "&lozenge;": "\u25CA",
  "&lozf;": "\u29EB",
  "&lpar;": "(",
  "&lparlt;": "\u2993",
  "&lrarr;": "\u21C6",
  "&lrcorner;": "\u231F",
  "&lrhar;": "\u21CB",
  "&lrhard;": "\u296D",
  "&lrm;": "\u200E",
  "&lrtri;": "\u22BF",
  "&lsaquo;": "\u2039",
  "&lscr;": "\u{1D4C1}",
  "&lsh;": "\u21B0",
  "&lsim;": "\u2272",
  "&lsime;": "\u2A8D",
  "&lsimg;": "\u2A8F",
  "&lsqb;": "[",
  "&lsquo;": "\u2018",
  "&lsquor;": "\u201A",
  "&lstrok;": "\u0142",
  "&lt": "<",
  "&lt;": "<",
  "&ltcc;": "\u2AA6",
  "&ltcir;": "\u2A79",
  "&ltdot;": "\u22D6",
  "&lthree;": "\u22CB",
  "&ltimes;": "\u22C9",
  "&ltlarr;": "\u2976",
  "&ltquest;": "\u2A7B",
  "&ltrPar;": "\u2996",
  "&ltri;": "\u25C3",
  "&ltrie;": "\u22B4",
  "&ltrif;": "\u25C2",
  "&lurdshar;": "\u294A",
  "&luruhar;": "\u2966",
  "&lvertneqq;": "\u2268\uFE00",
  "&lvnE;": "\u2268\uFE00",
  "&mDDot;": "\u223A",
  "&macr": "\xAF",
  "&macr;": "\xAF",
  "&male;": "\u2642",
  "&malt;": "\u2720",
  "&maltese;": "\u2720",
  "&map;": "\u21A6",
  "&mapsto;": "\u21A6",
  "&mapstodown;": "\u21A7",
  "&mapstoleft;": "\u21A4",
  "&mapstoup;": "\u21A5",
  "&marker;": "\u25AE",
  "&mcomma;": "\u2A29",
  "&mcy;": "\u043C",
  "&mdash;": "\u2014",
  "&measuredangle;": "\u2221",
  "&mfr;": "\u{1D52A}",
  "&mho;": "\u2127",
  "&micro": "\xB5",
  "&micro;": "\xB5",
  "&mid;": "\u2223",
  "&midast;": "*",
  "&midcir;": "\u2AF0",
  "&middot": "\xB7",
  "&middot;": "\xB7",
  "&minus;": "\u2212",
  "&minusb;": "\u229F",
  "&minusd;": "\u2238",
  "&minusdu;": "\u2A2A",
  "&mlcp;": "\u2ADB",
  "&mldr;": "\u2026",
  "&mnplus;": "\u2213",
  "&models;": "\u22A7",
  "&mopf;": "\u{1D55E}",
  "&mp;": "\u2213",
  "&mscr;": "\u{1D4C2}",
  "&mstpos;": "\u223E",
  "&mu;": "\u03BC",
  "&multimap;": "\u22B8",
  "&mumap;": "\u22B8",
  "&nGg;": "\u22D9\u0338",
  "&nGt;": "\u226B\u20D2",
  "&nGtv;": "\u226B\u0338",
  "&nLeftarrow;": "\u21CD",
  "&nLeftrightarrow;": "\u21CE",
  "&nLl;": "\u22D8\u0338",
  "&nLt;": "\u226A\u20D2",
  "&nLtv;": "\u226A\u0338",
  "&nRightarrow;": "\u21CF",
  "&nVDash;": "\u22AF",
  "&nVdash;": "\u22AE",
  "&nabla;": "\u2207",
  "&nacute;": "\u0144",
  "&nang;": "\u2220\u20D2",
  "&nap;": "\u2249",
  "&napE;": "\u2A70\u0338",
  "&napid;": "\u224B\u0338",
  "&napos;": "\u0149",
  "&napprox;": "\u2249",
  "&natur;": "\u266E",
  "&natural;": "\u266E",
  "&naturals;": "\u2115",
  "&nbsp": "\xA0",
  "&nbsp;": "\xA0",
  "&nbump;": "\u224E\u0338",
  "&nbumpe;": "\u224F\u0338",
  "&ncap;": "\u2A43",
  "&ncaron;": "\u0148",
  "&ncedil;": "\u0146",
  "&ncong;": "\u2247",
  "&ncongdot;": "\u2A6D\u0338",
  "&ncup;": "\u2A42",
  "&ncy;": "\u043D",
  "&ndash;": "\u2013",
  "&ne;": "\u2260",
  "&neArr;": "\u21D7",
  "&nearhk;": "\u2924",
  "&nearr;": "\u2197",
  "&nearrow;": "\u2197",
  "&nedot;": "\u2250\u0338",
  "&nequiv;": "\u2262",
  "&nesear;": "\u2928",
  "&nesim;": "\u2242\u0338",
  "&nexist;": "\u2204",
  "&nexists;": "\u2204",
  "&nfr;": "\u{1D52B}",
  "&ngE;": "\u2267\u0338",
  "&nge;": "\u2271",
  "&ngeq;": "\u2271",
  "&ngeqq;": "\u2267\u0338",
  "&ngeqslant;": "\u2A7E\u0338",
  "&nges;": "\u2A7E\u0338",
  "&ngsim;": "\u2275",
  "&ngt;": "\u226F",
  "&ngtr;": "\u226F",
  "&nhArr;": "\u21CE",
  "&nharr;": "\u21AE",
  "&nhpar;": "\u2AF2",
  "&ni;": "\u220B",
  "&nis;": "\u22FC",
  "&nisd;": "\u22FA",
  "&niv;": "\u220B",
  "&njcy;": "\u045A",
  "&nlArr;": "\u21CD",
  "&nlE;": "\u2266\u0338",
  "&nlarr;": "\u219A",
  "&nldr;": "\u2025",
  "&nle;": "\u2270",
  "&nleftarrow;": "\u219A",
  "&nleftrightarrow;": "\u21AE",
  "&nleq;": "\u2270",
  "&nleqq;": "\u2266\u0338",
  "&nleqslant;": "\u2A7D\u0338",
  "&nles;": "\u2A7D\u0338",
  "&nless;": "\u226E",
  "&nlsim;": "\u2274",
  "&nlt;": "\u226E",
  "&nltri;": "\u22EA",
  "&nltrie;": "\u22EC",
  "&nmid;": "\u2224",
  "&nopf;": "\u{1D55F}",
  "&not": "\xAC",
  "&not;": "\xAC",
  "&notin;": "\u2209",
  "&notinE;": "\u22F9\u0338",
  "&notindot;": "\u22F5\u0338",
  "&notinva;": "\u2209",
  "&notinvb;": "\u22F7",
  "&notinvc;": "\u22F6",
  "&notni;": "\u220C",
  "&notniva;": "\u220C",
  "&notnivb;": "\u22FE",
  "&notnivc;": "\u22FD",
  "&npar;": "\u2226",
  "&nparallel;": "\u2226",
  "&nparsl;": "\u2AFD\u20E5",
  "&npart;": "\u2202\u0338",
  "&npolint;": "\u2A14",
  "&npr;": "\u2280",
  "&nprcue;": "\u22E0",
  "&npre;": "\u2AAF\u0338",
  "&nprec;": "\u2280",
  "&npreceq;": "\u2AAF\u0338",
  "&nrArr;": "\u21CF",
  "&nrarr;": "\u219B",
  "&nrarrc;": "\u2933\u0338",
  "&nrarrw;": "\u219D\u0338",
  "&nrightarrow;": "\u219B",
  "&nrtri;": "\u22EB",
  "&nrtrie;": "\u22ED",
  "&nsc;": "\u2281",
  "&nsccue;": "\u22E1",
  "&nsce;": "\u2AB0\u0338",
  "&nscr;": "\u{1D4C3}",
  "&nshortmid;": "\u2224",
  "&nshortparallel;": "\u2226",
  "&nsim;": "\u2241",
  "&nsime;": "\u2244",
  "&nsimeq;": "\u2244",
  "&nsmid;": "\u2224",
  "&nspar;": "\u2226",
  "&nsqsube;": "\u22E2",
  "&nsqsupe;": "\u22E3",
  "&nsub;": "\u2284",
  "&nsubE;": "\u2AC5\u0338",
  "&nsube;": "\u2288",
  "&nsubset;": "\u2282\u20D2",
  "&nsubseteq;": "\u2288",
  "&nsubseteqq;": "\u2AC5\u0338",
  "&nsucc;": "\u2281",
  "&nsucceq;": "\u2AB0\u0338",
  "&nsup;": "\u2285",
  "&nsupE;": "\u2AC6\u0338",
  "&nsupe;": "\u2289",
  "&nsupset;": "\u2283\u20D2",
  "&nsupseteq;": "\u2289",
  "&nsupseteqq;": "\u2AC6\u0338",
  "&ntgl;": "\u2279",
  "&ntilde": "\xF1",
  "&ntilde;": "\xF1",
  "&ntlg;": "\u2278",
  "&ntriangleleft;": "\u22EA",
  "&ntrianglelefteq;": "\u22EC",
  "&ntriangleright;": "\u22EB",
  "&ntrianglerighteq;": "\u22ED",
  "&nu;": "\u03BD",
  "&num;": "#",
  "&numero;": "\u2116",
  "&numsp;": "\u2007",
  "&nvDash;": "\u22AD",
  "&nvHarr;": "\u2904",
  "&nvap;": "\u224D\u20D2",
  "&nvdash;": "\u22AC",
  "&nvge;": "\u2265\u20D2",
  "&nvgt;": ">\u20D2",
  "&nvinfin;": "\u29DE",
  "&nvlArr;": "\u2902",
  "&nvle;": "\u2264\u20D2",
  "&nvlt;": "<\u20D2",
  "&nvltrie;": "\u22B4\u20D2",
  "&nvrArr;": "\u2903",
  "&nvrtrie;": "\u22B5\u20D2",
  "&nvsim;": "\u223C\u20D2",
  "&nwArr;": "\u21D6",
  "&nwarhk;": "\u2923",
  "&nwarr;": "\u2196",
  "&nwarrow;": "\u2196",
  "&nwnear;": "\u2927",
  "&oS;": "\u24C8",
  "&oacute": "\xF3",
  "&oacute;": "\xF3",
  "&oast;": "\u229B",
  "&ocir;": "\u229A",
  "&ocirc": "\xF4",
  "&ocirc;": "\xF4",
  "&ocy;": "\u043E",
  "&odash;": "\u229D",
  "&odblac;": "\u0151",
  "&odiv;": "\u2A38",
  "&odot;": "\u2299",
  "&odsold;": "\u29BC",
  "&oelig;": "\u0153",
  "&ofcir;": "\u29BF",
  "&ofr;": "\u{1D52C}",
  "&ogon;": "\u02DB",
  "&ograve": "\xF2",
  "&ograve;": "\xF2",
  "&ogt;": "\u29C1",
  "&ohbar;": "\u29B5",
  "&ohm;": "\u03A9",
  "&oint;": "\u222E",
  "&olarr;": "\u21BA",
  "&olcir;": "\u29BE",
  "&olcross;": "\u29BB",
  "&oline;": "\u203E",
  "&olt;": "\u29C0",
  "&omacr;": "\u014D",
  "&omega;": "\u03C9",
  "&omicron;": "\u03BF",
  "&omid;": "\u29B6",
  "&ominus;": "\u2296",
  "&oopf;": "\u{1D560}",
  "&opar;": "\u29B7",
  "&operp;": "\u29B9",
  "&oplus;": "\u2295",
  "&or;": "\u2228",
  "&orarr;": "\u21BB",
  "&ord;": "\u2A5D",
  "&order;": "\u2134",
  "&orderof;": "\u2134",
  "&ordf": "\xAA",
  "&ordf;": "\xAA",
  "&ordm": "\xBA",
  "&ordm;": "\xBA",
  "&origof;": "\u22B6",
  "&oror;": "\u2A56",
  "&orslope;": "\u2A57",
  "&orv;": "\u2A5B",
  "&oscr;": "\u2134",
  "&oslash": "\xF8",
  "&oslash;": "\xF8",
  "&osol;": "\u2298",
  "&otilde": "\xF5",
  "&otilde;": "\xF5",
  "&otimes;": "\u2297",
  "&otimesas;": "\u2A36",
  "&ouml": "\xF6",
  "&ouml;": "\xF6",
  "&ovbar;": "\u233D",
  "&par;": "\u2225",
  "&para": "\xB6",
  "&para;": "\xB6",
  "&parallel;": "\u2225",
  "&parsim;": "\u2AF3",
  "&parsl;": "\u2AFD",
  "&part;": "\u2202",
  "&pcy;": "\u043F",
  "&percnt;": "%",
  "&period;": ".",
  "&permil;": "\u2030",
  "&perp;": "\u22A5",
  "&pertenk;": "\u2031",
  "&pfr;": "\u{1D52D}",
  "&phi;": "\u03C6",
  "&phiv;": "\u03D5",
  "&phmmat;": "\u2133",
  "&phone;": "\u260E",
  "&pi;": "\u03C0",
  "&pitchfork;": "\u22D4",
  "&piv;": "\u03D6",
  "&planck;": "\u210F",
  "&planckh;": "\u210E",
  "&plankv;": "\u210F",
  "&plus;": "+",
  "&plusacir;": "\u2A23",
  "&plusb;": "\u229E",
  "&pluscir;": "\u2A22",
  "&plusdo;": "\u2214",
  "&plusdu;": "\u2A25",
  "&pluse;": "\u2A72",
  "&plusmn": "\xB1",
  "&plusmn;": "\xB1",
  "&plussim;": "\u2A26",
  "&plustwo;": "\u2A27",
  "&pm;": "\xB1",
  "&pointint;": "\u2A15",
  "&popf;": "\u{1D561}",
  "&pound": "\xA3",
  "&pound;": "\xA3",
  "&pr;": "\u227A",
  "&prE;": "\u2AB3",
  "&prap;": "\u2AB7",
  "&prcue;": "\u227C",
  "&pre;": "\u2AAF",
  "&prec;": "\u227A",
  "&precapprox;": "\u2AB7",
  "&preccurlyeq;": "\u227C",
  "&preceq;": "\u2AAF",
  "&precnapprox;": "\u2AB9",
  "&precneqq;": "\u2AB5",
  "&precnsim;": "\u22E8",
  "&precsim;": "\u227E",
  "&prime;": "\u2032",
  "&primes;": "\u2119",
  "&prnE;": "\u2AB5",
  "&prnap;": "\u2AB9",
  "&prnsim;": "\u22E8",
  "&prod;": "\u220F",
  "&profalar;": "\u232E",
  "&profline;": "\u2312",
  "&profsurf;": "\u2313",
  "&prop;": "\u221D",
  "&propto;": "\u221D",
  "&prsim;": "\u227E",
  "&prurel;": "\u22B0",
  "&pscr;": "\u{1D4C5}",
  "&psi;": "\u03C8",
  "&puncsp;": "\u2008",
  "&qfr;": "\u{1D52E}",
  "&qint;": "\u2A0C",
  "&qopf;": "\u{1D562}",
  "&qprime;": "\u2057",
  "&qscr;": "\u{1D4C6}",
  "&quaternions;": "\u210D",
  "&quatint;": "\u2A16",
  "&quest;": "?",
  "&questeq;": "\u225F",
  "&quot": '"',
  "&quot;": '"',
  "&rAarr;": "\u21DB",
  "&rArr;": "\u21D2",
  "&rAtail;": "\u291C",
  "&rBarr;": "\u290F",
  "&rHar;": "\u2964",
  "&race;": "\u223D\u0331",
  "&racute;": "\u0155",
  "&radic;": "\u221A",
  "&raemptyv;": "\u29B3",
  "&rang;": "\u27E9",
  "&rangd;": "\u2992",
  "&range;": "\u29A5",
  "&rangle;": "\u27E9",
  "&raquo": "\xBB",
  "&raquo;": "\xBB",
  "&rarr;": "\u2192",
  "&rarrap;": "\u2975",
  "&rarrb;": "\u21E5",
  "&rarrbfs;": "\u2920",
  "&rarrc;": "\u2933",
  "&rarrfs;": "\u291E",
  "&rarrhk;": "\u21AA",
  "&rarrlp;": "\u21AC",
  "&rarrpl;": "\u2945",
  "&rarrsim;": "\u2974",
  "&rarrtl;": "\u21A3",
  "&rarrw;": "\u219D",
  "&ratail;": "\u291A",
  "&ratio;": "\u2236",
  "&rationals;": "\u211A",
  "&rbarr;": "\u290D",
  "&rbbrk;": "\u2773",
  "&rbrace;": "}",
  "&rbrack;": "]",
  "&rbrke;": "\u298C",
  "&rbrksld;": "\u298E",
  "&rbrkslu;": "\u2990",
  "&rcaron;": "\u0159",
  "&rcedil;": "\u0157",
  "&rceil;": "\u2309",
  "&rcub;": "}",
  "&rcy;": "\u0440",
  "&rdca;": "\u2937",
  "&rdldhar;": "\u2969",
  "&rdquo;": "\u201D",
  "&rdquor;": "\u201D",
  "&rdsh;": "\u21B3",
  "&real;": "\u211C",
  "&realine;": "\u211B",
  "&realpart;": "\u211C",
  "&reals;": "\u211D",
  "&rect;": "\u25AD",
  "&reg": "\xAE",
  "&reg;": "\xAE",
  "&rfisht;": "\u297D",
  "&rfloor;": "\u230B",
  "&rfr;": "\u{1D52F}",
  "&rhard;": "\u21C1",
  "&rharu;": "\u21C0",
  "&rharul;": "\u296C",
  "&rho;": "\u03C1",
  "&rhov;": "\u03F1",
  "&rightarrow;": "\u2192",
  "&rightarrowtail;": "\u21A3",
  "&rightharpoondown;": "\u21C1",
  "&rightharpoonup;": "\u21C0",
  "&rightleftarrows;": "\u21C4",
  "&rightleftharpoons;": "\u21CC",
  "&rightrightarrows;": "\u21C9",
  "&rightsquigarrow;": "\u219D",
  "&rightthreetimes;": "\u22CC",
  "&ring;": "\u02DA",
  "&risingdotseq;": "\u2253",
  "&rlarr;": "\u21C4",
  "&rlhar;": "\u21CC",
  "&rlm;": "\u200F",
  "&rmoust;": "\u23B1",
  "&rmoustache;": "\u23B1",
  "&rnmid;": "\u2AEE",
  "&roang;": "\u27ED",
  "&roarr;": "\u21FE",
  "&robrk;": "\u27E7",
  "&ropar;": "\u2986",
  "&ropf;": "\u{1D563}",
  "&roplus;": "\u2A2E",
  "&rotimes;": "\u2A35",
  "&rpar;": ")",
  "&rpargt;": "\u2994",
  "&rppolint;": "\u2A12",
  "&rrarr;": "\u21C9",
  "&rsaquo;": "\u203A",
  "&rscr;": "\u{1D4C7}",
  "&rsh;": "\u21B1",
  "&rsqb;": "]",
  "&rsquo;": "\u2019",
  "&rsquor;": "\u2019",
  "&rthree;": "\u22CC",
  "&rtimes;": "\u22CA",
  "&rtri;": "\u25B9",
  "&rtrie;": "\u22B5",
  "&rtrif;": "\u25B8",
  "&rtriltri;": "\u29CE",
  "&ruluhar;": "\u2968",
  "&rx;": "\u211E",
  "&sacute;": "\u015B",
  "&sbquo;": "\u201A",
  "&sc;": "\u227B",
  "&scE;": "\u2AB4",
  "&scap;": "\u2AB8",
  "&scaron;": "\u0161",
  "&sccue;": "\u227D",
  "&sce;": "\u2AB0",
  "&scedil;": "\u015F",
  "&scirc;": "\u015D",
  "&scnE;": "\u2AB6",
  "&scnap;": "\u2ABA",
  "&scnsim;": "\u22E9",
  "&scpolint;": "\u2A13",
  "&scsim;": "\u227F",
  "&scy;": "\u0441",
  "&sdot;": "\u22C5",
  "&sdotb;": "\u22A1",
  "&sdote;": "\u2A66",
  "&seArr;": "\u21D8",
  "&searhk;": "\u2925",
  "&searr;": "\u2198",
  "&searrow;": "\u2198",
  "&sect": "\xA7",
  "&sect;": "\xA7",
  "&semi;": ";",
  "&seswar;": "\u2929",
  "&setminus;": "\u2216",
  "&setmn;": "\u2216",
  "&sext;": "\u2736",
  "&sfr;": "\u{1D530}",
  "&sfrown;": "\u2322",
  "&sharp;": "\u266F",
  "&shchcy;": "\u0449",
  "&shcy;": "\u0448",
  "&shortmid;": "\u2223",
  "&shortparallel;": "\u2225",
  "&shy": "\xAD",
  "&shy;": "\xAD",
  "&sigma;": "\u03C3",
  "&sigmaf;": "\u03C2",
  "&sigmav;": "\u03C2",
  "&sim;": "\u223C",
  "&simdot;": "\u2A6A",
  "&sime;": "\u2243",
  "&simeq;": "\u2243",
  "&simg;": "\u2A9E",
  "&simgE;": "\u2AA0",
  "&siml;": "\u2A9D",
  "&simlE;": "\u2A9F",
  "&simne;": "\u2246",
  "&simplus;": "\u2A24",
  "&simrarr;": "\u2972",
  "&slarr;": "\u2190",
  "&smallsetminus;": "\u2216",
  "&smashp;": "\u2A33",
  "&smeparsl;": "\u29E4",
  "&smid;": "\u2223",
  "&smile;": "\u2323",
  "&smt;": "\u2AAA",
  "&smte;": "\u2AAC",
  "&smtes;": "\u2AAC\uFE00",
  "&softcy;": "\u044C",
  "&sol;": "/",
  "&solb;": "\u29C4",
  "&solbar;": "\u233F",
  "&sopf;": "\u{1D564}",
  "&spades;": "\u2660",
  "&spadesuit;": "\u2660",
  "&spar;": "\u2225",
  "&sqcap;": "\u2293",
  "&sqcaps;": "\u2293\uFE00",
  "&sqcup;": "\u2294",
  "&sqcups;": "\u2294\uFE00",
  "&sqsub;": "\u228F",
  "&sqsube;": "\u2291",
  "&sqsubset;": "\u228F",
  "&sqsubseteq;": "\u2291",
  "&sqsup;": "\u2290",
  "&sqsupe;": "\u2292",
  "&sqsupset;": "\u2290",
  "&sqsupseteq;": "\u2292",
  "&squ;": "\u25A1",
  "&square;": "\u25A1",
  "&squarf;": "\u25AA",
  "&squf;": "\u25AA",
  "&srarr;": "\u2192",
  "&sscr;": "\u{1D4C8}",
  "&ssetmn;": "\u2216",
  "&ssmile;": "\u2323",
  "&sstarf;": "\u22C6",
  "&star;": "\u2606",
  "&starf;": "\u2605",
  "&straightepsilon;": "\u03F5",
  "&straightphi;": "\u03D5",
  "&strns;": "\xAF",
  "&sub;": "\u2282",
  "&subE;": "\u2AC5",
  "&subdot;": "\u2ABD",
  "&sube;": "\u2286",
  "&subedot;": "\u2AC3",
  "&submult;": "\u2AC1",
  "&subnE;": "\u2ACB",
  "&subne;": "\u228A",
  "&subplus;": "\u2ABF",
  "&subrarr;": "\u2979",
  "&subset;": "\u2282",
  "&subseteq;": "\u2286",
  "&subseteqq;": "\u2AC5",
  "&subsetneq;": "\u228A",
  "&subsetneqq;": "\u2ACB",
  "&subsim;": "\u2AC7",
  "&subsub;": "\u2AD5",
  "&subsup;": "\u2AD3",
  "&succ;": "\u227B",
  "&succapprox;": "\u2AB8",
  "&succcurlyeq;": "\u227D",
  "&succeq;": "\u2AB0",
  "&succnapprox;": "\u2ABA",
  "&succneqq;": "\u2AB6",
  "&succnsim;": "\u22E9",
  "&succsim;": "\u227F",
  "&sum;": "\u2211",
  "&sung;": "\u266A",
  "&sup1": "\xB9",
  "&sup1;": "\xB9",
  "&sup2": "\xB2",
  "&sup2;": "\xB2",
  "&sup3": "\xB3",
  "&sup3;": "\xB3",
  "&sup;": "\u2283",
  "&supE;": "\u2AC6",
  "&supdot;": "\u2ABE",
  "&supdsub;": "\u2AD8",
  "&supe;": "\u2287",
  "&supedot;": "\u2AC4",
  "&suphsol;": "\u27C9",
  "&suphsub;": "\u2AD7",
  "&suplarr;": "\u297B",
  "&supmult;": "\u2AC2",
  "&supnE;": "\u2ACC",
  "&supne;": "\u228B",
  "&supplus;": "\u2AC0",
  "&supset;": "\u2283",
  "&supseteq;": "\u2287",
  "&supseteqq;": "\u2AC6",
  "&supsetneq;": "\u228B",
  "&supsetneqq;": "\u2ACC",
  "&supsim;": "\u2AC8",
  "&supsub;": "\u2AD4",
  "&supsup;": "\u2AD6",
  "&swArr;": "\u21D9",
  "&swarhk;": "\u2926",
  "&swarr;": "\u2199",
  "&swarrow;": "\u2199",
  "&swnwar;": "\u292A",
  "&szlig": "\xDF",
  "&szlig;": "\xDF",
  "&target;": "\u2316",
  "&tau;": "\u03C4",
  "&tbrk;": "\u23B4",
  "&tcaron;": "\u0165",
  "&tcedil;": "\u0163",
  "&tcy;": "\u0442",
  "&tdot;": "\u20DB",
  "&telrec;": "\u2315",
  "&tfr;": "\u{1D531}",
  "&there4;": "\u2234",
  "&therefore;": "\u2234",
  "&theta;": "\u03B8",
  "&thetasym;": "\u03D1",
  "&thetav;": "\u03D1",
  "&thickapprox;": "\u2248",
  "&thicksim;": "\u223C",
  "&thinsp;": "\u2009",
  "&thkap;": "\u2248",
  "&thksim;": "\u223C",
  "&thorn": "\xFE",
  "&thorn;": "\xFE",
  "&tilde;": "\u02DC",
  "&times": "\xD7",
  "&times;": "\xD7",
  "&timesb;": "\u22A0",
  "&timesbar;": "\u2A31",
  "&timesd;": "\u2A30",
  "&tint;": "\u222D",
  "&toea;": "\u2928",
  "&top;": "\u22A4",
  "&topbot;": "\u2336",
  "&topcir;": "\u2AF1",
  "&topf;": "\u{1D565}",
  "&topfork;": "\u2ADA",
  "&tosa;": "\u2929",
  "&tprime;": "\u2034",
  "&trade;": "\u2122",
  "&triangle;": "\u25B5",
  "&triangledown;": "\u25BF",
  "&triangleleft;": "\u25C3",
  "&trianglelefteq;": "\u22B4",
  "&triangleq;": "\u225C",
  "&triangleright;": "\u25B9",
  "&trianglerighteq;": "\u22B5",
  "&tridot;": "\u25EC",
  "&trie;": "\u225C",
  "&triminus;": "\u2A3A",
  "&triplus;": "\u2A39",
  "&trisb;": "\u29CD",
  "&tritime;": "\u2A3B",
  "&trpezium;": "\u23E2",
  "&tscr;": "\u{1D4C9}",
  "&tscy;": "\u0446",
  "&tshcy;": "\u045B",
  "&tstrok;": "\u0167",
  "&twixt;": "\u226C",
  "&twoheadleftarrow;": "\u219E",
  "&twoheadrightarrow;": "\u21A0",
  "&uArr;": "\u21D1",
  "&uHar;": "\u2963",
  "&uacute": "\xFA",
  "&uacute;": "\xFA",
  "&uarr;": "\u2191",
  "&ubrcy;": "\u045E",
  "&ubreve;": "\u016D",
  "&ucirc": "\xFB",
  "&ucirc;": "\xFB",
  "&ucy;": "\u0443",
  "&udarr;": "\u21C5",
  "&udblac;": "\u0171",
  "&udhar;": "\u296E",
  "&ufisht;": "\u297E",
  "&ufr;": "\u{1D532}",
  "&ugrave": "\xF9",
  "&ugrave;": "\xF9",
  "&uharl;": "\u21BF",
  "&uharr;": "\u21BE",
  "&uhblk;": "\u2580",
  "&ulcorn;": "\u231C",
  "&ulcorner;": "\u231C",
  "&ulcrop;": "\u230F",
  "&ultri;": "\u25F8",
  "&umacr;": "\u016B",
  "&uml": "\xA8",
  "&uml;": "\xA8",
  "&uogon;": "\u0173",
  "&uopf;": "\u{1D566}",
  "&uparrow;": "\u2191",
  "&updownarrow;": "\u2195",
  "&upharpoonleft;": "\u21BF",
  "&upharpoonright;": "\u21BE",
  "&uplus;": "\u228E",
  "&upsi;": "\u03C5",
  "&upsih;": "\u03D2",
  "&upsilon;": "\u03C5",
  "&upuparrows;": "\u21C8",
  "&urcorn;": "\u231D",
  "&urcorner;": "\u231D",
  "&urcrop;": "\u230E",
  "&uring;": "\u016F",
  "&urtri;": "\u25F9",
  "&uscr;": "\u{1D4CA}",
  "&utdot;": "\u22F0",
  "&utilde;": "\u0169",
  "&utri;": "\u25B5",
  "&utrif;": "\u25B4",
  "&uuarr;": "\u21C8",
  "&uuml": "\xFC",
  "&uuml;": "\xFC",
  "&uwangle;": "\u29A7",
  "&vArr;": "\u21D5",
  "&vBar;": "\u2AE8",
  "&vBarv;": "\u2AE9",
  "&vDash;": "\u22A8",
  "&vangrt;": "\u299C",
  "&varepsilon;": "\u03F5",
  "&varkappa;": "\u03F0",
  "&varnothing;": "\u2205",
  "&varphi;": "\u03D5",
  "&varpi;": "\u03D6",
  "&varpropto;": "\u221D",
  "&varr;": "\u2195",
  "&varrho;": "\u03F1",
  "&varsigma;": "\u03C2",
  "&varsubsetneq;": "\u228A\uFE00",
  "&varsubsetneqq;": "\u2ACB\uFE00",
  "&varsupsetneq;": "\u228B\uFE00",
  "&varsupsetneqq;": "\u2ACC\uFE00",
  "&vartheta;": "\u03D1",
  "&vartriangleleft;": "\u22B2",
  "&vartriangleright;": "\u22B3",
  "&vcy;": "\u0432",
  "&vdash;": "\u22A2",
  "&vee;": "\u2228",
  "&veebar;": "\u22BB",
  "&veeeq;": "\u225A",
  "&vellip;": "\u22EE",
  "&verbar;": "|",
  "&vert;": "|",
  "&vfr;": "\u{1D533}",
  "&vltri;": "\u22B2",
  "&vnsub;": "\u2282\u20D2",
  "&vnsup;": "\u2283\u20D2",
  "&vopf;": "\u{1D567}",
  "&vprop;": "\u221D",
  "&vrtri;": "\u22B3",
  "&vscr;": "\u{1D4CB}",
  "&vsubnE;": "\u2ACB\uFE00",
  "&vsubne;": "\u228A\uFE00",
  "&vsupnE;": "\u2ACC\uFE00",
  "&vsupne;": "\u228B\uFE00",
  "&vzigzag;": "\u299A",
  "&wcirc;": "\u0175",
  "&wedbar;": "\u2A5F",
  "&wedge;": "\u2227",
  "&wedgeq;": "\u2259",
  "&weierp;": "\u2118",
  "&wfr;": "\u{1D534}",
  "&wopf;": "\u{1D568}",
  "&wp;": "\u2118",
  "&wr;": "\u2240",
  "&wreath;": "\u2240",
  "&wscr;": "\u{1D4CC}",
  "&xcap;": "\u22C2",
  "&xcirc;": "\u25EF",
  "&xcup;": "\u22C3",
  "&xdtri;": "\u25BD",
  "&xfr;": "\u{1D535}",
  "&xhArr;": "\u27FA",
  "&xharr;": "\u27F7",
  "&xi;": "\u03BE",
  "&xlArr;": "\u27F8",
  "&xlarr;": "\u27F5",
  "&xmap;": "\u27FC",
  "&xnis;": "\u22FB",
  "&xodot;": "\u2A00",
  "&xopf;": "\u{1D569}",
  "&xoplus;": "\u2A01",
  "&xotime;": "\u2A02",
  "&xrArr;": "\u27F9",
  "&xrarr;": "\u27F6",
  "&xscr;": "\u{1D4CD}",
  "&xsqcup;": "\u2A06",
  "&xuplus;": "\u2A04",
  "&xutri;": "\u25B3",
  "&xvee;": "\u22C1",
  "&xwedge;": "\u22C0",
  "&yacute": "\xFD",
  "&yacute;": "\xFD",
  "&yacy;": "\u044F",
  "&ycirc;": "\u0177",
  "&ycy;": "\u044B",
  "&yen": "\xA5",
  "&yen;": "\xA5",
  "&yfr;": "\u{1D536}",
  "&yicy;": "\u0457",
  "&yopf;": "\u{1D56A}",
  "&yscr;": "\u{1D4CE}",
  "&yucy;": "\u044E",
  "&yuml": "\xFF",
  "&yuml;": "\xFF",
  "&zacute;": "\u017A",
  "&zcaron;": "\u017E",
  "&zcy;": "\u0437",
  "&zdot;": "\u017C",
  "&zeetrf;": "\u2128",
  "&zeta;": "\u03B6",
  "&zfr;": "\u{1D537}",
  "&zhcy;": "\u0436",
  "&zigrarr;": "\u21DD",
  "&zopf;": "\u{1D56B}",
  "&zscr;": "\u{1D4CF}",
  "&zwj;": "\u200D",
  "&zwnj;": "\u200C"
};

// node_modules/postal-mime/dist/esm/text-format.js
var C1_ENTITY_REPLACEMENTS = /* @__PURE__ */ new Map([
  [128, 8364],
  [130, 8218],
  [131, 402],
  [132, 8222],
  [133, 8230],
  [134, 8224],
  [135, 8225],
  [136, 710],
  [137, 8240],
  [138, 352],
  [139, 8249],
  [140, 338],
  [142, 381],
  [145, 8216],
  [146, 8217],
  [147, 8220],
  [148, 8221],
  [149, 8226],
  [150, 8211],
  [151, 8212],
  [152, 732],
  [153, 8482],
  [154, 353],
  [155, 8250],
  [156, 339],
  [158, 382],
  [159, 376]
]);
function decodeHTMLEntities(str) {
  return str.replace(/&(#\d+|#x[a-f0-9]+|[a-z]+\d*);?/gi, (match, entity) => {
    if (typeof htmlEntities[match] === "string") {
      return htmlEntities[match];
    }
    if (entity.charAt(0) !== "#" || match.charAt(match.length - 1) !== ";") {
      return match;
    }
    let codePoint;
    if (entity.charAt(1).toLowerCase() === "x") {
      codePoint = parseInt(entity.slice(2), 16);
    } else {
      codePoint = parseInt(entity.slice(1), 10);
    }
    let output = "";
    if (codePoint === 0 || codePoint >= 55296 && codePoint <= 57343 || codePoint > 1114111) {
      return "\uFFFD";
    }
    codePoint = C1_ENTITY_REPLACEMENTS.get(codePoint) ?? codePoint;
    if (codePoint > 65535) {
      codePoint -= 65536;
      output += String.fromCharCode(codePoint >>> 10 & 1023 | 55296);
      codePoint = 56320 | codePoint & 1023;
    }
    output += String.fromCharCode(codePoint);
    return output;
  });
}
__name(decodeHTMLEntities, "decodeHTMLEntities");
var hexByte = /* @__PURE__ */ __name((value) => value.toString(16).toUpperCase().padStart(2, "0"), "hexByte");
function escapeHtml(str) {
  return str.trim().replace(/[<>"'?&]/g, (c) => "&#x" + hexByte(c.charCodeAt(0)) + ";");
}
__name(escapeHtml, "escapeHtml");
var MAILTO_UNSAFE = /[^A-Za-z0-9\-._~!$'()*+,;:@]+/g;
var PERCENT_ENCODED = Array.from({ length: 256 }, (_, byte) => "%" + hexByte(byte));
function encodeMailto(address) {
  return address.replace(MAILTO_UNSAFE, (run) => Array.from(textEncoder.encode(run), (byte) => PERCENT_ENCODED[byte]).join(""));
}
__name(encodeMailto, "encodeMailto");
function textToHtml(str) {
  let html = escapeHtml(str).replace(/\n/g, "<br />");
  return "<div>" + html + "</div>";
}
__name(textToHtml, "textToHtml");
function createFinder(str, regex) {
  let searchedFrom = Infinity;
  let found = null;
  return (pos) => {
    if (pos < searchedFrom || found && pos > found.index) {
      regex.lastIndex = pos;
      found = regex.exec(str);
      searchedFrom = pos;
    }
    return found;
  };
}
__name(createFinder, "createFinder");
function throughLastTag(str, process) {
  const end = str.lastIndexOf(">") + 1;
  return process(str.slice(0, end)) + str.slice(end);
}
__name(throughLastTag, "throughLastTag");
function replaceClosedTags(str, pattern, replacement) {
  return throughLastTag(str, (head) => head.replace(pattern, replacement));
}
__name(replaceClosedTags, "replaceClosedTags");
function replaceTags(str, prefix, pattern, replacement) {
  const parts = [];
  let copied = 0;
  let searchFrom = 0;
  while (true) {
    prefix.lastIndex = searchFrom;
    const candidate = prefix.exec(str);
    if (!candidate) {
      break;
    }
    const start = candidate.index;
    const gt = str.indexOf(">", start);
    if (gt < 0) {
      break;
    }
    pattern.lastIndex = start;
    const match = pattern.exec(str);
    if (!match) {
      searchFrom = gt + 1;
      continue;
    }
    parts.push(str.slice(copied, start), replacement(...match));
    copied = searchFrom = start + match[0].length;
  }
  parts.push(str.slice(copied));
  return parts.join("");
}
__name(replaceTags, "replaceTags");
function replaceBlocks(str, open, openToGt, close, closeToGt, replacement) {
  const nextGt = createFinder(str, />/g);
  const nextClose = createFinder(str, close);
  const parts = [];
  let copied = 0;
  let searchFrom = 0;
  while (true) {
    open.lastIndex = searchFrom;
    const opener = open.exec(str);
    if (!opener) {
      break;
    }
    const start = opener.index;
    searchFrom = start + 1;
    let from = start + opener[0].length;
    if (openToGt) {
      const gt = nextGt(from);
      if (!gt) {
        break;
      }
      from = gt.index + 1;
    }
    const closer = nextClose(from);
    if (!closer) {
      break;
    }
    let end = closer.index + closer[0].length;
    if (closeToGt) {
      const gt = nextGt(end);
      if (!gt) {
        break;
      }
      end = gt.index + 1;
    }
    parts.push(str.slice(copied, start), replacement);
    copied = searchFrom = end;
  }
  parts.push(str.slice(copied));
  return parts.join("");
}
__name(replaceBlocks, "replaceBlocks");
function stripThroughLastTag(str, prefix) {
  const limit = str.lastIndexOf(">");
  let last = -1;
  prefix.lastIndex = 0;
  let match;
  while ((match = prefix.exec(str)) && match.index < limit) {
    last = match.index;
  }
  return last < 0 ? str : str.slice(str.indexOf(">", last) + 1);
}
__name(stripThroughLastTag, "stripThroughLastTag");
function stripFromFirstTag(str, prefix) {
  prefix.lastIndex = 0;
  const match = prefix.exec(str);
  return match && match.index < str.lastIndexOf(">") ? str.slice(0, match.index) : str;
}
__name(stripFromFirstTag, "stripFromFirstTag");
function htmlToText(str) {
  str = str.replace(/\r\n|[\n\r\u2028\u2029]/g, "");
  str = replaceBlocks(str, /<!--/g, false, /-->/g, false, " ");
  str = replaceClosedTags(str, /<br\b[^>]*>/gi, "\n");
  str = replaceClosedTags(str, /<\/?(p|div|table|tr|td|th)\b[^>]*>/gi, "\n\n");
  str = replaceBlocks(str, /<script\b/gi, true, /<\/script\b/gi, true, " ");
  str = replaceBlocks(str, /<style\b/gi, true, /<\/style\b/gi, true, " ");
  str = stripThroughLastTag(str, /<body\b/gi);
  str = stripThroughLastTag(str, /<\/head\b/gi);
  str = stripThroughLastTag(str, /<!doctype\b/gi);
  str = stripFromFirstTag(str, /<\/body\b/gi);
  str = stripFromFirstTag(str, /<\/html\b/gi);
  str = throughLastTag(str, (head) => replaceTags(head, /<a\b/gi, /<a\b[^>]*href\s*=\s*["']?([^\s"']+)[^>]*>/iy, (match, href) => ` (${href}) `));
  str = replaceClosedTags(str, /<\/?(span|em|i|strong|b|u|a)\b[^>]*>/gi, "");
  str = replaceTags(str, /<li\b/gi, /<li\b[^>]*>[\n\u0001\s]*/iy, () => "* ");
  str = replaceClosedTags(str, /<hr\b[^>]*>/g, "\n-------------\n");
  str = replaceClosedTags(str, /<[^>]*>/g, " ");
  str = str.replace(/\u0001/g, "\n").replace(/[ \t]+/g, " ").replace(/^\s+$/gm, "").replace(/\n\n+/g, "\n\n").replace(/^\n+/, "\n").replace(/\n+$/, "\n");
  str = decodeHTMLEntities(str);
  return str;
}
__name(htmlToText, "htmlToText");
var dateFormatter = null;
function formatDate(date) {
  if (typeof Intl === "undefined") {
    return date;
  }
  const parsed = new Date(date);
  if (isNaN(parsed.getTime())) {
    return date;
  }
  dateFormatter ??= new Intl.DateTimeFormat("default", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false
  });
  return dateFormatter.format(parsed);
}
__name(formatDate, "formatDate");
function formatTextAddress(address) {
  return (address.name ? [address.name, `<${address.address}>`] : [address.address]).join(" ");
}
__name(formatTextAddress, "formatTextAddress");
function formatTextAddresses(addresses) {
  let parts = [];
  let processAddress = /* @__PURE__ */ __name((address, partCounter) => {
    if (partCounter) {
      parts.push(", ");
    }
    if (address.group) {
      let groupStart = `${address.name}:`;
      let groupEnd = `;`;
      parts.push(groupStart);
      address.group.forEach(processAddress);
      parts.push(groupEnd);
    } else {
      parts.push(formatTextAddress(address));
    }
  }, "processAddress");
  addresses.forEach(processAddress);
  return parts.join("");
}
__name(formatTextAddresses, "formatTextAddresses");
function formatHtmlAddress(address) {
  return `<a href="mailto:${escapeHtml(encodeMailto(address.address))}" class="postal-email-address">${escapeHtml(address.name || `<${address.address}>`)}</a>`;
}
__name(formatHtmlAddress, "formatHtmlAddress");
function formatHtmlAddresses(addresses) {
  let parts = [];
  let processAddress = /* @__PURE__ */ __name((address, partCounter) => {
    if (partCounter) {
      parts.push('<span class="postal-email-address-separator">, </span>');
    }
    if (address.group) {
      let groupStart = `<span class="postal-email-address-group">${escapeHtml(address.name)}:</span>`;
      let groupEnd = `<span class="postal-email-address-group">;</span>`;
      parts.push(groupStart);
      address.group.forEach(processAddress);
      parts.push(groupEnd);
    } else {
      parts.push(formatHtmlAddress(address));
    }
  }, "processAddress");
  addresses.forEach(processAddress);
  return parts.join(" ");
}
__name(formatHtmlAddresses, "formatHtmlAddresses");
function foldLines(str, lineLength, afterSpace) {
  str = (str || "").toString();
  lineLength = lineLength || 76;
  let pos = 0, len = str.length, result = "", line, match;
  while (pos < len) {
    line = str.slice(pos, pos + lineLength);
    if (line.length < lineLength) {
      result += line;
      break;
    }
    if (match = line.match(/^[^\n\r]*(\r?\n|\r)/)) {
      line = match[0];
      result += line;
      pos += line.length;
      continue;
    } else if ((match = line.match(/(\s+)[^\s]*$/)) && match[0].length - (afterSpace ? (match[1] || "").length : 0) < line.length) {
      line = line.slice(0, line.length - (match[0].length - (afterSpace ? (match[1] || "").length : 0)));
    } else if (match = str.slice(pos + line.length).match(/^[^\s]+(\s*)/)) {
      line = line + match[0].slice(0, match[0].length - (!afterSpace ? (match[1] || "").length : 0));
    }
    result += line;
    pos += line.length;
    if (pos < len) {
      result += "\r\n";
    }
  }
  return result;
}
__name(foldLines, "foldLines");
function formatTextHeader(message) {
  let rows = [];
  if (message.from) {
    rows.push({ key: "From", val: formatTextAddresses([message.from]) });
  }
  if (message.subject) {
    rows.push({ key: "Subject", val: message.subject });
  }
  if (message.date) {
    rows.push({ key: "Date", val: formatDate(message.date) });
  }
  if (message.to && message.to.length) {
    rows.push({ key: "To", val: formatTextAddresses(message.to) });
  }
  if (message.cc && message.cc.length) {
    rows.push({ key: "Cc", val: formatTextAddresses(message.cc) });
  }
  if (message.bcc && message.bcc.length) {
    rows.push({ key: "Bcc", val: formatTextAddresses(message.bcc) });
  }
  let maxKeyLength = rows.map((r) => r.key.length).reduce((acc, cur) => {
    return cur > acc ? cur : acc;
  }, 0);
  const lines = rows.flatMap((row) => {
    let sepLen = maxKeyLength - row.key.length;
    let prefix = `${row.key}: ${" ".repeat(sepLen)}`;
    let emptyPrefix = `${" ".repeat(row.key.length + 1)} ${" ".repeat(sepLen)}`;
    let foldedLines = foldLines(row.val, 80, true).split(/\r?\n/).map((line) => line.trim());
    return foldedLines.map((line, i) => `${i ? emptyPrefix : prefix}${line}`);
  });
  let maxLineLength = lines.map((r) => r.length).reduce((acc, cur) => {
    return cur > acc ? cur : acc;
  }, 0);
  let lineMarker = "-".repeat(maxLineLength);
  let template = `
${lineMarker}
${lines.join("\n")}
${lineMarker}
`;
  return template;
}
__name(formatTextHeader, "formatTextHeader");
function formatHtmlHeader(message) {
  let rows = [];
  if (message.from) {
    rows.push(
      // through the plural formatter, because `From:` may hold RFC 5322 group syntax
      // and a group has no address of its own
      `<div class="postal-email-header-key">From</div><div class="postal-email-header-value">${formatHtmlAddresses([message.from])}</div>`
    );
  }
  if (message.subject) {
    rows.push(`<div class="postal-email-header-key">Subject</div><div class="postal-email-header-value postal-email-header-subject">${escapeHtml(message.subject)}</div>`);
  }
  if (message.date) {
    rows.push(`<div class="postal-email-header-key">Date</div><div class="postal-email-header-value postal-email-header-date" data-date="${escapeHtml(message.date)}">${escapeHtml(formatDate(message.date))}</div>`);
  }
  if (message.to && message.to.length) {
    rows.push(`<div class="postal-email-header-key">To</div><div class="postal-email-header-value">${formatHtmlAddresses(message.to)}</div>`);
  }
  if (message.cc && message.cc.length) {
    rows.push(`<div class="postal-email-header-key">Cc</div><div class="postal-email-header-value">${formatHtmlAddresses(message.cc)}</div>`);
  }
  if (message.bcc && message.bcc.length) {
    rows.push(`<div class="postal-email-header-key">Bcc</div><div class="postal-email-header-value">${formatHtmlAddresses(message.bcc)}</div>`);
  }
  let template = `<div class="postal-email-header">${rows.length ? '<div class="postal-email-header-row">' : ""}${rows.join('</div>\n<div class="postal-email-header-row">')}${rows.length ? "</div>" : ""}</div>`;
  return template;
}
__name(formatHtmlHeader, "formatHtmlHeader");

// node_modules/postal-mime/dist/esm/address-parser.js
var TOKEN_OPERATOR = 1;
var TOKEN_NO_BREAK = 2;
var TOKEN_DIRTY = 4;
var TOKEN_ESCAPES = 8;
var TOKEN_STARTS_ESCAPED = 16;
var TokenList = class {
  static {
    __name(this, "TokenList");
  }
  constructor(str) {
    this.str = str;
    this.slots = new Int32Array(48);
    this.length = 0;
    this.cleaned = /* @__PURE__ */ new Map();
  }
  /**
   * Appends a token
   *
   * @param kind Kind and flags of the token
   * @param start Offset of its first character
   * @param end Offset just past its last character
   * @return Index of the token
   */
  push(kind, start, end) {
    if ((this.length + 1) * 3 > this.slots.length) {
      const grown = new Int32Array(this.slots.length * 2);
      grown.set(this.slots);
      this.slots = grown;
    }
    const at = this.length * 3;
    this.slots[at] = kind;
    this.slots[at + 1] = start;
    this.slots[at + 2] = end;
    return this.length++;
  }
  /**
   * The character of an operator token, an empty string for a text run
   */
  operatorAt(index) {
    const at = index * 3;
    return this.slots[at] & TOKEN_OPERATOR ? this.str.charAt(this.slots[at + 1]) : "";
  }
  /**
   * Whether a token is an operator
   */
  isOperator(index) {
    return (this.slots[index * 3] & TOKEN_OPERATOR) !== 0;
  }
  /**
   * Whether the next character continues the run of a token without whitespace in between
   */
  noBreak(index) {
    return (this.slots[index * 3] & TOKEN_NO_BREAK) !== 0;
  }
  /**
   * Value of a token
   */
  value(index) {
    const cleaned = this.cleaned.get(index);
    if (cleaned !== void 0) {
      return cleaned;
    }
    return this.str.slice(this.slots[index * 3 + 1], this.slots[index * 3 + 2]);
  }
};
var HAS_WHITESPACE = /\s/;
var QUOTED_LOCAL_ADDR = /^("(?:[^"\\]|\\[\s\S])*"@\S+)(?:\s+([\s\S]+))?$/;
var ADDR_SPEC = /^[^@\s]+@[^@\s]+$/;
var LITERAL_ADDR_SPEC = /^[^@\s]+@\[[^[\]\\\s]*\]$/;
var QUOTED_LOCAL_DOMAIN = /^@(?:[^@\s"]+|\[[^[\]\\\s]*\])$/;
function isAddrSpec(value) {
  return ADDR_SPEC.test(value) || LITERAL_ADDR_SPEC.test(value);
}
__name(isAddrSpec, "isAddrSpec");
var LOOSE_ADDR_SPEC = /^[^@\s]+@\S+$/;
var LOOSE_TEXT_ADDR = /\s*\b[^@\s]+@[^\s]+\b\s*/y;
var DOMAIN_LITERAL_TAIL = /@(\[[^[\]\\]*\])$/;
function domainAt(address) {
  const literal = address.charAt(address.length - 1) === "]" ? DOMAIN_LITERAL_TAIL.exec(address) : null;
  return literal ? address.length - literal[1].length - 1 : address.lastIndexOf("@");
}
__name(domainAt, "domainAt");
function quoteLocalPart(address) {
  const lastAt = domainAt(address);
  if (lastAt < 0) {
    return address;
  }
  const user = address.substring(0, lastAt);
  if (/^[^\s"(),:;<>@[\\\]]+$/.test(user) || /^"(?:[^"\\]|\\[\s\S])*"$/.test(user)) {
    return address;
  }
  return '"' + user.replace(/["\\]/g, "\\$&") + '"@' + address.substring(lastAt + 1);
}
__name(quoteLocalPart, "quoteLocalPart");
function isSpaceCode(code) {
  return code === 32 || code >= 9 && code <= 13 || code === 160 || code === 5760 || code >= 8192 && code <= 8202 || code === 8232 || code === 8233 || code === 8239 || code === 8287 || code === 12288 || code === 65279;
}
__name(isSpaceCode, "isSpaceCode");
function isWordCode(code) {
  return code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122 || code === 95;
}
__name(isWordCode, "isWordCode");
function isBoundary(text, at) {
  return isWordCode(text.charCodeAt(at - 1)) !== isWordCode(text.charCodeAt(at));
}
__name(isBoundary, "isBoundary");
function indexOfAt(text, from, to) {
  for (let i = from; i < to; i++) {
    if (text.charCodeAt(i) === 64) {
      return i;
    }
  }
  return -1;
}
__name(indexOfAt, "indexOfAt");
var LEADING_QUOTED_STRING = /^"(?:[^"\\]|\\[\s\S])*"/;
function joinAtSpacing(value, at) {
  if (at < 0) {
    return value;
  }
  let start = at;
  while (start > 0 && isSpaceCode(value.charCodeAt(start - 1))) {
    start--;
  }
  let end = at + 1;
  while (end < value.length && isSpaceCode(value.charCodeAt(end))) {
    end++;
  }
  return start === at && end === at + 1 ? value : value.slice(0, start) + "@" + value.slice(end);
}
__name(joinAtSpacing, "joinAtSpacing");
function collapseAtSpacing(value) {
  const quoted = LEADING_QUOTED_STRING.exec(value);
  if (quoted) {
    let at2 = quoted[0].length;
    while (at2 < value.length && isSpaceCode(value.charCodeAt(at2))) {
      at2++;
    }
    if (value.charAt(at2) === "@" && value.indexOf("@", at2 + 1) < 0) {
      return joinAtSpacing(value, at2);
    }
  }
  const at = value.indexOf("@");
  if (at < 0 || value.indexOf("@", at + 1) >= 0 || value.lastIndexOf('"') > at) {
    return value;
  }
  return joinAtSpacing(value, at);
}
__name(collapseAtSpacing, "collapseAtSpacing");
function looseAddressStart(text) {
  const len = text.length;
  let pos = 0;
  while (pos < len) {
    while (pos < len && isSpaceCode(text.charCodeAt(pos))) {
      pos++;
    }
    if (pos >= len) {
      break;
    }
    const runStart = pos;
    let runEnd = pos;
    while (runEnd < len && !isSpaceCode(text.charCodeAt(runEnd))) {
      runEnd++;
    }
    let at = indexOfAt(text, runStart, runEnd);
    if (at >= 0) {
      let lastBoundary = -1;
      for (let k = runEnd; k > runStart; k--) {
        if (isBoundary(text, k)) {
          lastBoundary = k;
          break;
        }
      }
      let atomStart = runStart;
      while (lastBoundary >= 0 && at >= 0) {
        if (at > atomStart && runEnd > at + 1 && lastBoundary > at + 1) {
          for (let start = atomStart; start < at; start++) {
            if (isBoundary(text, start)) {
              if (start > runStart) {
                return start;
              }
              let padded = runStart;
              while (padded > 0 && isSpaceCode(text.charCodeAt(padded - 1))) {
                padded--;
              }
              return padded;
            }
          }
        }
        atomStart = at + 1;
        at = indexOfAt(text, atomStart, runEnd);
      }
    }
    pos = runEnd;
  }
  return -1;
}
__name(looseAddressStart, "looseAddressStart");
function recoverAddrSpec(address, text) {
  address = collapseAtSpacing(address);
  if (!HAS_WHITESPACE.test(address)) {
    return { address, text };
  }
  let rest;
  const quoted = address.match(QUOTED_LOCAL_ADDR);
  if (quoted) {
    if (!quoted[2]) {
      return { address, text };
    }
    address = quoted[1];
    rest = [quoted[2]];
  } else {
    if (address.indexOf('"') >= 0) {
      return { address, text };
    }
    const parts = address.split(/\s+/);
    let addrIndex = parts.findIndex(isAddrSpec);
    if (addrIndex < 0) {
      addrIndex = parts.findIndex((part) => LOOSE_ADDR_SPEC.test(part));
    }
    if (addrIndex < 0) {
      return { address, text };
    }
    address = parts.splice(addrIndex, 1)[0];
    rest = parts;
  }
  return {
    address,
    text: [text, ...rest].filter((part) => part).join(" ")
  };
}
__name(recoverAddrSpec, "recoverAddrSpec");
function stripAddressComments(address) {
  const comments = [];
  let result = "";
  let comment = "";
  let depth = 0;
  let closer = "";
  let lastChar = "";
  let pendingSpace = false;
  let firstChar = "";
  let quoteSeen = false;
  let routeEnd = -1;
  for (let i = 0, len = address.length; i < len; i++) {
    const chr = address.charAt(i);
    if (depth) {
      if (chr === "\\" && i < len - 1) {
        comment += address.charAt(++i);
      } else if (chr === "(") {
        depth++;
        comment += chr;
      } else if (chr === ")" && !--depth) {
        comments.push(comment.trim());
        comment = "";
        pendingSpace = lastChar !== "@";
      } else {
        comment += chr;
      }
      continue;
    }
    if (pendingSpace && chr !== "(") {
      pendingSpace = false;
      if (chr !== "@" && chr !== "<" && !isSpaceCode(address.charCodeAt(i))) {
        result += " ";
        lastChar = " ";
      }
    }
    if (closer) {
      if (chr === "\\" && closer === '"' && i < len - 1) {
        result += chr + address.charAt(++i);
        lastChar = address.charAt(i);
        continue;
      }
      if (chr === closer) {
        closer = "";
      }
    } else if (chr === '"') {
      closer = '"';
      quoteSeen = true;
    } else if (chr === ":" && routeEnd < 0 && firstChar === "@" && !quoteSeen) {
      routeEnd = result.length + 1;
    } else if (chr === "[") {
      closer = "]";
    } else if (chr === "(") {
      depth = 1;
      continue;
    } else if (chr === "<") {
      result = "";
      lastChar = "";
      comments.length = 0;
      firstChar = "";
      quoteSeen = false;
      routeEnd = -1;
      continue;
    }
    result += chr;
    lastChar = chr;
    if (!firstChar && !isSpaceCode(address.charCodeAt(i))) {
      firstChar = chr;
    }
  }
  if (routeEnd >= 0 && result.indexOf("@", routeEnd) >= 0) {
    result = result.slice(routeEnd);
  }
  if (depth) {
    comments.push(comment.trim());
  }
  return { address: result.trim(), comments: comments.filter((text) => text) };
}
__name(stripAddressComments, "stripAddressComments");
function collectAddressParts(tokens, from, to) {
  let state = "text";
  let data = {
    address: [],
    comment: [],
    text: [],
    textWasQuoted: [],
    // Track which text tokens came from inside quotes
    // For a text run that is a quoted local part followed by the unquoted '@' and domain
    // of an addr-spec, '"user"@example.com', the length of the local part, -1 otherwise
    quotedLocalAt: []
  };
  let lastTextPureQuoted = false;
  let i;
  let insideQuotes = false;
  const lastChars = { address: "", comment: "", text: "" };
  for (i = from; i < to; i++) {
    const value = tokens.value(i);
    const prevOperator = i > from ? tokens.operatorAt(i - 1) : "";
    const prevNoBreak = i > from && tokens.noBreak(i - 1);
    if (tokens.isOperator(i)) {
      switch (value) {
        case "<":
          state = "address";
          insideQuotes = false;
          break;
        case "(":
          state = "comment";
          insideQuotes = false;
          break;
        case '"':
          insideQuotes = !insideQuotes;
          state = "text";
          break;
        default:
          state = "text";
          insideQuotes = false;
          break;
      }
    } else {
      const opensAfterEmptyQuotedString = prevOperator === '"' && prevNoBreak && i > from + 1 && tokens.operatorAt(i - 2) === '"';
      const joins = prevNoBreak && data[state].length && (prevOperator !== ")" || lastChars[state] === "@" || value.charAt(0) === "@");
      if (joins) {
        const last = data[state].length - 1;
        if (state === "text" && !insideQuotes) {
          if (lastTextPureQuoted && value.charAt(0) === "@") {
            data.quotedLocalAt[last] = data.text[last].length;
          }
          lastTextPureQuoted = false;
        }
        data[state][last] += value;
        if (state === "text" && insideQuotes) {
          data.textWasQuoted[last] = true;
        }
      } else {
        data[state].push(value);
        if (state === "text") {
          data.textWasQuoted.push(insideQuotes || opensAfterEmptyQuotedString);
          data.quotedLocalAt.push(opensAfterEmptyQuotedString && value.charAt(0) === "@" ? 0 : -1);
          lastTextPureQuoted = insideQuotes;
        }
      }
      lastChars[state] = value.charAt(value.length - 1);
    }
  }
  let textFromComment = false;
  if (!data.text.length && data.comment.length) {
    data.text = data.comment;
    data.comment = [];
    textFromComment = true;
  }
  return { data, textFromComment };
}
__name(collectAddressParts, "collectAddressParts");
function groupName(tokens, from, to) {
  return decodeWords(collectAddressParts(tokens, from, to).data.text.join(" "));
}
__name(groupName, "groupName");
function _handleAddress(tokens, from, to) {
  const collected = collectAddressParts(tokens, from, to);
  const data = collected.data;
  let textFromComment = collected.textFromComment;
  let i;
  const addressComments = [];
  const addressParts = [];
  for (const part of data.address) {
    const stripped = stripAddressComments(part);
    for (const comment of stripped.comments) {
      addressComments.push(comment);
    }
    if (stripped.address) {
      addressParts.push(stripped.address);
    }
  }
  data.address = addressParts;
  if (!data.address.length && data.text.length && !textFromComment) {
    const candidates = data.text.map((part) => collapseAtSpacing(part));
    for (i = 0; i < data.text.length; i++) {
      const local = data.quotedLocalAt[i];
      const quotedLocal = data.textWasQuoted[i] && local >= 0 && QUOTED_LOCAL_DOMAIN.test(data.text[i].slice(local)) ? quoteLocalPart(data.text[i]) : "";
      if (quotedLocal || !data.textWasQuoted[i] && isAddrSpec(candidates[i])) {
        data.address = [quotedLocal || candidates[i]];
        data.text.splice(i, 1);
        data.textWasQuoted.splice(i, 1);
        data.quotedLocalAt.splice(i, 1);
        break;
      }
    }
    if (!data.address.length) {
      for (i = 0; i < data.text.length; i++) {
        if (!data.textWasQuoted[i]) {
          const part = candidates[i];
          const start = looseAddressStart(part);
          if (start >= 0) {
            LOOSE_TEXT_ADDR.lastIndex = start;
            const match = LOOSE_TEXT_ADDR.exec(part);
            if (match) {
              data.address = [match[0].trim()];
              data.text[i] = (part.slice(0, start) + " " + part.slice(start + match[0].length)).trim();
              break;
            }
          }
          data.text[i] = data.text[i].trim();
        }
      }
    }
  }
  if (!data.text.length && data.comment.length) {
    data.text = data.comment;
    data.comment = [];
  }
  if (data.address.length > 1) {
    data.text = data.text.concat(data.address.splice(1));
  }
  const addressFromQuotedText = !data.address.length && data.textWasQuoted.some((wasQuoted) => wasQuoted);
  let text = data.text.join(" ");
  let addressValue = data.address.join(" ");
  if (!addressValue && isEncodedWordsOnly(text.trim())) {
    return { address: "", name: decodeWords(text) };
  }
  if (addressFromQuotedText && text.indexOf("@") >= 0) {
    addressValue = quoteLocalPart(joinAtSpacing(text, domainAt(text)));
    text = "";
  }
  ({ address: addressValue, text } = recoverAddrSpec(addressValue, text));
  if (!text && addressComments.length) {
    text = addressComments.join(" ");
    textFromComment = true;
  }
  const rawName = text || addressValue || "";
  const address = {
    address: addressValue || (textFromComment ? "" : text) || "",
    name: decodeWords(rawName)
  };
  if (address.address === rawName || address.address === address.name) {
    if (address.address.match(/@/)) {
      address.name = "";
    } else {
      address.address = "";
    }
  }
  return address;
}
__name(_handleAddress, "_handleAddress");
var Tokenizer = class {
  static {
    __name(this, "Tokenizer");
  }
  /**
   * @param str Address field string
   */
  constructor(str) {
    this.str = (str || "").toString();
    this.operatorCurrent = "";
    this.operatorExpecting = "";
    this.node = -1;
    this.escaped = false;
    this.inDomainLiteral = false;
    this.afterAt = false;
    this.inGroup = false;
    this.innerQuoted = false;
    this.innerComment = 0;
    this.innerLiteral = false;
    this.innerEscaped = false;
    this.list = new TokenList(this.str);
    this.operators = {
      '"': '"',
      "(": ")",
      "<": ">",
      ",": "",
      // A group is read in the same pass as the rest of the list, so its ':' only marks
      // where the name ends and its members are tokenized like any other address
      ":": "",
      // Semicolons are not a legal delimiter per the RFC2822 grammar other
      // than for terminating a group, but they are also not valid for any
      // other use in this context.  Given that some mail clients have
      // historically allowed the semicolon as a delimiter equivalent to the
      // comma in their UI, it makes sense to treat them the same as a comma
      // when used outside of a group.
      ";": ""
    };
  }
  /**
   * Tokenizes the original input string
   *
   * @return An array of operator|text tokens
   */
  tokenize() {
    const str = this.str;
    const len = str.length;
    for (let i = 0; i < len; i++) {
      this.checkChar(str.charAt(i), i);
    }
    this.closeText(len);
    const list = this.list;
    const slots = list.slots;
    let kept = 0;
    for (let i = 0, count = list.length; i < count; i++) {
      const kind = slots[i * 3];
      let start = slots[i * 3 + 1];
      let end = slots[i * 3 + 2];
      if (kind & TOKEN_DIRTY) {
        const value = this.cleanValue(start, end, kind).trim();
        if (!value) {
          continue;
        }
        list.cleaned.set(kept, value);
      } else if (!(kind & TOKEN_OPERATOR)) {
        while (start < end && isSpaceCode(str.charCodeAt(start))) {
          start++;
        }
        while (end > start && isSpaceCode(str.charCodeAt(end - 1))) {
          end--;
        }
        if (start === end) {
          continue;
        }
      }
      slots[kept * 3] = kind;
      slots[kept * 3 + 1] = start;
      slots[kept * 3 + 2] = end;
      kept++;
    }
    list.length = kept;
    return list;
  }
  /**
   * Ends the text run being collected, if there is one
   *
   * @param end Offset just past its last character
   */
  closeText(end) {
    if (this.node >= 0) {
      this.list.slots[this.node * 3 + 2] = end;
      this.node = -1;
    }
  }
  /**
   * Rebuilds the value of a text run that is no plain slice of the field, applying the
   * rules checkChar collects characters by: an escaping backslash is dropped, a line break
   * reads as a space and any other control character is left out
   *
   * @param start Offset of the first character of the run
   * @param end Offset just past its last character
   * @param kind Kind and flags of the run
   * @return Value of the run
   */
  cleanValue(start, end, kind) {
    const str = this.str;
    const escapes = (kind & TOKEN_ESCAPES) !== 0;
    let escaped = (kind & TOKEN_STARTS_ESCAPED) !== 0;
    let value = "";
    for (let i = start; i < end; i++) {
      const chr = str.charAt(i);
      if (escapes && !escaped && chr === "\\") {
        escaped = true;
        continue;
      }
      escaped = false;
      if (chr === "\n") {
        value += " ";
      } else if (chr.charCodeAt(0) >= 33 || chr === " " || chr === "	") {
        value += chr;
      }
    }
    return value;
  }
  /**
   * Checks if a character is an operator or text and acts accordingly
   *
   * @param chr Character from the address field
   * @param i Offset of the character in the field
   */
  checkChar(chr, i) {
    if (!this.escaped && !this.operatorExpecting) {
      if (!this.inDomainLiteral && chr === "[" && this.afterAt) {
        this.inDomainLiteral = true;
      } else if (this.inDomainLiteral && (chr === "]" || chr === "," || chr === ";")) {
        this.inDomainLiteral = false;
      }
    }
    let nested = false;
    if (this.operatorExpecting === ">") {
      nested = this.trackInner(chr);
      if (!nested && chr === ";" && this.inGroup) {
        this.closeText(i);
        this.operatorExpecting = "";
        this.resetInner();
      }
    } else if (this.operatorExpecting === ")" && !this.escaped) {
      if (chr === "(") {
        this.innerComment++;
      } else if (chr === ")" && this.innerComment) {
        this.innerComment--;
        nested = true;
      }
    }
    if (this.escaped) {
    } else if (chr === this.operatorExpecting && !nested) {
      const nextChr = this.str.charAt(i + 1);
      this.closeText(i);
      this.list.push(nextChr && ![" ", "	", "\r", "\n", ",", ";"].includes(nextChr) ? TOKEN_OPERATOR | TOKEN_NO_BREAK : TOKEN_OPERATOR, i, i + 1);
      if (chr !== ")") {
        this.afterAt = false;
      }
      this.operatorExpecting = "";
      this.escaped = false;
      this.resetInner();
      return;
    } else if (!this.operatorExpecting && !(this.inDomainLiteral && chr === ":") && chr in this.operators) {
      this.closeText(i);
      this.list.push(TOKEN_OPERATOR, i, i + 1);
      if (chr === ":") {
        this.inGroup = true;
      } else if (chr === ";") {
        this.inGroup = false;
      }
      if (chr !== "(") {
        this.afterAt = false;
      }
      this.operatorExpecting = this.operators[chr];
      this.escaped = false;
      this.resetInner();
      return;
    } else if ((this.operatorExpecting === '"' || this.operatorExpecting === ")") && chr === "\\") {
      this.escaped = true;
      if (this.node >= 0) {
        this.list.slots[this.node * 3] |= TOKEN_DIRTY;
      }
      return;
    }
    if (this.node < 0) {
      this.node = this.list.push((this.operatorExpecting === '"' || this.operatorExpecting === ")" ? TOKEN_ESCAPES : 0) | (this.escaped ? TOKEN_STARTS_ESCAPED : 0), i, i);
    }
    if (chr === "\n") {
      chr = " ";
      this.list.slots[this.node * 3] |= TOKEN_DIRTY;
    }
    if (chr.charCodeAt(0) >= 33 || chr === " " || chr === "	") {
      if (!this.operatorExpecting && chr !== " " && chr !== "	") {
        this.afterAt = chr === "@";
      }
    } else {
      this.list.slots[this.node * 3] |= TOKEN_DIRTY;
    }
    this.escaped = false;
  }
  /**
   * Tracks the quoted strings, comments and domain literals inside an angle-addr, which its
   * closer must not be read from. A backslash escapes the next character inside a quoted
   * string and a comment. A domain literal opens right after an "@" and ends at the "]".
   * dtext holds the list separators as well, and inside the brackets they never split the
   * list anyway.
   *
   * @param chr Character from the address field
   * @return true while the character sits inside one of them, the one that closes it included
   */
  trackInner(chr) {
    if (this.innerEscaped) {
      this.innerEscaped = false;
      return true;
    }
    if (this.innerQuoted) {
      if (chr === "\\") {
        this.innerEscaped = true;
      } else if (chr === '"') {
        this.innerQuoted = false;
      }
      return true;
    }
    if (this.innerComment) {
      if (chr === "\\") {
        this.innerEscaped = true;
      } else if (chr === "(") {
        this.innerComment++;
      } else if (chr === ")") {
        this.innerComment--;
      }
      return true;
    }
    if (this.innerLiteral) {
      if (chr === "]") {
        this.innerLiteral = false;
      }
      return true;
    }
    if (chr === '"') {
      this.innerQuoted = true;
      return true;
    }
    if (chr === "(") {
      this.innerComment = 1;
      return true;
    }
    if (chr === "[" && this.afterAt) {
      this.innerLiteral = true;
      return true;
    }
    if (!isSpaceCode(chr.charCodeAt(0))) {
      this.afterAt = chr === "@";
    }
    return false;
  }
  /**
   * Forgets the nesting collected for the operator that just opened or ended
   */
  resetInner() {
    this.innerQuoted = false;
    this.innerComment = 0;
    this.innerLiteral = false;
    this.innerEscaped = false;
  }
};
function mergeNameFragments(list) {
  const merged = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const current = list[i];
    const next = merged.length ? merged[merged.length - 1] : null;
    if (next && current.address === "" && current.name && !current.group && next.address && next.name) {
      next.name = current.name + ", " + next.name;
    } else {
      merged.push(current);
    }
  }
  return merged.reverse();
}
__name(mergeNameFragments, "mergeNameFragments");
function parseAddressList(str) {
  const tokens = new Tokenizer(str).tokenize();
  const parsedAddresses = [];
  let group = null;
  let members = [];
  let from = 0;
  for (let i = 0, len = tokens.length; i <= len; i++) {
    const operator = i < len ? tokens.operatorAt(i) : "";
    if (i < len && operator !== "," && operator !== ";" && operator !== ":") {
      continue;
    }
    if (operator === ":") {
      if (!group) {
        group = { name: groupName(tokens, from, i), group: [] };
        members = [];
      }
      from = i + 1;
      continue;
    }
    if (i > from) {
      (group ? members : parsedAddresses).push(_handleAddress(tokens, from, i));
    }
    from = i + 1;
    if (group && (operator === ";" || i === len)) {
      group.group = mergeNameFragments(members);
      parsedAddresses.push(group);
      group = null;
    }
  }
  return mergeNameFragments(parsedAddresses);
}
__name(parseAddressList, "parseAddressList");
function addressParser(str, options) {
  const parsedAddresses = parseAddressList(str);
  if (options && options.flatten) {
    let addresses = [];
    let walkAddressList = /* @__PURE__ */ __name((list) => {
      list.forEach((address) => {
        if (address.group) {
          return walkAddressList(address.group);
        } else {
          addresses.push(address);
        }
      });
    }, "walkAddressList");
    walkAddressList(parsedAddresses);
    return addresses;
  }
  return parsedAddresses;
}
__name(addressParser, "addressParser");
var address_parser_default = addressParser;

// node_modules/postal-mime/dist/esm/base64-encoder.js
function base64ArrayBuffer(arrayBuffer) {
  let base642 = "";
  const encodings = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = new Uint8Array(arrayBuffer);
  const byteLength = bytes.byteLength;
  const byteRemainder = byteLength % 3;
  const mainLength = byteLength - byteRemainder;
  let a, b, c, d;
  let chunk;
  for (let i = 0; i < mainLength; i = i + 3) {
    chunk = bytes[i] << 16 | bytes[i + 1] << 8 | bytes[i + 2];
    a = (chunk & 16515072) >> 18;
    b = (chunk & 258048) >> 12;
    c = (chunk & 4032) >> 6;
    d = chunk & 63;
    base642 += encodings[a] + encodings[b] + encodings[c] + encodings[d];
  }
  if (byteRemainder === 1) {
    chunk = bytes[mainLength];
    a = (chunk & 252) >> 2;
    b = (chunk & 3) << 4;
    base642 += encodings[a] + encodings[b] + "==";
  } else if (byteRemainder === 2) {
    chunk = bytes[mainLength] << 8 | bytes[mainLength + 1];
    a = (chunk & 64512) >> 10;
    b = (chunk & 1008) >> 4;
    c = (chunk & 15) << 2;
    base642 += encodings[a] + encodings[b] + encodings[c] + "=";
  }
  return base642;
}
__name(base64ArrayBuffer, "base64ArrayBuffer");

// node_modules/postal-mime/dist/esm/postal-mime.js
function isReadableStream(value) {
  return !!value && typeof value.getReader === "function";
}
__name(isReadableStream, "isReadableStream");
function isBlob(value) {
  return value instanceof Blob || Object.prototype.toString.call(value) === "[object Blob]";
}
__name(isBlob, "isBlob");
function isArrayBuffer(value) {
  const tag = Object.prototype.toString.call(value);
  return tag === "[object ArrayBuffer]" || tag === "[object SharedArrayBuffer]";
}
__name(isArrayBuffer, "isArrayBuffer");
var ATTACHMENT_ENCODINGS = /* @__PURE__ */ new Set(["arraybuffer", "base64", "utf8"]);
function parseAttachmentEncoding(value) {
  const encoding = String(value || "").replace(/[-_\s]/g, "").toLowerCase() || "arraybuffer";
  if (!ATTACHMENT_ENCODINGS.has(encoding)) {
    throw createError("EINVALIDOPTION", `Unknown attachment encoding ${encoding}`);
  }
  return encoding;
}
__name(parseAttachmentEncoding, "parseAttachmentEncoding");
function renderEntry(textEntry, textType, convert) {
  if (textEntry.type === "subMessage") {
    return textType === "html" ? formatHtmlHeader(textEntry.value) : formatTextHeader(textEntry.value);
  }
  if (!convert) {
    return textEntry.value;
  }
  return textType === "html" ? textToHtml(textEntry.value) : htmlToText(textEntry.value);
}
__name(renderEntry, "renderEntry");
var LINE_FEED = new Uint8Array([10]);
var MAX_NESTING_DEPTH = 256;
var MAX_HEADERS_SIZE = 2 * 1024 * 1024;
var MAX_PART_COUNT = 1e4;
var MAX_RFC822_NESTING_DEPTH = 10;
var MAX_FORWARDED_ADDRESSES = 1e4;
function countAddresses(addresses) {
  if (!addresses) {
    return 0;
  }
  let count = 0;
  for (const address of Array.isArray(addresses) ? addresses : [addresses]) {
    count += 1 + (address.group ? address.group.length : 0);
  }
  return count;
}
__name(countAddresses, "countAddresses");
function parseLimitOption(value, defaultValue, name, min = 0) {
  if (value === void 0 || value === null) {
    return defaultValue;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw createError("EINVALIDOPTION", `${name} must be a ${min ? "positive" : "non-negative"} integer`);
  }
  return value;
}
__name(parseLimitOption, "parseLimitOption");
function parseLimits(options) {
  return {
    maxNestingDepth: parseLimitOption(options.maxNestingDepth, MAX_NESTING_DEPTH, "maxNestingDepth"),
    maxHeadersSize: parseLimitOption(options.maxHeadersSize, MAX_HEADERS_SIZE, "maxHeadersSize"),
    // The root part is always counted, so a limit of zero can parse nothing, not even
    // an empty message, and it threw EMAXPARTCOUNT from the constructor, where only
    // EINVALIDOPTION is thrown
    maxPartCount: parseLimitOption(options.maxPartCount, MAX_PART_COUNT, "maxPartCount", 1),
    // A limit of 0 disables inline parsing entirely, so every message/rfc822 part
    // becomes an attachment.
    maxRfc822NestingDepth: parseLimitOption(options.maxRfc822NestingDepth, MAX_RFC822_NESTING_DEPTH, "maxRfc822NestingDepth"),
    maxForwardedAddresses: parseLimitOption(options.maxForwardedAddresses, MAX_FORWARDED_ADDRESSES, "maxForwardedAddresses")
  };
}
__name(parseLimits, "parseLimits");
var PostalMime = class _PostalMime {
  static {
    __name(this, "PostalMime");
  }
  /**
   * Parses a raw email message
   *
   * @param buf Raw email message
   * @param options Parser options
   * @returns The parsed email
   */
  // async so that an invalid option rejects the returned promise instead of throwing
  // synchronously, which would escape a `.catch()` chain
  static async parse(buf, options) {
    const parser = new _PostalMime(options);
    return parser.parse(buf);
  }
  constructor(options, parent) {
    this.options = options || {};
    this.rfc822NestingDepth = parent ? parent.rfc822NestingDepth + 1 : 0;
    this.limits = parent ? parent.limits : parseLimits(this.options);
    this.counters = parent ? parent.counters : { headerSize: 0, partCount: 0, forwardedAddresses: 0 };
    this.root = this.currentNode = new MimeNode({ postalMime: this });
    this.boundaries = [];
    this.textContent = {};
    this.textMap = /* @__PURE__ */ new Map();
    this.textTypes = /* @__PURE__ */ new Set();
    this.attachments = [];
    this.forceRfc822Attachments = false;
    this.attachmentEncoding = parseAttachmentEncoding(this.options.attachmentEncoding);
    this.started = false;
  }
  /** @internal */
  async finalize() {
    await this.root.finalize();
  }
  /** @internal */
  async processLine(line, lineBreak, isFinal) {
    let boundaries = this.boundaries;
    if (boundaries.length && line.length > 2 && line[0] === 45 && line[1] === 45) {
      for (let i = 0; i < boundaries.length; i++) {
        let boundary = boundaries[i];
        if (line.length < boundary.value.length + 2) {
          continue;
        }
        let boundaryMatches = true;
        for (let j = 0; j < boundary.value.length; j++) {
          if (line[j + 2] !== boundary.value[j]) {
            boundaryMatches = false;
            break;
          }
        }
        if (!boundaryMatches) {
          continue;
        }
        let boundaryEnd = boundary.value.length + 2;
        let isTerminator = false;
        if (line.length >= boundary.value.length + 4 && line[boundary.value.length + 2] === 45 && line[boundary.value.length + 3] === 45) {
          isTerminator = true;
          boundaryEnd = boundary.value.length + 4;
        }
        let hasValidTrailing = true;
        for (let j = boundaryEnd; j < line.length; j++) {
          if (!isWsp(line[j])) {
            hasValidTrailing = false;
            break;
          }
        }
        if (!hasValidTrailing) {
          continue;
        }
        if (isTerminator) {
          await boundary.node.finalize(true);
          this.currentNode = boundary.node.parentNode || this.root;
        } else {
          await boundary.node.finalizeChildNodes(true);
          this.currentNode = new MimeNode({
            postalMime: this,
            parentNode: boundary.node,
            parentMultipartType: boundary.node.contentType.multipart
          });
        }
        if (isFinal) {
          return this.finalize();
        }
        return;
      }
    }
    if (this.currentNode.feed(line, lineBreak)) {
      return this.processLine(line, lineBreak, isFinal);
    }
    if (isFinal) {
      return this.finalize();
    }
  }
  // Reads the next line without its line break. The break itself, the exact bytes between
  // the line and the next one, is returned alongside, because the body decoders write it
  // back out: a part has to keep the line endings it was sent with, see PassThroughDecoder.
  /** @internal */
  readLine() {
    let startPos = this.readPos;
    let endPos = this.readPos;
    while (this.readPos < this.av.length) {
      const c = this.av[this.readPos++];
      if (c !== 13 && c !== 10) {
        endPos = this.readPos;
      }
      if (c === 10) {
        return {
          bytes: new Uint8Array(this.buf, startPos, endPos - startPos),
          lineBreak: this.av.subarray(endPos, this.readPos),
          done: this.readPos >= this.av.length
        };
      }
    }
    return {
      bytes: new Uint8Array(this.buf, startPos, endPos - startPos),
      lineBreak: LINE_FEED,
      done: this.readPos >= this.av.length
    };
  }
  // Records a text part or a nested message under the node that selects it
  /** @internal */
  addTextEntry(selector, textType, item) {
    let textEntry = this.textMap.get(selector);
    if (!textEntry) {
      textEntry = {};
      this.textMap.set(selector, textEntry);
    }
    const entries = textEntry[textType] || [];
    textEntry[textType] = entries;
    entries.push(item);
    this.textTypes.add(textType);
  }
  // Sorts every leaf of the tree into text content, nested messages and attachments.
  // `alternative` is the closest enclosing multipart/alternative, if any: its text parts
  // are collected under the alternative itself, so that the body is assembled from one
  // representation of it rather than from every one. `related` tells whether the part
  // sits inside a multipart/related, where a Content-ID makes it an inline resource
  /** @internal */
  async collectNode(node, alternative, related) {
    if (!node.contentType.multipart) {
      const inlineRfc822 = this.isInlineMessageRfc822(node);
      const rfc822DepthExceeded = inlineRfc822 && this.rfc822NestingDepth >= this.limits.maxRfc822NestingDepth;
      if (inlineRfc822 && !rfc822DepthExceeded) {
        await this.collectSubMessage(node);
      } else if (this.isInlineTextNode(node)) {
        const textType = node.contentType.parsed.value === "text/html" ? "html" : "plain";
        this.addTextEntry(alternative || node, textType, { type: "text", value: node.getTextContent() });
      } else if (node.content) {
        this.collectAttachment(node, node.content, related, rfc822DepthExceeded);
      }
    } else if (node.contentType.multipart === "alternative") {
      alternative = node;
    } else if (node.contentType.multipart === "related") {
      related = true;
    }
    for (let childNode of node.childNodes) {
      await this.collectNode(childNode, alternative, related);
    }
  }
  // Parses an inline message/rfc822 part with a nested parser and takes over its text
  // parts and attachments
  /** @internal */
  async collectSubMessage(node) {
    const subParser = new _PostalMime({
      // Options that decide how a part is classified stay with the parser that
      // was configured, the limits and their counters come from this parser.
      // Attachments are encoded by the parent parser, so raw buffers are kept here.
      attachmentEncoding: "arraybuffer"
    }, this);
    const subMessage = await subParser.parse(node.content || new ArrayBuffer(0));
    this.counters.forwardedAddresses += countAddresses(subMessage.from) + countAddresses(subMessage.to) + countAddresses(subMessage.cc) + countAddresses(subMessage.bcc);
    if (this.counters.forwardedAddresses > this.limits.maxForwardedAddresses) {
      throw createError("EMAXFORWARDEDADDRESSES", `Maximum forwarded address count of ${this.limits.maxForwardedAddresses} addresses exceeded`);
    }
    const hasPlain = subParser.textTypes.has("plain");
    const hasHtml = subParser.textTypes.has("html");
    if (hasPlain || !hasHtml) {
      this.addTextEntry(node, "plain", { type: "subMessage", value: subMessage });
    }
    if (hasHtml) {
      this.addTextEntry(node, "html", { type: "subMessage", value: subMessage });
    }
    subParser.textMap.forEach((subTextEntry, subTextNode) => {
      this.textMap.set(subTextNode, subTextEntry);
    });
    for (let attachment of subMessage.attachments) {
      this.attachments.push(attachment);
    }
  }
  /** @internal */
  collectAttachment(node, content, related, rfc822DepthExceeded) {
    const filename = node.contentDisposition.parsed.params.filename || node.contentType.parsed.params.name || null;
    const attachment = {
      // An RFC 2231 filename is percent decoded without folding, since the same decoder
      // produces the boundary, so the fold happens here, see foldLineBreaks
      filename: filename ? decodeWords(foldLineBreaks(filename)) : null,
      mimeType: node.contentType.parsed.value,
      disposition: node.contentDisposition.parsed.value || null
    };
    if (related && node.contentId && !rfc822DepthExceeded) {
      attachment.related = true;
    }
    if (rfc822DepthExceeded) {
      attachment.rfc822DepthExceeded = true;
    }
    if (node.contentDescription) {
      attachment.description = decodeWords(node.contentDescription);
    }
    if (node.contentId) {
      attachment.contentId = node.contentId;
    }
    switch (node.contentType.parsed.value) {
      // Special handling for calendar events
      case "text/calendar":
      case "application/ics": {
        if (node.contentType.parsed.params.method) {
          attachment.method = node.contentType.parsed.params.method.toString().toUpperCase().trim();
        }
        const decodedText = node.getTextContent();
        let end = decodedText.length;
        while (end > 0 && decodedText.charCodeAt(end - 1) === 10) {
          end--;
        }
        attachment.content = textEncoder.encode(decodedText.slice(0, end) + "\n");
        break;
      }
      // Regular attachments
      default:
        attachment.content = content;
    }
    this.attachments.push(attachment);
  }
  // Joins the collected text parts into the plain and html bodies
  /** @internal */
  renderTextContent() {
    const textContent = {};
    this.textMap.forEach((mapEntry) => {
      this.textTypes.forEach((textType) => {
        const output = textContent[textType] || [];
        textContent[textType] = output;
        const ownEntries = mapEntry[textType];
        const entries = ownEntries || mapEntry[textType === "html" ? "plain" : "html"] || [];
        for (const textEntry of entries) {
          output.push(renderEntry(textEntry, textType, !ownEntries));
        }
      });
    });
    Object.keys(textContent).forEach((textType) => {
      this.textContent[textType] = textContent[textType].join("\n");
    });
  }
  /** @internal */
  isInlineTextNode(node) {
    if (node.contentDisposition.parsed.value === "attachment") {
      return false;
    }
    switch (node.contentType.parsed.value) {
      case "text/html":
      case "text/plain":
        return true;
      case "text/calendar":
      case "text/csv":
      default:
        return false;
    }
  }
  /** @internal */
  isInlineMessageRfc822(node) {
    if (this.forceRfc822Attachments || node.contentType.parsed.value !== "message/rfc822") {
      return false;
    }
    const encoding = node.contentTransferEncoding.encoding;
    if (encoding === "base64" || encoding === "quoted-printable") {
      return false;
    }
    let disposition = node.contentDisposition.parsed.value || (this.options.rfc822Attachments ? "attachment" : "inline");
    return disposition === "inline";
  }
  // A delivery status or feedback report carries the offending message as a part. It is
  // evidence rather than content, so it is not inlined into the body of the report
  /** @internal */
  hasReportParts() {
    let found = false;
    let walk = /* @__PURE__ */ __name((node) => {
      if (!node.contentType.multipart) {
        if (["message/delivery-status", "message/feedback-report"].includes(node.contentType.parsed.value)) {
          found = true;
        }
      }
      for (let childNode of node.childNodes) {
        walk(childNode);
      }
    }, "walk");
    walk(this.root);
    return found;
  }
  /** @internal */
  async resolveStream(stream) {
    let chunkLen = 0;
    let chunks = [];
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!ArrayBuffer.isView(value)) {
        const error = createError("EINVALIDINPUT", "Stream chunks must be Uint8Array values");
        reader.cancel(error).catch(() => {
        });
        throw error;
      }
      chunks.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      chunkLen += value.byteLength;
    }
    const result = new Uint8Array(chunkLen);
    let chunkPointer = 0;
    for (let chunk of chunks) {
      result.set(chunk, chunkPointer);
      chunkPointer += chunk.length;
    }
    return result;
  }
  /** @internal */
  async resolveInput(buf) {
    let input = buf;
    if (isReadableStream(input)) {
      input = await this.resolveStream(input);
    }
    input = input || new ArrayBuffer(0);
    if (typeof input === "string") {
      input = textEncoder.encode(input);
    }
    if (isBlob(input)) {
      input = await blobToArrayBuffer(input);
    }
    if (ArrayBuffer.isView(input)) {
      return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    }
    if (!isArrayBuffer(input)) {
      throw createError("EINVALIDINPUT", "Unsupported email input type");
    }
    return input;
  }
  // Properties are added in the order the output has always had them, so the required
  // ones are filled in below rather than in the literal
  /** @internal */
  buildMessage() {
    const headers = this.root.headers;
    const message = {
      headers: headers.map((entry) => ({
        key: entry.key,
        originalKey: entry.originalKey,
        value: entry.value
      }))
    };
    for (const key of ["from", "sender"]) {
      const addressHeader = headers.find((line) => line.key === key);
      if (addressHeader && addressHeader.value) {
        const addresses = address_parser_default(addressHeader.value);
        if (addresses && addresses.length) {
          message[key] = addresses[0];
        }
      }
    }
    for (const [key, camelKey] of [
      ["delivered-to", "deliveredTo"],
      ["return-path", "returnPath"]
    ]) {
      const addressHeader = headers.find((line) => line.key === key);
      if (addressHeader && addressHeader.value) {
        const addresses = address_parser_default(addressHeader.value);
        if (addresses && addresses.length && addresses[0].address) {
          message[camelKey] = addresses[0].address;
        }
      }
    }
    for (const [key, camelKey] of [
      ["to", "to"],
      ["cc", "cc"],
      ["bcc", "bcc"],
      ["reply-to", "replyTo"]
    ]) {
      const addresses = [];
      for (const entry of headers) {
        if (entry.key === key && entry.value) {
          for (const address of address_parser_default(entry.value)) {
            addresses.push(address);
          }
        }
      }
      if (addresses.length) {
        message[camelKey] = addresses;
      }
    }
    for (const [key, camelKey] of [
      ["subject", "subject"],
      ["message-id", "messageId"],
      ["in-reply-to", "inReplyTo"],
      ["references", "references"]
    ]) {
      const header = headers.find((line) => line.key === key);
      if (header && header.value) {
        message[camelKey] = decodeWords(header.value);
      }
    }
    let dateHeader = headers.find((line) => line.key === "date");
    if (dateHeader) {
      let date = new Date(dateHeader.value);
      message.date = date.toString() === "Invalid Date" ? dateHeader.value : date.toISOString();
    }
    if (this.textContent.html) {
      message.html = this.textContent.html;
    }
    if (this.textContent.plain) {
      message.text = this.textContent.plain;
    }
    message.attachments = this.attachments;
    message.headerLines = this.root.rawHeaderLines.slice();
    return message;
  }
  // Every attachment holds binary content at this point, since nested parsers are
  // created with the arraybuffer encoding. The string check narrows the public content
  // type rather than handling a reachable case
  /** @internal */
  encodeAttachments() {
    switch (this.attachmentEncoding) {
      case "arraybuffer":
        break;
      case "base64":
        for (let attachment of this.attachments) {
          if (attachment.content && typeof attachment.content !== "string") {
            attachment.content = base64ArrayBuffer(attachment.content);
            attachment.encoding = "base64";
          }
        }
        break;
      case "utf8": {
        let attachmentDecoder = new TextDecoder("utf8");
        for (let attachment of this.attachments) {
          if (attachment.content && typeof attachment.content !== "string") {
            attachment.content = attachmentDecoder.decode(attachment.content);
            attachment.encoding = "utf8";
          }
        }
        break;
      }
    }
  }
  /**
   * Parses a raw email message. A parser instance can be used once
   *
   * @param buf Raw email message
   * @returns The parsed email
   */
  async parse(buf) {
    if (this.started) {
      throw createError("EPARSERREUSED", "Can not reuse parser, create a new PostalMime object");
    }
    this.started = true;
    this.buf = await this.resolveInput(buf);
    this.av = new Uint8Array(this.buf);
    this.readPos = 0;
    while (this.readPos < this.av.length) {
      const line = this.readLine();
      await this.processLine(line.bytes, line.lineBreak, line.done);
    }
    this.forceRfc822Attachments = Boolean(this.options.forceRfc822Attachments) || this.hasReportParts();
    await this.collectNode(this.root, false, false);
    if (this.rfc822NestingDepth === 0) {
      this.renderTextContent();
    }
    const message = this.buildMessage();
    this.encodeAttachments();
    return message;
  }
};

// src/mail/incoming-email.js
function headerValue(parsed, name) {
  const headers = parsed?.headers || [];
  const found = headers.find((header) => header.key === name);
  return found?.value || "";
}
__name(headerValue, "headerValue");
function mailboxList(value) {
  if (!value) return "";
  const list = Array.isArray(value) ? value : [value];
  const emails = [];
  for (const item of list) {
    if (item?.group) emails.push(...item.group.map((member) => member.address));
    else if (item?.address) emails.push(item.address);
    else if (typeof item === "string") emails.push(item);
  }
  return addressList(emails.join(", "));
}
__name(mailboxList, "mailboxList");
var ROUTING_ADDRESSES = /* @__PURE__ */ new Set(["notify@kimitotalk.link", "reply@kimitotalk.link"]);
function ownerOf(parsed, message) {
  const forwarded = headerValue(parsed, "x-forwarded-for") || message?.headers?.get?.("x-forwarded-for") || "";
  const fromHeader = addressList(forwarded);
  if (fromHeader) return fromHeader.split(", ")[0];
  const envelope = addressList(message?.from || "");
  const first = envelope.split(", ")[0] || "";
  if (first && !ROUTING_ADDRESSES.has(first)) return first;
  return "";
}
__name(ownerOf, "ownerOf");
function threadFromParsed(parsed, message) {
  const from = mailboxList(parsed.from);
  const replyTo = mailboxList(parsed.replyTo) || from;
  return {
    message_id: clip(parsed.messageId, 300),
    reply_to_address: replyTo,
    from_address: from,
    to_address: mailboxList(parsed.to),
    cc_address: mailboxList(parsed.cc),
    bcc_address: mailboxList(parsed.bcc),
    subject: parsed.subject || "",
    in_reply_to: parsed.inReplyTo || "",
    reference_ids: parsed.references || "",
    quote_text: clip(parsed.text || "", 280),
    received_at: parsed.date ? Date.parse(parsed.date) || Date.now() : Date.now(),
    owner: ownerOf(parsed, message)
  };
}
__name(threadFromParsed, "threadFromParsed");
async function handleIncomingEmail(message, env) {
  try {
    const raw = await new Response(message.raw).arrayBuffer();
    const parsed = await PostalMime.parse(raw);
    const fields = threadFromParsed(parsed, message);
    if (!fields.message_id) {
      const bytes = crypto.getRandomValues(new Uint8Array(8));
      const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      fields.message_id = `<${hex}@kimitotalk.link>`;
    }
    return await recordEmailThread(env, fields);
  } catch (error) {
    return { ok: false, reason: "parse_failed" };
  }
}
__name(handleIncomingEmail, "handleIncomingEmail");

// src/mail/links.js
var INDEX_KEY2 = "mail-link-index";
function linkKey(address) {
  return `mail-link:${address}`;
}
__name(linkKey, "linkKey");
async function readIndex(env) {
  if (!env.CHATGPT_KV) return [];
  const raw = await env.CHATGPT_KV.get(INDEX_KEY2);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
__name(readIndex, "readIndex");
function blankLink(fields) {
  return {
    kind: fields.kind === "customer" ? "customer" : "operator",
    address: fields.address,
    provider: fields.provider,
    password_enc: fields.password_enc || "",
    status: fields.status || "pending",
    setup_code_hash: fields.setup_code_hash || "",
    setup_expires_at: fields.setup_expires_at || 0,
    attempts: fields.attempts || 0,
    verified_at: fields.verified_at || 0,
    last_poll_at: fields.last_poll_at || 0,
    last_result: fields.last_result || "",
    imap_state: fields.imap_state || null,
    sent_ids: Array.isArray(fields.sent_ids) ? fields.sent_ids : [],
    servers_json: fields.servers_json || null,
    owner: fields.owner || ""
  };
}
__name(blankLink, "blankLink");
async function putLink(env, link) {
  const address = normalizeEmail(link.address);
  if (!env.CHATGPT_KV || !address) return { ok: false, reason: "invalid_link" };
  const stored = blankLink({ ...link, address });
  await env.CHATGPT_KV.put(linkKey(address), JSON.stringify(stored));
  const index = [address, ...(await readIndex(env)).filter((entry) => entry !== address)].slice(0, 100);
  await env.CHATGPT_KV.put(INDEX_KEY2, JSON.stringify(index));
  return { ok: true, link: stored };
}
__name(putLink, "putLink");
async function getLink(env, address) {
  const email = normalizeEmail(address);
  if (!env.CHATGPT_KV || !email) return null;
  const raw = await env.CHATGPT_KV.get(linkKey(email));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
__name(getLink, "getLink");
async function listLinks(env, owner = "") {
  if (!env.CHATGPT_KV) return [];
  const links = [];
  for (const address of await readIndex(env)) {
    const link = await getLink(env, address);
    if (!link) continue;
    if (owner && link.owner && link.owner !== owner) continue;
    links.push(link);
  }
  return links;
}
__name(listLinks, "listLinks");
async function issueSetupCode(env, fields) {
  const address = normalizeEmail(fields.address);
  if (!address) return { ok: false, reason: "invalid_email" };
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const code = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const saved = await putLink(env, {
    kind: fields.kind,
    address,
    provider: fields.provider,
    owner: normalizeEmail(fields.owner || "") || address,
    status: "pending",
    setup_code_hash: await digest(code),
    setup_expires_at: Date.now() + 10 * 60 * 1e3,
    attempts: 0,
    servers_json: fields.servers_json || null
  });
  if (!saved.ok) return saved;
  return { ok: true, code, expiresAt: saved.link.setup_expires_at, link: saved.link };
}
__name(issueSetupCode, "issueSetupCode");
async function findLinkByCode(env, code) {
  const token2 = clip(code, 80);
  if (!/^[0-9a-f]{32}$/i.test(token2)) return null;
  const hash = await digest(token2);
  for (const link of await listLinks(env)) {
    if (link.setup_code_hash && timingSafeEqual(link.setup_code_hash, hash)) return link;
  }
  return null;
}
__name(findLinkByCode, "findLinkByCode");
async function addSentId(env, address, messageId) {
  const link = await getLink(env, address);
  if (!link) return { ok: false };
  const sent = [messageId, ...(link.sent_ids || []).filter((id) => id !== messageId)].slice(0, 200);
  return putLink(env, { ...link, sent_ids: sent, status: "active", last_result: "sent" });
}
__name(addSentId, "addSentId");
async function markLinkError(env, address, result) {
  const link = await getLink(env, address);
  if (!link) return { ok: false };
  return putLink(env, { ...link, status: "error", last_result: clip(result, 200) });
}
__name(markLinkError, "markLinkError");

// src/mail/crypto.js
function parseHex(hex) {
  const text = String(hex || "").trim();
  if (!/^[0-9a-fA-F]+$/.test(text) || text.length % 2) return null;
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
__name(parseHex, "parseHex");
function hexToBytes2(hex) {
  const bytes = parseHex(hex);
  if (!bytes || bytes.length !== 32) return null;
  return bytes;
}
__name(hexToBytes2, "hexToBytes");
function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(bytesToHex, "bytesToHex");
async function importKey(keyHex) {
  const raw = hexToBytes2(keyHex);
  if (!raw) return null;
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
__name(importKey, "importKey");
async function encryptSecret(keyHex, plaintext) {
  const key = await importKey(keyHex);
  if (!key) return { ok: false, reason: "mail_key_missing" };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(String(plaintext)));
  return { ok: true, packed: `v1:${bytesToHex(iv)}:${bytesToHex(new Uint8Array(cipher))}` };
}
__name(encryptSecret, "encryptSecret");
async function decryptSecret(keyHex, packed) {
  const key = await importKey(keyHex);
  const parts = String(packed || "").split(":");
  if (!key || parts.length !== 3 || parts[0] !== "v1") return { ok: false, reason: "mail_key_missing" };
  const iv = parseHex(parts[1]);
  const cipher = parseHex(parts[2]);
  if (!iv || iv.length !== 12 || !cipher) return { ok: false, reason: "mail_secret_corrupt" };
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    return { ok: true, plain: new TextDecoder().decode(plain) };
  } catch {
    return { ok: false, reason: "mail_secret_corrupt" };
  }
}
__name(decryptSecret, "decryptSecret");

// src/mail/microsoft.js
var AUTH_URL2 = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
var TOKEN_URL3 = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
var MS_SCOPES = "offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send";
function msOauthEnabled(env) {
  return env.MS_OAUTH_ENABLED === "1" && Boolean(env.MS_CLIENT_ID) && Boolean(env.MS_CLIENT_SECRET);
}
__name(msOauthEnabled, "msOauthEnabled");
function msRedirectUri(env) {
  const base = String(env.WORKER_PUBLIC_URL || "https://reply.kimitotalk.link").replace(/\/$/, "");
  return `${base}/auth/ms/callback`;
}
__name(msRedirectUri, "msRedirectUri");
function buildMicrosoftAuthUrl(env, state, loginHint) {
  const params = new URLSearchParams({
    client_id: env.MS_CLIENT_ID,
    response_type: "code",
    redirect_uri: msRedirectUri(env),
    response_mode: "query",
    scope: MS_SCOPES,
    prompt: "select_account",
    state
  });
  if (loginHint) params.set("login_hint", loginHint);
  return `${AUTH_URL2}?${params.toString()}`;
}
__name(buildMicrosoftAuthUrl, "buildMicrosoftAuthUrl");
async function tokenRequest(env, body, fetchImpl) {
  const response = await fetchImpl(TOKEN_URL3, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body)
  });
  const json4 = await response.json().catch(() => ({}));
  if (!response.ok || !json4.access_token) return { ok: false, reason: "ms_token_failed" };
  return { ok: true, json: json4 };
}
__name(tokenRequest, "tokenRequest");
function emailFromIdToken(idToken) {
  const parts = String(idToken || "").split(".");
  if (parts.length < 2) return "";
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json4 = JSON.parse(atob(padded));
    return String(json4.email || json4.preferred_username || "").toLowerCase();
  } catch {
    return "";
  }
}
__name(emailFromIdToken, "emailFromIdToken");
async function exchangeMicrosoftCode(env, code, loginHint, fetchImpl = fetch) {
  if (!msOauthEnabled(env) || !env.CHATGPT_KV) return { ok: false, reason: "ms_not_configured" };
  const token2 = await tokenRequest(
    env,
    {
      client_id: env.MS_CLIENT_ID,
      client_secret: env.MS_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: msRedirectUri(env),
      scope: MS_SCOPES
    },
    fetchImpl
  );
  if (!token2.ok || !token2.json.refresh_token) return { ok: false, reason: "ms_code_rejected" };
  const email = emailFromIdToken(token2.json.id_token) || String(loginHint || "").toLowerCase();
  if (!email.includes("@")) return { ok: false, reason: "ms_profile_failed" };
  const packed = await encryptSecret(env.MAIL_TOKEN_ENCRYPTION_KEY, `msrt:${token2.json.refresh_token}`);
  if (!packed.ok) return packed;
  const saved = await putLink(env, {
    kind: "operator",
    address: email,
    provider: providerOf(email) === "microsoft" ? "microsoft" : "microsoft",
    owner: email,
    password_enc: packed.packed,
    status: "active",
    verified_at: Date.now(),
    setup_code_hash: "",
    setup_expires_at: 0,
    attempts: 0
  });
  return saved.ok ? { ok: true, email } : saved;
}
__name(exchangeMicrosoftCode, "exchangeMicrosoftCode");
async function microsoftAccessToken(env, refreshToken, fetchImpl = fetch) {
  if (!msOauthEnabled(env)) return { ok: false, reason: "ms_not_configured" };
  const token2 = await tokenRequest(
    env,
    {
      client_id: env.MS_CLIENT_ID,
      client_secret: env.MS_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: MS_SCOPES
    },
    fetchImpl
  );
  if (!token2.ok) return token2;
  return { ok: true, accessToken: token2.json.access_token };
}
__name(microsoftAccessToken, "microsoftAccessToken");

// src/mail/auth.js
function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
__name(base64, "base64");
function plainInitial(username, password) {
  return base64(`\0${username}\0${password}`);
}
__name(plainInitial, "plainInitial");
function xoauth2Initial(username, token2) {
  return base64(`user=${username}auth=Bearer ${token2}`);
}
__name(xoauth2Initial, "xoauth2Initial");
function imapQuote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
__name(imapQuote, "imapQuote");

// src/mail/imap.js
async function command(transport, tag, line) {
  await transport.write(`${tag} ${line}`);
  return transport.readResponse(tag);
}
__name(command, "command");
async function imapLogin(transport, { username, secret }) {
  const greeting2 = await transport.readResponse("*");
  if (greeting2 && greeting2.ok === false) return { ok: false, auth: false, error: "greeting" };
  const secretText = String(secret || "");
  const response = secretText.startsWith("oauth2:") ? await command(transport, "A1", `AUTHENTICATE XOAUTH2 ${xoauth2Initial(username, secretText.slice("oauth2:".length))}`) : await command(transport, "A1", `LOGIN ${imapQuote(username)} ${imapQuote(secretText)}`);
  if (!response?.ok) return { ok: false, auth: true, error: (response?.lines || []).join(" ") || "auth" };
  return { ok: true };
}
__name(imapLogin, "imapLogin");
function sentMailbox(listResponse, fallback = "Sent") {
  const lines = listResponse?.lines || [];
  for (const line of lines) {
    if (!/\\Sent\b/i.test(line)) continue;
    const quoted = line.match(/"((?:\\.|[^"\\])*)"\s*$/);
    if (quoted) return quoted[1].replace(/\\"/g, '"');
    const bare = line.match(/\s(\S+)\s*$/);
    if (bare) return bare[1];
  }
  return fallback || "Sent";
}
__name(sentMailbox, "sentMailbox");
async function imapList(transport) {
  return command(transport, "A2", 'LIST "" "*"');
}
__name(imapList, "imapList");
async function imapSelect(transport, mailbox) {
  return command(transport, "A5", `SELECT ${imapQuote(mailbox)}`);
}
__name(imapSelect, "imapSelect");
async function imapAppend(transport, mailbox, message) {
  const bytes = new TextEncoder().encode(message).length;
  await transport.write(`A3 APPEND ${imapQuote(mailbox)} (\\Seen) {${bytes}}`);
  const continued = await transport.readResponse("A3");
  if (!continued?.continuation && !continued?.ok) return { ok: false, error: "append rejected" };
  if (continued?.continuation) {
    await transport.writeRaw(`${message}\r
`);
    const done = await transport.readResponse("A3");
    if (!done?.ok) return { ok: false, error: "append failed" };
  }
  return { ok: true };
}
__name(imapAppend, "imapAppend");
async function imapFetchHeaders(transport) {
  const response = await command(transport, "A4", "UID FETCH 1:* (BODY.PEEK[HEADER.FIELDS (MESSAGE-ID IN-REPLY-TO)])");
  return (response?.lines || []).join("\n");
}
__name(imapFetchHeaders, "imapFetchHeaders");

// src/mail/smtp.js
var TIMEOUT_MS = 15e3;
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { timeout: true })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
__name(withTimeout, "withTimeout");
function dotStuff(message) {
  const text = String(message ?? "").replace(/\r?\n/g, "\r\n");
  return text.split("\r\n").map((line) => line.startsWith(".") ? `.${line}` : line).join("\r\n");
}
__name(dotStuff, "dotStuff");
async function readReply(transport, ms) {
  return withTimeout(transport.readReply(), ms);
}
__name(readReply, "readReply");
async function command2(transport, line, ms) {
  await withTimeout(transport.write(line), ms);
  return readReply(transport, ms);
}
__name(command2, "command");
async function smtpSession(transport, options = {}) {
  const ms = options.timeoutMs || TIMEOUT_MS;
  let current = transport;
  let dataSent = false;
  const fail = /* @__PURE__ */ __name((error, extra = {}) => ({ ok: false, error: String(error || "smtp_failed"), ...extra }), "fail");
  try {
    const greeting2 = await readReply(current, ms);
    if (greeting2.code !== 220) return fail(`greeting ${greeting2.code}`);
    const ehloName = options.ehloName || "reply.kimitotalk.link";
    let ehlo = await command2(current, `EHLO ${ehloName}`, ms);
    if (ehlo.code !== 250) return fail(`ehlo ${ehlo.code}`);
    if (options.secureTransport === "starttls") {
      const start = await command2(current, "STARTTLS", ms);
      if (start.code !== 220) return fail(`starttls ${start.code}`);
      current = await current.startTls();
      ehlo = await command2(current, `EHLO ${ehloName}`, ms);
      if (ehlo.code !== 250) return fail(`ehlo ${ehlo.code}`);
    }
    const secret = String(options.secret || "");
    const username = String(options.username || "");
    const authLine = secret.startsWith("oauth2:") ? `AUTH XOAUTH2 ${xoauth2Initial(username, secret.slice("oauth2:".length))}` : `AUTH PLAIN ${plainInitial(username, secret)}`;
    const auth = await command2(current, authLine, ms);
    if (auth.code !== 235 && auth.code !== 250) return fail((auth.lines || []).join(" "), { auth: true });
    const loginOnly = options.from == null && options.rcpt == null && options.data == null;
    if (loginOnly) {
      await command2(current, "QUIT", ms).catch(() => {
      });
      return { ok: true };
    }
    const mailed = await command2(current, `MAIL FROM:<${options.from}>`, ms);
    if (mailed.code !== 250) return fail(`mail ${mailed.code}`);
    const recipients = Array.isArray(options.rcpt) ? options.rcpt : [options.rcpt];
    for (const recipient of recipients) {
      if (!recipient) continue;
      const accepted = await command2(current, `RCPT TO:<${recipient}>`, ms);
      if (accepted.code !== 250 && accepted.code !== 251) return fail(`rcpt ${accepted.code}`);
    }
    const data = await command2(current, "DATA", ms);
    if (data.code !== 354) return fail(`data ${data.code}`);
    const payload = `${dotStuff(options.data)}\r
.\r
`;
    try {
      await withTimeout(current.writeRaw(payload), ms);
      dataSent = true;
      const accepted = await readReply(current, ms);
      if (accepted.code !== 250) return fail(`data rejected ${accepted.code}`);
    } catch (error) {
      return fail(error.timeout ? "timeout" : "disconnected_after_data", { uncertain: true });
    }
    await command2(current, "QUIT", ms).catch(() => {
    });
    return { ok: true };
  } catch (error) {
    if (dataSent) return fail("disconnected_after_data", { uncertain: true });
    return fail(error.timeout ? "timeout" : error.message || "smtp_failed");
  } finally {
    try {
      await current.close?.();
    } catch {
    }
  }
}
__name(smtpSession, "smtpSession");
function wrapSocket(socket) {
  const decoder = new TextDecoder();
  let reader = socket.readable.getReader();
  let writer = socket.writable.getWriter();
  let buffer = "";
  const transport = {
    async readLine() {
      while (!buffer.includes("\n")) {
        const { value, done } = await reader.read();
        if (done) {
          if (!buffer) throw Object.assign(new Error("closed"), { closed: true });
          const rest = buffer.replace(/\r$/, "");
          buffer = "";
          return rest;
        }
        buffer += decoder.decode(value, { stream: true });
      }
      const index = buffer.indexOf("\n");
      const line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      return line;
    },
    async readReply() {
      const lines = [];
      while (true) {
        const line = await this.readLine();
        lines.push(line);
        if (line.length < 4 || line[3] === " ") break;
      }
      return { code: Number(lines[0].slice(0, 3)), lines };
    },
    async write(line) {
      await writer.write(new TextEncoder().encode(`${line}\r
`));
    },
    async writeRaw(text) {
      await writer.write(new TextEncoder().encode(text));
    },
    async startTls() {
      reader.releaseLock();
      writer.releaseLock();
      return wrapSocket(socket.startTls());
    },
    async close() {
      try {
        await writer.close();
      } catch {
      }
      try {
        await socket.close?.();
      } catch {
      }
    }
  };
  return transport;
}
__name(wrapSocket, "wrapSocket");
async function openSmtpTransport(host, port, secureTransport) {
  const { connect } = await import("cloudflare:sockets");
  const socket = connect({ hostname: host, port: Number(port) }, { secureTransport, allowHalfOpen: false });
  return wrapSocket(socket);
}
__name(openSmtpTransport, "openSmtpTransport");

// src/mail/poll.js
async function secretOf(env, link) {
  const decrypted = await decryptSecret(env.MAIL_TOKEN_ENCRYPTION_KEY, link.password_enc);
  if (!decrypted.ok) return "";
  if (decrypted.plain.startsWith("msrt:")) {
    const access = await microsoftAccessToken(env, decrypted.plain.slice("msrt:".length), env.MAIL_FETCH || fetch);
    return access.ok ? `oauth2:${access.accessToken}` : "";
  }
  return decrypted.plain;
}
__name(secretOf, "secretOf");
async function headersViaImap(env, link) {
  const servers = serversFor(link.provider, link.servers_json);
  if (!servers.ok) return "";
  const secret = await secretOf(env, link);
  if (!secret) return "";
  const username = servers.login || link.address;
  const open = env.MAIL_CONNECT || ((target) => openSmtpTransport(target.host, target.port, target.secureTransport));
  const transport = await open({ host: servers.imap.host, port: servers.imap.port, secureTransport: "on" });
  const login = await imapLogin(transport, { username, secret });
  if (!login.ok) return "";
  const list = await imapList(transport);
  const mailbox = sentMailbox(list, servers.sentMailbox || "Sent");
  await imapSelect(transport, mailbox);
  return imapFetchHeaders(transport);
}
__name(headersViaImap, "headersViaImap");
async function pollAnsweredThreads(env, deps = {}) {
  const links = (await listLinks(env)).filter((link) => link.status === "active" && sendPath(link.provider, env) === "password");
  for (const link of links) {
    try {
      const headers = deps.headersFor ? await deps.headersFor(link) : await headersViaImap(env, link);
      const marked = await markAnsweredFromHeaders(env, headers);
      await putLink(env, { ...link, last_poll_at: Date.now(), last_result: marked.marked ? "answered" : "polled" });
    } catch {
      await putLink(env, { ...link, last_poll_at: Date.now(), last_result: "poll_failed" });
    }
  }
}
__name(pollAnsweredThreads, "pollAnsweredThreads");

// src/mail/message.js
function randomHex(bytes) {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buffer].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(randomHex, "randomHex");
function angle(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.startsWith("<") && text.endsWith(">")) return text;
  return `<${text.replace(/^<|>$/g, "")}>`;
}
__name(angle, "angle");
function newMessageId(fromAddress) {
  const domain = String(fromAddress || "").split("@")[1] || "kimitotalk.link";
  return `<${randomHex(8)}@${domain}>`;
}
__name(newMessageId, "newMessageId");
function referenceHeader(referenceIds, messageId) {
  return [referenceIds, messageId].filter(Boolean).join(" ").trim();
}
__name(referenceHeader, "referenceHeader");
function buildRfc822({ from, to, cc, bcc, subject, body, messageId, inReplyTo, references }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : "",
    bcc ? `Bcc: ${bcc}` : "",
    messageId ? `Message-ID: ${angle(messageId)}` : "",
    inReplyTo ? `In-Reply-To: ${angle(inReplyTo)}` : "",
    references ? `References: ${references}` : "",
    `Subject: ${encodedHeader(subject || "")}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit"
  ].filter(Boolean);
  return `${headers.join("\r\n")}\r
\r
${body || ""}`;
}
__name(buildRfc822, "buildRfc822");

// src/mail/send.js
function senderFields(sender, origin = "") {
  if (!sender?.linked) {
    return {
      from: "",
      provider: "",
      providerLabel: "",
      linked: false,
      connectUrl: sender?.connectUrl || `${origin}/auth/mail-app/setup`,
      transport: ""
    };
  }
  return {
    from: sender.address,
    provider: sender.provider,
    providerLabel: sender.label,
    linked: true,
    connectUrl: "",
    transport: sender.transport
  };
}
__name(senderFields, "senderFields");
async function resolveReplySender(env, { thread, origin = "" } = {}) {
  const owner = thread?.owner || "";
  const links = (await listLinks(env, owner)).filter((link) => link.status === "active" && sendPath(link.provider, env) === "password");
  const header = new Set(addressList(`${thread?.to_address || ""} ${thread?.cc_address || ""}`).split(", ").filter(Boolean));
  const matched = links.find((link) => header.has(link.address));
  const chosen = matched || (links.length === 1 ? links[0] : null);
  if (chosen) {
    return {
      linked: true,
      transport: "smtp",
      address: chosen.address,
      provider: chosen.provider,
      label: providerLabel(chosen.provider),
      link: chosen
    };
  }
  let account = owner ? await readGmailAccount(env, owner) : null;
  if (!account) {
    const primary = await readPrimaryGmailAccount(env);
    if (primary && (!owner || primary.email === owner)) account = primary;
  }
  if (account?.email) {
    const provider = account.provider === "workspace" ? "workspace" : "gmail";
    return {
      linked: true,
      transport: "gmail",
      address: account.email,
      provider,
      label: providerLabel(provider),
      account
    };
  }
  return { linked: false, transport: "", address: "", provider: "", label: "", connectUrl: `${origin}/auth/mail-app/setup` };
}
__name(resolveReplySender, "resolveReplySender");
async function smtpSecret(env, link, fetchImpl) {
  const decrypted = await decryptSecret(env.MAIL_TOKEN_ENCRYPTION_KEY, link.password_enc);
  if (!decrypted.ok) return decrypted;
  if (decrypted.plain.startsWith("msrt:")) {
    const access = await microsoftAccessToken(env, decrypted.plain.slice("msrt:".length), fetchImpl);
    if (!access.ok) return { ok: false, reason: access.reason, auth: true };
    return { ok: true, secret: `oauth2:${access.accessToken}` };
  }
  return { ok: true, secret: decrypted.plain };
}
__name(smtpSecret, "smtpSecret");
function envelopeRecipients(recipients) {
  return addressList(`${recipients.to} ${recipients.cc} ${recipients.bcc}`.replace(/ /g, ", ")).split(", ").filter(Boolean);
}
__name(envelopeRecipients, "envelopeRecipients");
async function openTransport(env, host, port, secureTransport) {
  if (env.MAIL_CONNECT) return env.MAIL_CONNECT({ host, port, secureTransport });
  return openSmtpTransport(host, port, secureTransport);
}
__name(openTransport, "openTransport");
async function deliverReply(env, { sender, thread, subject, body }) {
  const recipients = threadRecipients(thread);
  if (!recipients.to) return { ok: false, sent: false, reason: "invalid_recipient" };
  const messageId = newMessageId(sender.address);
  const inReplyTo = thread.message_id || "";
  const references = referenceHeader(thread.reference_ids, thread.message_id);
  const rfc822 = buildRfc822({
    from: sender.address,
    to: recipients.to,
    cc: recipients.cc,
    subject,
    body,
    messageId,
    inReplyTo,
    references
  });
  const fetchImpl = env.GMAIL_FETCH || env.MAIL_FETCH || fetch;
  if (sender.transport === "gmail") {
    const sent = await sendViaGmail(
      env,
      sender.account,
      { from: sender.address, to: recipients.to, cc: recipients.cc, subject, body, rfc822, messageId, expectedSender: sender.address },
      fetchImpl
    );
    return { ...sent, uncertain: false, messageId: sent.ok ? messageId : "" };
  }
  const servers = serversFor(sender.provider, sender.link?.servers_json);
  if (!servers.ok) return { ok: false, sent: false, reason: servers.reason || "invalid_server" };
  const secret = await smtpSecret(env, sender.link, fetchImpl);
  if (!secret.ok) {
    if (secret.auth) await markLinkError(env, sender.address, secret.reason || "auth");
    return { ok: false, sent: false, reason: secret.auth ? "smtp_auth_failed" : secret.reason || "mail_key_missing" };
  }
  const username = servers.login || sender.address;
  const secureTransport = servers.smtp.port === 587 ? "starttls" : "on";
  let transport;
  try {
    transport = await openTransport(env, servers.smtp.host, servers.smtp.port, secureTransport);
  } catch (error) {
    return { ok: false, sent: false, reason: "smtp_failed" };
  }
  const smtp = await smtpSession(transport, {
    secureTransport,
    username,
    secret: secret.secret,
    from: sender.address,
    rcpt: envelopeRecipients(recipients),
    data: rfc822
  });
  if (!smtp.ok) {
    if (smtp.auth) await markLinkError(env, sender.address, smtp.error || "auth");
    return {
      ok: false,
      sent: false,
      uncertain: Boolean(smtp.uncertain),
      reason: smtp.uncertain ? "smtp_uncertain" : smtp.auth ? "smtp_auth_failed" : "smtp_failed"
    };
  }
  await addSentId(env, sender.address, messageId);
  let appended = false;
  try {
    const imapTransport = await openTransport(env, servers.imap.host, servers.imap.port, "on");
    const login = await imapLogin(imapTransport, { username, secret: secret.secret });
    if (login.ok) {
      const list = await imapList(imapTransport);
      const mailbox = sentMailbox(list, servers.sentMailbox || "Sent");
      const append = await imapAppend(imapTransport, mailbox, rfc822);
      appended = append.ok;
      try {
        await imapTransport.close?.();
      } catch {
      }
    }
  } catch {
    appended = false;
  }
  return { ok: true, sent: true, uncertain: false, messageId, provider: sender.provider, appended };
}
__name(deliverReply, "deliverReply");
async function verifyMailboxLogin(env, { smtp, imap, username, secret }) {
  const secureTransport = smtp.port === 587 ? "starttls" : "on";
  const smtpTransport = await openTransport(env, smtp.host, smtp.port, secureTransport);
  const smtpResult = await smtpSession(smtpTransport, { secureTransport, username, secret });
  if (!smtpResult.ok) return smtpResult;
  const imapTransport = await openTransport(env, imap.host, imap.port, "on");
  return imapLogin(imapTransport, { username, secret });
}
__name(verifyMailboxLogin, "verifyMailboxLogin");

// src/mail/setup.js
function escapeHtml2(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
__name(escapeHtml2, "escapeHtml");
function page(body) {
  return new Response(
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>\u30E1\u30FC\u30EB\u306E\u63A5\u7D9A</title></head><body style="font-family:system-ui,sans-serif;line-height:1.5;max-width:36rem;margin:24px auto;padding:0 16px">${body}</body></html>`,
    { headers: htmlHeaders() }
  );
}
__name(page, "page");
function formBody(link, code, error) {
  const custom = !serversFor(link.provider, link.servers_json).ok || link.provider === "au" || link.provider === "other";
  const loginLabel = link.provider === "docomo" ? "d\u30A2\u30AB\u30A6\u30F3\u30C8 ID" : "\u30ED\u30B0\u30A4\u30F3 ID\uFF08\u7A7A\u306A\u3089\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\uFF09";
  const notice = error ? `<p>${escapeHtml2(error)}</p>` : "";
  const servers = custom ? `<label>SMTP \u30DB\u30B9\u30C8<input name="smtpHost" required></label>
       <label>SMTP \u30DD\u30FC\u30C8\uFF08465 \u307E\u305F\u306F 587\uFF09<input name="smtpPort" inputmode="numeric" required></label>
       <label>IMAP \u30DB\u30B9\u30C8<input name="imapHost" required></label>` : "";
  return page(`${notice}
    <h1>${escapeHtml2(providerLabel(link.provider))} \u3092\u63A5\u7D9A</h1>
    <p>${escapeHtml2(link.address)}\u3002\u30A2\u30D7\u30EA\u30D1\u30B9\u30EF\u30FC\u30C9\u3067\u30ED\u30B0\u30A4\u30F3\u3067\u304D\u308B\u304B\u3060\u3051\u78BA\u8A8D\u3057\u307E\u3059\u3002\u30E1\u30FC\u30EB\u306F\u9001\u308A\u307E\u305B\u3093\u3002</p>
    <form method="post" action="/auth/mail-app/setup?c=${escapeHtml2(code)}">
      <input type="hidden" name="c" value="${escapeHtml2(code)}">
      <label>${escapeHtml2(loginLabel)}<input name="login" autocomplete="username" value="${escapeHtml2(link.servers_json?.login || "")}"></label>
      <label>\u30A2\u30D7\u30EA\u30D1\u30B9\u30EF\u30FC\u30C9<input name="password" type="password" autocomplete="current-password" required></label>
      ${servers}
      <button type="submit">\u63A5\u7D9A\u3092\u78BA\u8A8D\u3057\u3066\u4FDD\u5B58</button>
    </form>`);
}
__name(formBody, "formBody");
async function mailSetup(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("c") || "";
  if (request.method === "GET") {
    if (!code) {
      return page("<h1>\u30E1\u30FC\u30EB\u306E\u63A5\u7D9A</h1><p>\u63A5\u7D9A\u30B3\u30FC\u30C9\u4ED8\u304D\u306E URL \u3092\u958B\u3044\u3066\u304F\u3060\u3055\u3044\u3002\u30B3\u30FC\u30C9\u306F10\u5206\u3067\u5207\u308C\u307E\u3059\u3002Gmail \u306F\u5225\u306E\u63A5\u7D9A\u3067\u3059\u3002</p>");
    }
    const link2 = await findLinkByCode(env, code);
    if (!link2 || link2.status === "revoked") return page("<p>\u3053\u306E\u30B3\u30FC\u30C9\u306F\u4F7F\u3048\u307E\u305B\u3093\u3002</p>");
    if (link2.setup_expires_at && Date.now() > link2.setup_expires_at) return page("<p>\u30B3\u30FC\u30C9\u306E\u671F\u9650\u304C\u5207\u308C\u3066\u3044\u307E\u3059\u3002\u767A\u884C\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002</p>");
    if (link2.attempts >= 5) return page("<p>\u8A66\u884C\u56DE\u6570\u3092\u8D85\u3048\u307E\u3057\u305F\u3002\u767A\u884C\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002</p>");
    return formBody(link2, code, "");
  }
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!sameSitePost(request)) return page("<p>\u5225\u306E\u30B5\u30A4\u30C8\u304B\u3089\u306E\u9001\u4FE1\u306F\u53D7\u3051\u4ED8\u3051\u307E\u305B\u3093\u3002</p>");
  const form = await readForm(request);
  const submitted = form?.c || code;
  const link = await findLinkByCode(env, submitted);
  if (!link) return page("<p>\u3053\u306E\u30B3\u30FC\u30C9\u306F\u4F7F\u3048\u307E\u305B\u3093\u3002</p>");
  if (link.setup_expires_at && Date.now() > link.setup_expires_at) return page("<p>\u30B3\u30FC\u30C9\u306E\u671F\u9650\u304C\u5207\u308C\u3066\u3044\u307E\u3059\u3002\u767A\u884C\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002</p>");
  if (link.attempts >= 5) return page("<p>\u8A66\u884C\u56DE\u6570\u3092\u8D85\u3048\u307E\u3057\u305F\u3002\u767A\u884C\u3057\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002</p>");
  link.attempts += 1;
  await putLink(env, link);
  if (sendPath(link.provider, env) !== "password") return page("<p>\u3053\u306E\u30A2\u30C9\u30EC\u30B9\u306F\u30A2\u30D7\u30EA\u30D1\u30B9\u30EF\u30FC\u30C9\u3067\u306F\u63A5\u7D9A\u3057\u307E\u305B\u3093\u3002</p>");
  const password = String(form?.password || "");
  if (!password) return formBody(link, submitted, "\u30D1\u30B9\u30EF\u30FC\u30C9\u3092\u5165\u308C\u3066\u304F\u3060\u3055\u3044\u3002");
  let servers = serversFor(link.provider, link.servers_json);
  if (link.provider === "au" || link.provider === "other" || !servers.ok) {
    servers = serversFor("other", {
      smtp: { host: form?.smtpHost, port: form?.smtpPort },
      imap: { host: form?.imapHost, port: 993 },
      login: form?.login
    });
  }
  if (!servers.ok) return formBody(link, submitted, "\u30B5\u30FC\u30D0\u306F\u30DB\u30B9\u30C8\u540D\u3068\u3001465 \u304B 587 \u306E\u30DD\u30FC\u30C8\u3060\u3051\u4F7F\u3048\u307E\u3059\u3002");
  const login = String(form?.login || servers.login || "").trim();
  if (link.provider === "docomo" && !login) return formBody(link, submitted, "\u30C9\u30B3\u30E2\u306F d\u30A2\u30AB\u30A6\u30F3\u30C8 ID \u304C\u5FC5\u8981\u3067\u3059\u3002");
  const username = login || link.address;
  let verified;
  try {
    verified = await verifyMailboxLogin(env, {
      smtp: servers.smtp,
      imap: servers.imap,
      username,
      secret: password
    });
  } catch {
    return formBody(link, submitted, "\u30B5\u30FC\u30D0\u306B\u63A5\u7D9A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30E1\u30FC\u30EB\u306F\u9001\u3063\u3066\u3044\u307E\u305B\u3093\u3002");
  }
  if (!verified.ok) {
    return formBody(link, submitted, "\u30ED\u30B0\u30A4\u30F3\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30E1\u30FC\u30EB\u306F\u9001\u3063\u3066\u3044\u307E\u305B\u3093\u3002");
  }
  const packed = await encryptSecret(env.MAIL_TOKEN_ENCRYPTION_KEY, password);
  if (!packed.ok) return page("<p>\u6697\u53F7\u5316\u30AD\u30FC\u304C\u672A\u8A2D\u5B9A\u3067\u3059\u3002\u30D1\u30B9\u30EF\u30FC\u30C9\u306F\u4FDD\u5B58\u3057\u3066\u3044\u307E\u305B\u3093\u3002</p>");
  await putLink(env, {
    ...link,
    password_enc: packed.packed,
    status: "active",
    verified_at: Date.now(),
    setup_code_hash: "",
    setup_expires_at: 0,
    last_result: "verified",
    servers_json: { ...servers, login: username }
  });
  return page(`<h1>\u63A5\u7D9A\u3057\u307E\u3057\u305F</h1><p>${escapeHtml2(providerLabel(link.provider))}\uFF08${escapeHtml2(link.address)}\uFF09\u3092\u4FDD\u5B58\u3057\u307E\u3057\u305F\u3002\u30E1\u30FC\u30EB\u306F\u9001\u3063\u3066\u3044\u307E\u305B\u3093\u3002</p>`);
}
__name(mailSetup, "mailSetup");

// src/reply.js
var PATENT_APPLICATIONS = Object.freeze([
  "\u7279\u98582026-159882",
  "\u7279\u98582026-040421",
  "\u7279\u98582026-041498",
  "\u7279\u98582026-206930",
  "\u7279\u98582026-227084"
]);
var PATENT_LABEL = `\u7279\u8A31\u51FA\u9858\u4E2D\uFF08${PATENT_APPLICATIONS.join("\u30FB")}\uFF09`;
var ELLIPSIS = /さっきの人|前回の相手|この前の人|先の方|例の人/;
var TONES = /* @__PURE__ */ new Set(["polite", "firm", "calm", "casual"]);
var CHANNELS = /* @__PURE__ */ new Set(["email", "line", "chatwork", "other"]);
var HIGH_RISK = [
  ["\u8FD4\u91D1", "\u8FD4\u91D1\u306B\u89E6\u308C\u3066\u3044\u308B"],
  ["\u5951\u7D04", "\u5951\u7D04\u306B\u89E6\u308C\u3066\u3044\u308B"],
  ["\u6CD5\u52D9", "\u6CD5\u52D9\u306B\u89E6\u308C\u3066\u3044\u308B"],
  ["\u8A34\u8A1F", "\u8A34\u8A1F\u306B\u89E6\u308C\u3066\u3044\u308B"],
  ["\u533B\u7642", "\u533B\u7642\u306B\u89E6\u308C\u3066\u3044\u308B"],
  ["\u8A3A\u65AD", "\u8A3A\u65AD\u306B\u89E6\u308C\u3066\u3044\u308B"],
  ["\u91D1\u878D", "\u91D1\u878D\u306B\u89E6\u308C\u3066\u3044\u308B"],
  ["\u8ACB\u6C42", "\u8ACB\u6C42\u306B\u89E6\u308C\u3066\u3044\u308B"],
  ["\u500B\u4EBA\u60C5\u5831", "\u500B\u4EBA\u60C5\u5831\u306B\u89E6\u308C\u3066\u3044\u308B"],
  ["\u30AF\u30EC\u30FC\u30E0", "\u30AF\u30EC\u30FC\u30E0\u306B\u89E6\u308C\u3066\u3044\u308B"],
  ["\u640D\u5BB3\u8CE0\u511F", "\u640D\u5BB3\u8CE0\u511F\u306B\u89E6\u308C\u3066\u3044\u308B"],
  ["\u5408\u610F", "\u5408\u610F\u306B\u89E6\u308C\u3066\u3044\u308B"],
  ["\u7D04\u675F", "\u7D04\u675F\u306B\u89E6\u308C\u3066\u3044\u308B"]
];
var MEDIUM_RISK = [
  ["\u898B\u7A4D", "\u898B\u7A4D\u308A\u306B\u89E6\u308C\u3066\u3044\u308B"],
  ["\u7D0D\u671F", "\u7D0D\u671F\u306B\u89E6\u308C\u3066\u3044\u308B"],
  ["\u5024\u5F15", "\u5024\u5F15\u304D\u306B\u89E6\u308C\u3066\u3044\u308B"],
  ["\u5272\u5F15", "\u5272\u5F15\u306B\u89E6\u308C\u3066\u3044\u308B"],
  ["\u30AD\u30E3\u30F3\u30BB\u30EB", "\u30AD\u30E3\u30F3\u30BB\u30EB\u306B\u89E6\u308C\u3066\u3044\u308B"],
  ["\u81F3\u6025", "\u6025\u304E\u306E\u4F9D\u983C\u306B\u89E6\u308C\u3066\u3044\u308B"]
];
var TONE_LABEL = {
  polite: "\u4E01\u5BE7",
  firm: "\u306F\u3063\u304D\u308A",
  calm: "\u51B7\u9759",
  casual: "\u7815\u3051\u305F\u8ABF\u5B50"
};
function optionalInt(value, min, max) {
  if (value === void 0 || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return null;
  return number;
}
__name(optionalInt, "optionalInt");
function normalizeMessage(input = {}) {
  const tone = TONES.has(input.tone) ? input.tone : "polite";
  const channel = CHANNELS.has(input.channel) ? input.channel : "email";
  return {
    sender: clip(input.sender, 120),
    subject: clip(input.subject, 200),
    body: clip(input.body, 4e3),
    intent: clip(input.intent, 500),
    tone,
    channel,
    discountCeilingPercent: optionalInt(input.discountCeilingPercent, 0, 100),
    minOrderValueYen: optionalInt(input.minOrderValueYen, 0, 1e8),
    forceHolding: input.forceHolding === true
  };
}
__name(normalizeMessage, "normalizeMessage");
function parseInstruction(text) {
  const raw = clip(text, 500);
  let tone = "";
  if (/丁寧/.test(raw)) tone = "polite";
  else if (/はっきり|強め/.test(raw)) tone = "firm";
  else if (/冷静/.test(raw)) tone = "calm";
  else if (/砕け|カジュアル/.test(raw)) tone = "casual";
  const action = /保留|約束しない|まだ決めない/.test(raw) ? "hold" : "reply";
  const focus = raw.replace(ELLIPSIS, "").replace(/丁寧に|はっきり|冷静に|砕けた調子で|カジュアルに|強めに/g, "").replace(/返して|返信して|伝えて|送って/g, "").replace(/[にへ]、?|[、。]/g, "").trim().slice(0, 500);
  return { raw, refersToPrevious: ELLIPSIS.test(raw), tone, action, focus };
}
__name(parseInstruction, "parseInstruction");
function applyInstruction(input = {}, history = []) {
  const parsed = parseInstruction(input.instruction || input.intent || "");
  const next = { ...input };
  if (parsed.tone) next.tone = parsed.tone;
  if (parsed.focus) next.intent = parsed.focus;
  if (parsed.action === "hold") next.forceHolding = true;
  if (!parsed.refersToPrevious) {
    return { input: next, instruction: parsed, reference: { resolved: false, refersToPrevious: false } };
  }
  const previous = (Array.isArray(history) ? history : []).find((item) => item && (item.sender || item.subject || item.excerpt));
  if (!previous) {
    return {
      input: next,
      instruction: parsed,
      reference: { resolved: false, refersToPrevious: true, reason: "no_previous_person" }
    };
  }
  if (!clip(next.sender, 120)) next.sender = previous.sender || "";
  if (!clip(next.subject, 200) && previous.subject) next.subject = previous.subject;
  if (!clip(next.body, 4e3) && previous.excerpt) next.body = previous.excerpt;
  return {
    input: next,
    instruction: parsed,
    reference: {
      resolved: true,
      refersToPrevious: true,
      shioriId: previous.id || "",
      sender: next.sender || "",
      subject: next.subject || ""
    }
  };
}
__name(applyInstruction, "applyInstruction");
function looksLikeNotice(message) {
  const sender = message.sender.toLowerCase();
  if (/(no-?reply|noreply|mailer-daemon|notification@|notifications@)/.test(sender)) return true;
  const text = `${message.subject}
${message.body}`;
  return /(配信専用|自動配信|ニュースレター|配信停止|メールマガジン)/.test(text);
}
__name(looksLikeNotice, "looksLikeNotice");
function assessMessage(input = {}) {
  const message = normalizeMessage(input);
  const text = `${message.subject}
${message.body}
${message.sender}`;
  const reasons = [];
  let highHits = 0;
  for (const [word, reason] of HIGH_RISK) {
    if (text.includes(word)) {
      highHits += 1;
      reasons.push(reason);
    }
  }
  let mediumHits = 0;
  if (highHits === 0) {
    for (const [word, reason] of MEDIUM_RISK) {
      if (text.includes(word)) {
        mediumHits += 1;
        reasons.push(reason);
      }
    }
  }
  const notice = looksLikeNotice(message);
  let level = "low";
  let score = 18;
  if (highHits > 0) {
    level = "high";
    score = Math.min(100, 64 + highHits * 12);
  } else if (mediumHits > 0) {
    level = "medium";
    score = Math.min(69, 18 + mediumHits * 14);
  }
  if (reasons.length === 0) reasons.push("\u5371\u967A\u306A\u7D04\u675F\u3084\u5951\u7D04\u306E\u8A9E\u53E5\u306F\u898B\u5F53\u305F\u3089\u306A\u3044");
  if (notice && level !== "high") reasons.push("\u901A\u77E5\u30FB\u81EA\u52D5\u914D\u4FE1\u3068\u3057\u3066\u632F\u308A\u5206\u3051\u305F");
  const classification = notice && level !== "high" ? "notice" : "needs_reply";
  return {
    message,
    classification,
    handoff: handoffFor(message.channel),
    risk: {
      score,
      level,
      reasons,
      requiresHumanApproval: level === "high"
    }
  };
}
__name(assessMessage, "assessMessage");
function handoffFor(channel) {
  if (channel === "line") {
    return "\u3053\u306E\u6587\u9762\u306F\u4E0B\u66F8\u304D\u3067\u3059\u3002LINE\u3078\u306E\u9001\u4FE1\u306F\u884C\u3044\u307E\u305B\u3093\u3002\u78BA\u8A8D\u306E\u3042\u3068\u3001\u3054\u81EA\u8EAB\u306ELINE\u304B\u3089\u9001\u3063\u3066\u304F\u3060\u3055\u3044\u3002";
  }
  if (channel === "chatwork") {
    return "\u3053\u306E\u6587\u9762\u306F\u4E0B\u66F8\u304D\u3067\u3059\u3002Chatwork\u3078\u306E\u9001\u4FE1\u306F\u884C\u3044\u307E\u305B\u3093\u3002\u78BA\u8A8D\u306E\u3042\u3068\u3001\u3054\u81EA\u8EAB\u3067\u9001\u3063\u3066\u304F\u3060\u3055\u3044\u3002";
  }
  return "\u3053\u306E\u30E1\u30FC\u30EB\u306F\u672A\u9001\u4FE1\u3067\u3059\u3002\u9001\u308B\u3068\u304D\u306F\u3001\u30AB\u30FC\u30C9\u306E\u300C\u9001\u4FE1\u300D\u3092\u62BC\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
}
__name(handoffFor, "handoffFor");
function greeting(sender) {
  const name = sender.replace(/様$/, "").trim();
  return name ? `${name} \u69D8` : "\u3054\u62C5\u5F53\u8005\u69D8";
}
__name(greeting, "greeting");
function topicLine(message) {
  if (message.subject) return `\u300C${message.subject}\u300D\u306E\u4EF6\u3067\u3059\u3002`;
  if (message.intent) return `${message.intent}\u306B\u3064\u3044\u3066\u3067\u3059\u3002`;
  return "\u3044\u305F\u3060\u3044\u305F\u3054\u9023\u7D61\u306B\u3064\u3044\u3066\u3067\u3059\u3002";
}
__name(topicLine, "topicLine");
function policySuffix(message) {
  const asked = `${message.subject}
${message.body}
${message.intent}`;
  if (!/(値引|割引|見積|金額|料金|価格|円)/.test(asked)) return "";
  const lines = [];
  if (message.discountCeilingPercent != null) lines.push(`\u5024\u5F15\u304D\u306F\u6700\u5927${message.discountCeilingPercent}%\u307E\u3067\u3067\u3059\u3002`);
  if (message.minOrderValueYen != null) lines.push(`\u6700\u4F4E\u53D7\u6CE8\u984D\u306F${message.minOrderValueYen}\u5186\u3067\u3059\u3002`);
  return lines.length ? `
${lines.join("")}` : "";
}
__name(policySuffix, "policySuffix");
function holdingText(message, variant) {
  const head = `${greeting(message.sender)}

${topicLine(message)}\u3054\u9023\u7D61\u3042\u308A\u304C\u3068\u3046\u3054\u3056\u3044\u307E\u3059\u3002`;
  if (variant === "facts") {
    return `${head}
\u53D7\u3051\u53D6\u3063\u305F\u5185\u5BB9\u3092\u6574\u7406\u3057\u3001\u78BA\u8A8D\u304C\u7D42\u308F\u3063\u3066\u304B\u3089\u6539\u3081\u3066\u3054\u9023\u7D61\u3044\u305F\u3057\u307E\u3059\u3002\u73FE\u6642\u70B9\u3067\u306F\u304A\u7D04\u675F\u3067\u304D\u307E\u305B\u3093\u3002

\u3088\u308D\u3057\u304F\u304A\u9858\u3044\u3044\u305F\u3057\u307E\u3059\u3002`;
  }
  if (variant === "boundary") {
    return `${head}
\u73FE\u6642\u70B9\u3067\u6761\u4EF6\u3092\u78BA\u5B9A\u3059\u308B\u3053\u3068\u306F\u3067\u304D\u307E\u305B\u3093\u3002\u78BA\u8A8D\u306E\u3046\u3048\u3001\u6539\u3081\u3066\u3054\u9023\u7D61\u3044\u305F\u3057\u307E\u3059\u3002

\u3088\u308D\u3057\u304F\u304A\u9858\u3044\u3044\u305F\u3057\u307E\u3059\u3002`;
  }
  return `${head}
\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u3001\u6539\u3081\u3066\u3054\u9023\u7D61\u3044\u305F\u3057\u307E\u3059\u3002\u65AD\u5B9A\u3084\u304A\u7D04\u675F\u306F\u63A7\u3048\u3055\u305B\u3066\u304F\u3060\u3055\u3044\u3002

\u3088\u308D\u3057\u304F\u304A\u9858\u3044\u3044\u305F\u3057\u307E\u3059\u3002`;
}
__name(holdingText, "holdingText");
function draftText(message, tone) {
  const head = `${greeting(message.sender)}

${topicLine(message)}`;
  const intent = message.intent ? `${message.intent}\u3068\u3044\u3046\u8DA3\u65E8\u3067\u304A\u8FD4\u4E8B\u3057\u307E\u3059\u3002` : "\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u3066\u304A\u8FD4\u4E8B\u3057\u307E\u3059\u3002";
  const suffix = policySuffix(message);
  if (tone === "firm") {
    return `${head}${intent}
\u9032\u3081\u65B9\u306F\u3001\u78BA\u5B9A\u3057\u3066\u3044\u308B\u4E8B\u5B9F\u3060\u3051\u3092\u5148\u306B\u304A\u4F1D\u3048\u3057\u307E\u3059\u3002${suffix}

\u3088\u308D\u3057\u304F\u304A\u9858\u3044\u3044\u305F\u3057\u307E\u3059\u3002`;
  }
  if (tone === "calm") {
    return `${head}${intent}
\u72B6\u6CC1\u3092\u6574\u7406\u3057\u3001\u4E0D\u660E\u70B9\u304C\u3042\u308C\u3070\u78BA\u8A8D\u3057\u3066\u304B\u3089\u8FFD\u3063\u3066\u3054\u9023\u7D61\u3057\u307E\u3059\u3002${suffix}

\u3088\u308D\u3057\u304F\u304A\u9858\u3044\u3044\u305F\u3057\u307E\u3059\u3002`;
  }
  if (tone === "casual") {
    return `${head}\u3042\u308A\u304C\u3068\u3046\u3054\u3056\u3044\u307E\u3059\u3002${intent}
\u5206\u304B\u308B\u7BC4\u56F2\u3067\u304A\u8FD4\u4E8B\u3057\u307E\u3059\u3002${suffix}

\u3088\u308D\u3057\u304F\u304A\u9858\u3044\u3044\u305F\u3057\u307E\u3059\u3002`;
  }
  return `${head}\u3054\u9023\u7D61\u3042\u308A\u304C\u3068\u3046\u3054\u3056\u3044\u307E\u3059\u3002${intent}
\u5206\u304B\u308A\u3084\u3059\u304F\u304A\u8FD4\u4E8B\u3044\u305F\u3057\u307E\u3059\u3002${suffix}

\u3088\u308D\u3057\u304F\u304A\u9858\u3044\u3044\u305F\u3057\u307E\u3059\u3002`;
}
__name(draftText, "draftText");
function toneOrder(tone) {
  const rest = ["polite", "calm", "firm", "casual"].filter((item) => item !== tone);
  return [tone, rest[0], rest[1]];
}
__name(toneOrder, "toneOrder");
function predictRecipientEmotion(candidate, risk = {}) {
  if (candidate.holding && candidate.id === "hold-facts") {
    return { category: "\u7D0D\u5F97", score: 70, reason: "\u4E8B\u5B9F\u306E\u6574\u7406\u3060\u3051\u306A\u306E\u3067\u3001\u76F8\u624B\u304C\u8A71\u306E\u4F4D\u7F6E\u3092\u8FFD\u3044\u3084\u3059\u3044" };
  }
  if (candidate.holding && candidate.id === "hold-boundary") {
    return { category: "\u8CA0\u62C5", score: 46, reason: "\u6761\u4EF6\u3092\u78BA\u5B9A\u3057\u306A\u3044\u3068\u5148\u306B\u4F1D\u308F\u308B\u306E\u3067\u3001\u76F8\u624B\u306F\u5F85\u3061\u6642\u9593\u3092\u8CA0\u62C5\u306B\u611F\u3058\u3084\u3059\u3044" };
  }
  if (candidate.holding) {
    return { category: "\u5B89\u5FC3", score: 74, reason: "\u65AD\u5B9A\u3084\u7D04\u675F\u3092\u907F\u3051\u3066\u3044\u308B\u306E\u3067\u3001\u76F8\u624B\u304C\u671F\u5F85\u3057\u3059\u304E\u306B\u304F\u3044" };
  }
  if (candidate.tone === "firm") {
    return risk.level === "medium" ? { category: "\u8CA0\u62C5", score: 48, reason: "\u6761\u4EF6\u3092\u5148\u306B\u793A\u3059\u306E\u3067\u3001\u76F8\u624B\u306F\u5224\u65AD\u3057\u3084\u3059\u3044\u4E00\u65B9\u3067\u5727\u3092\u611F\u3058\u308B\u3053\u3068\u304C\u3042\u308B" } : { category: "\u7D0D\u5F97", score: 62, reason: "\u78BA\u5B9A\u3057\u3066\u3044\u308B\u4E8B\u5B9F\u304B\u3089\u5148\u306B\u4F1D\u3048\u308B\u306E\u3067\u3001\u76F8\u624B\u304C\u5224\u65AD\u3057\u3084\u3059\u3044" };
  }
  if (candidate.tone === "calm") {
    return { category: "\u7D0D\u5F97", score: 71, reason: "\u72B6\u6CC1\u3092\u6574\u7406\u3057\u3066\u8FD4\u3059\u306E\u3067\u3001\u76F8\u624B\u304C\u5185\u5BB9\u3092\u7406\u89E3\u3057\u3084\u3059\u3044" };
  }
  if (candidate.tone === "casual") {
    return risk.level === "low" ? { category: "\u5B89\u5FC3", score: 66, reason: "\u8FD1\u3044\u8DDD\u96E2\u306E\u8A00\u3044\u65B9\u3067\u3001\u76F8\u624B\u304C\u69CB\u3048\u306B\u304F\u3044" } : { category: "\u56F0\u60D1", score: 44, reason: "\u304F\u3060\u3051\u305F\u8ABF\u5B50\u304C\u3001\u76F8\u624B\u306B\u306F\u8EFD\u304F\u898B\u3048\u308B\u3053\u3068\u304C\u3042\u308B" };
  }
  return { category: "\u5B89\u5FC3", score: 76, reason: "\u4E01\u5BE7\u306A\u53D7\u3051\u7B54\u3048\u3067\u3001\u76F8\u624B\u304C\u69CB\u3048\u306B\u304F\u3044" };
}
__name(predictRecipientEmotion, "predictRecipientEmotion");
function withEmotion(candidate, risk) {
  return { ...candidate, emotion: predictRecipientEmotion(candidate, risk) };
}
__name(withEmotion, "withEmotion");
function buildCandidates(assessment) {
  const { message, risk, classification } = assessment;
  if (classification === "notice" || !message.body) return [];
  if (risk.level === "high" || message.forceHolding) {
    return [
      { id: "hold-polite", tone: "polite", label: "\u4E01\u5BE7\u306A\u4FDD\u7559", holding: true, text: holdingText(message, "polite") },
      { id: "hold-facts", tone: "calm", label: "\u4E8B\u5B9F\u306E\u6574\u7406", holding: true, text: holdingText(message, "facts") },
      { id: "hold-boundary", tone: "firm", label: "\u6761\u4EF6\u306F\u672A\u78BA\u5B9A", holding: true, text: holdingText(message, "boundary") }
    ].map((candidate) => withEmotion(candidate, risk));
  }
  return toneOrder(message.tone).map((tone) => ({
    id: `tone-${tone}`,
    tone,
    label: TONE_LABEL[tone],
    holding: false,
    text: draftText(message, tone)
  })).map((candidate) => withEmotion(candidate, risk));
}
__name(buildCandidates, "buildCandidates");
function compareSnapshot(snapshot, review) {
  if (!snapshot || !Array.isArray(snapshot.texts)) return { ok: false, reason: "state_mismatch" };
  if (snapshot.riskLevel !== review.riskLevel) return { ok: false, reason: "state_mismatch" };
  if (!snapshot.texts.includes(review.copyText)) return { ok: false, reason: "state_mismatch" };
  return { ok: true };
}
__name(compareSnapshot, "compareSnapshot");
function reviewConfirmation(input = {}) {
  if (input.humanConfirmed !== true) return { ok: false, reason: "human_confirmation_required", sent: false };
  const riskLevel = clip(input.riskLevel || input.risk?.level || "unknown", 20);
  if (riskLevel === "high" && input.riskAcknowledged !== true) {
    return { ok: false, reason: "risk_acknowledgement_required", sent: false };
  }
  const copyText = clip(input.text, 4e3);
  if (!copyText) return { ok: false, reason: "empty_candidate", sent: false };
  return { ok: true, copyText, riskLevel, sent: false };
}
__name(reviewConfirmation, "reviewConfirmation");

// src/drafts.js
function withSource2(candidates, source) {
  return candidates.map((candidate) => ({ ...candidate, source }));
}
__name(withSource2, "withSource");
async function generateCandidates(env, assessment, fetchImpl = fetch) {
  const templates = withSource2(buildCandidates(assessment), "template");
  if (!env.BACKEND_URL || !env.INTERNAL_DRAFT_TOKEN || !env.DRAFT_SERVICE_USER_ID) {
    return { candidates: templates, draftSource: "template", draftReason: "llm_not_configured" };
  }
  const message = assessment.message;
  try {
    const response = await fetchImpl(`${String(env.BACKEND_URL).replace(/\/$/, "")}/internal/reply-drafts`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.INTERNAL_DRAFT_TOKEN}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        userId: env.DRAFT_SERVICE_USER_ID,
        sender: message.sender,
        subject: message.subject,
        body: message.body,
        intent: message.intent,
        riskLevel: assessment.risk.level,
        tones: templates.map((candidate) => candidate.tone)
      })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok || !Array.isArray(payload.candidates) || payload.candidates.length === 0) {
      return {
        candidates: templates,
        draftSource: "template",
        draftReason: payload?.reason || "llm_unavailable"
      };
    }
    const merged = templates.map((template, index) => {
      const text = String(payload.candidates[index]?.text || "").trim();
      if (!text) return template;
      const next = {
        ...template,
        text: text.slice(0, 4e3),
        source: "llm",
        holding: assessment.risk.level === "high" || message.forceHolding === true
      };
      return { ...next, emotion: predictRecipientEmotion(next, assessment.risk) };
    });
    const usedLlm = merged.some((candidate) => candidate.source === "llm");
    return {
      candidates: merged,
      draftSource: usedLlm ? "llm" : "template",
      draftReason: usedLlm ? "" : "llm_unavailable"
    };
  } catch {
    return { candidates: templates, draftSource: "template", draftReason: "llm_failed" };
  }
}
__name(generateCandidates, "generateCandidates");

// src/mcp-oauth.js
var SCOPE2 = "replies";
var CODE_TTL = 300;
var ACCESS_TTL = 3600;
function json3(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra }
  });
}
__name(json3, "json");
function base64Url2(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(base64Url2, "base64Url");
async function sha256(value) {
  const digest2 = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url2(new Uint8Array(digest2));
}
__name(sha256, "sha256");
function protectedResourceMetadata(origin) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [SCOPE2],
    bearer_methods_supported: ["header"]
  };
}
__name(protectedResourceMetadata, "protectedResourceMetadata");
function authorizationServerMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: [SCOPE2]
  };
}
__name(authorizationServerMetadata, "authorizationServerMetadata");
function wwwAuthenticate(origin) {
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="${SCOPE2}"`;
}
__name(wwwAuthenticate, "wwwAuthenticate");
async function readJson2(env, key) {
  if (!env.CHATGPT_KV) return null;
  const raw = await env.CHATGPT_KV.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
__name(readJson2, "readJson");
async function accessTokenRecord(env, token2) {
  if (!token2) return null;
  return readJson2(env, `oauth-access:${token2}`);
}
__name(accessTokenRecord, "accessTokenRecord");
function escapeHtml3(value) {
  return String(value || "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}
__name(escapeHtml3, "escapeHtml");
function formPage(params, error = "") {
  const hidden = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method"].map((name) => `<input type="hidden" name="${name}" value="${escapeHtml3(params.get(name) || "")}">`).join("");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>\u63A5\u7D9A\u306E\u8A31\u53EF</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,sans-serif;margin:24px;line-height:1.5}button{font-size:16px;padding:10px 14px}</style>
</head><body><h1>\u8FD4\u4FE1\u79D8\u66F8\u3078\u306E\u63A5\u7D9A</h1><p>\u3053\u306E\u753B\u9762\u3092\u8A31\u53EF\u3059\u308B\u3068\u3001\u30AF\u30E9\u30A4\u30A2\u30F3\u30C8\u306F\u4F5C\u6210\u30AB\u30FC\u30C9\u3092\u547C\u3079\u307E\u3059\u3002\u30E1\u30FC\u30EB\u306E\u9001\u4FE1\u306F\u3001\u30AB\u30FC\u30C9\u306E\u300C\u9001\u4FE1\u300D\u3092\u62BC\u3057\u305F\u3068\u304D\u3060\u3051\u3067\u3059\u3002</p>
${error ? `<p>${escapeHtml3(error)}</p>` : ""}
<form method="post">${hidden}<label>\u30A2\u30AB\u30A6\u30F3\u30C8\u306E\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9<input name="email" type="email" autocomplete="email"></label><label>\u63A5\u7D9A\u30AD\u30FC<input name="key" type="password" required></label><button type="submit">\u8A31\u53EF\u3059\u308B</button></form></body></html>`;
}
__name(formPage, "formPage");
function redirectAllowed(uri) {
  try {
    const url = new URL(uri);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}
__name(redirectAllowed, "redirectAllowed");
async function register(request, env) {
  if (!env.CHATGPT_KV) return json3({ error: "storage_not_configured" }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json3({ error: "invalid_json" }, 400);
  }
  const redirects = Array.isArray(body?.redirect_uris) ? body.redirect_uris.filter(redirectAllowed) : [];
  if (redirects.length === 0) return json3({ error: "invalid_redirect_uri" }, 400);
  const clientId = crypto.randomUUID();
  await env.CHATGPT_KV.put(
    `oauth-client:${clientId}`,
    JSON.stringify({ clientId, redirectUris: redirects, name: String(body.client_name || "").slice(0, 80) })
  );
  return json3({ client_id: clientId, redirect_uris: redirects, token_endpoint_auth_method: "none" }, 201);
}
__name(register, "register");
async function authorize(request, env) {
  const url = new URL(request.url);
  if (!env.CHATGPT_KV || !env.MCP_OAUTH_CONSENT_KEY) {
    return new Response("OAuth\u306E\u540C\u610F\u30AD\u30FC\u304C\u672A\u8A2D\u5B9A\u3067\u3059\u3002", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const params = request.method === "POST" ? new URLSearchParams(await request.text()) : url.searchParams;
  const clientId = params.get("client_id") || url.searchParams.get("client_id") || "";
  const redirectUri = params.get("redirect_uri") || url.searchParams.get("redirect_uri") || "";
  const state = params.get("state") || url.searchParams.get("state") || "";
  const challenge = params.get("code_challenge") || url.searchParams.get("code_challenge") || "";
  const method = params.get("code_challenge_method") || url.searchParams.get("code_challenge_method") || "";
  const client = await readJson2(env, `oauth-client:${clientId}`);
  if (!client || !client.redirectUris?.includes(redirectUri) || method !== "S256" || !challenge) {
    return json3({ error: "invalid_client" }, 400);
  }
  if (request.method === "GET") {
    return new Response(formPage(url.searchParams), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
  if (!timingSafeEqual(params.get("key") || "", env.MCP_OAUTH_CONSENT_KEY)) {
    return new Response(formPage(params, "\u63A5\u7D9A\u30AD\u30FC\u304C\u9055\u3044\u307E\u3059\u3002"), {
      status: 401,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
    });
  }
  const accountEmail = normalizeEmail(params.get("email") || "");
  if (params.get("email") && !accountEmail) {
    return new Response(formPage(params, "\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u306E\u5F62\u5F0F\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002"), {
      status: 400,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
    });
  }
  const code = crypto.randomUUID();
  await env.CHATGPT_KV.put(
    `oauth-code:${code}`,
    JSON.stringify({ clientId, redirectUri, challenge, state, accountEmail }),
    { expirationTtl: CODE_TTL }
  );
  const back = new URL(redirectUri);
  back.searchParams.set("code", code);
  if (state) back.searchParams.set("state", state);
  return Response.redirect(back.toString(), 302);
}
__name(authorize, "authorize");
async function token(request, env) {
  if (!env.CHATGPT_KV) return json3({ error: "storage_not_configured" }, 503);
  const body = new URLSearchParams(await request.text());
  const grant = body.get("grant_type");
  if (grant === "refresh_token") {
    const record2 = await readJson2(env, `oauth-refresh:${body.get("refresh_token") || ""}`);
    if (!record2) return json3({ error: "invalid_grant" }, 400);
    return issue(env, record2.clientId, record2.accountEmail || "");
  }
  if (grant !== "authorization_code") return json3({ error: "unsupported_grant_type" }, 400);
  const code = body.get("code") || "";
  const record = await readJson2(env, `oauth-code:${code}`);
  await env.CHATGPT_KV.delete(`oauth-code:${code}`);
  if (!record || record.clientId !== body.get("client_id") || record.redirectUri !== body.get("redirect_uri")) {
    return json3({ error: "invalid_grant" }, 400);
  }
  const hashed = await sha256(body.get("code_verifier") || "");
  if (!timingSafeEqual(hashed, record.challenge)) return json3({ error: "invalid_grant" }, 400);
  return issue(env, record.clientId, record.accountEmail || "");
}
__name(token, "token");
async function issue(env, clientId, accountEmail = "") {
  const access = crypto.randomUUID();
  const refresh = crypto.randomUUID();
  const identity = accountEmail ? { accountEmail } : {};
  await env.CHATGPT_KV.put(
    `oauth-access:${access}`,
    JSON.stringify({ clientId, scope: SCOPE2, ...identity }),
    { expirationTtl: ACCESS_TTL }
  );
  await env.CHATGPT_KV.put(`oauth-refresh:${refresh}`, JSON.stringify({ clientId, ...identity }));
  return json3({ access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh, scope: SCOPE2 });
}
__name(issue, "issue");
async function handleOAuthRoute(request, env, origin) {
  const url = new URL(request.url);
  if (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/mcp") {
    return json3(protectedResourceMetadata(origin));
  }
  if (url.pathname === "/.well-known/oauth-authorization-server") return json3(authorizationServerMetadata(origin));
  if (url.pathname === "/oauth/register" && request.method === "POST") return register(request, env);
  if (url.pathname === "/oauth/authorize" && (request.method === "GET" || request.method === "POST")) return authorize(request, env);
  if (url.pathname === "/oauth/token" && request.method === "POST") return token(request, env);
  return null;
}
__name(handleOAuthRoute, "handleOAuthRoute");

// src/shiori.js
function ownerKey(input = {}) {
  const email = normalizeEmail(input.email);
  if (email) return `email:${email}`;
  const deskId = validDeskId(input.deskId);
  if (deskId) return `desk:${deskId}`;
  return "";
}
__name(ownerKey, "ownerKey");
async function readJson3(env, key) {
  const raw = await env.CHATGPT_KV.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
__name(readJson3, "readJson");
async function listShiori(env, input = {}) {
  if (!env.CHATGPT_KV) return { ok: false, reason: "storage_not_configured", items: [] };
  const owner = ownerKey(input);
  if (!owner) return { ok: false, reason: "owner_required", items: [] };
  const ids = await readJson3(env, `shiori-index:${owner}`) || [];
  const items = [];
  for (const id of ids) {
    const record = await readJson3(env, `shiori:${owner}:${id}`);
    if (record) items.push(record);
  }
  return { ok: true, items };
}
__name(listShiori, "listShiori");
async function saveShiori(env, input = {}, nowMs = Date.now()) {
  if (!env.CHATGPT_KV) return { ok: false, reason: "storage_not_configured", items: [] };
  const owner = ownerKey(input);
  if (!owner) return { ok: false, reason: "owner_required", items: [] };
  const excerpt = clip(input.body || input.excerpt || "", 280);
  const candidateText = clip(input.candidateText || input.text || "", 4e3);
  if (!excerpt && !candidateText) return { ok: false, reason: "empty_shiori", items: [] };
  const id = crypto.randomUUID();
  const record = {
    id,
    subject: clip(input.subject, 200),
    sender: clip(input.sender, 120),
    excerpt,
    candidateText,
    riskLevel: clip(input.riskLevel || "unknown", 20),
    savedAt: nowMs
  };
  await env.CHATGPT_KV.put(`shiori:${owner}:${id}`, JSON.stringify(record));
  const indexKey = `shiori-index:${owner}`;
  const previous = await readJson3(env, indexKey) || [];
  const next = [id, ...previous.filter((item) => item !== id)].slice(0, 20);
  const dropped = previous.filter((item) => !next.includes(item));
  await env.CHATGPT_KV.put(indexKey, JSON.stringify(next));
  await Promise.all(dropped.map((item) => env.CHATGPT_KV.delete(`shiori:${owner}:${item}`)));
  const listed = await listShiori(env, input);
  return { ok: true, shiori: record, items: listed.items };
}
__name(saveShiori, "saveShiori");

// src/widget.js
var REASONS = {
  empty_message: "\u672C\u6587\u3092\u5165\u308C\u3066\u304F\u3060\u3055\u3044\u3002",
  trial_required: "\u3053\u306E\u30E1\u30FC\u30EB\u3067\u306F\u3001\u5148\u306B\u304A\u8A66\u3057\u3092\u958B\u59CB\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  plan_expired: "\u304A\u8A66\u3057\u304C\u7D42\u308F\u3063\u3066\u3044\u307E\u3059\u3002\u7D9A\u3051\u308B\u306B\u306F\u6708\u984D\u30D7\u30E9\u30F3\u304C\u5FC5\u8981\u3067\u3059\u3002",
  quota_exceeded: "\u4ECA\u306E\u671F\u9593\u306E\u4F5C\u6210\u56DE\u6570\u3092\u4F7F\u3044\u5207\u308A\u307E\u3057\u305F\u3002\u5B9A\u578B\u6587\u3067\u30AB\u30FC\u30C9\u3092\u51FA\u3057\u3066\u3044\u307E\u3059\u3002",
  preview_exhausted: "\u30E1\u30FC\u30EB\u306A\u3057\u306E\u30D7\u30EC\u30D3\u30E5\u30FC\u306F\u3001\u3053\u306E\u7AEF\u672B\u3067\u672C\u65E53\u4EF6\u307E\u3067\u3067\u3059\u3002\u5B9A\u578B\u6587\u3067\u30AB\u30FC\u30C9\u3092\u51FA\u3057\u3066\u3044\u307E\u3059\u3002",
  preview_busy: "\u30D7\u30EC\u30D3\u30E5\u30FC\u304C\u6DF7\u307F\u5408\u3063\u3066\u3044\u307E\u3059\u3002\u5B9A\u578B\u6587\u3067\u30AB\u30FC\u30C9\u3092\u51FA\u3057\u3066\u3044\u307E\u3059\u3002",
  human_confirmation_required: "\u78BA\u8A8D\u30C1\u30A7\u30C3\u30AF\u3092\u5165\u308C\u3066\u304F\u3060\u3055\u3044\u3002",
  risk_acknowledgement_required: "\u9AD8\u30EA\u30B9\u30AF\u306E\u78BA\u8A8D\u30C1\u30A7\u30C3\u30AF\u3092\u5165\u308C\u3066\u304F\u3060\u3055\u3044\u3002",
  empty_candidate: "\u30B3\u30D4\u30FC\u3059\u308B\u5019\u88DC\u3092\u9078\u3093\u3067\u304F\u3060\u3055\u3044\u3002",
  empty_shiori: "\u6B8B\u3059\u672C\u6587\u304C\u3042\u308A\u307E\u305B\u3093\u3002",
  storage_not_configured: "\u4FDD\u5B58\u5148\u304C\u672A\u63A5\u7D9A\u306E\u305F\u3081\u3001\u3057\u304A\u308A\u3068\u304A\u8A66\u3057\u3092\u8A18\u9332\u3067\u304D\u307E\u305B\u3093\u3002",
  trial_used: "\u3053\u306E\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u306E\u304A\u8A66\u3057\u306F\u7D42\u4E86\u3057\u3066\u3044\u307E\u3059\u3002",
  invalid_email: "\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u306E\u5F62\u5F0F\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  trial_busy: "\u304A\u8A66\u3057\u306E\u958B\u59CB\u304C\u96C6\u4E2D\u3057\u3066\u3044\u307E\u3059\u3002",
  owner_required: "\u3057\u304A\u308A\u306E\u6301\u3061\u4E3B\u3092\u6C7A\u3081\u3089\u308C\u307E\u305B\u3093\u3002",
  no_previous_person: "\u300C\u3055\u3063\u304D\u306E\u4EBA\u300D\u306B\u5F53\u305F\u308B\u3057\u304A\u308A\u304C\u3042\u308A\u307E\u305B\u3093\u3002",
  state_mismatch: "\u5B9B\u5148\u304B\u53D7\u4FE1\u30E1\u30FC\u30EB\u306E\u72B6\u614B\u304C\u5909\u308F\u3063\u305F\u306E\u3067\u3001\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u3066\u3082\u3046\u4E00\u5EA6\u9001\u4FE1\u3092\u62BC\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  approval_required: "\u9001\u4FE1\u306F\u3001\u30AB\u30FC\u30C9\u306E\u300C\u9001\u4FE1\u300D\u304B\u3089\u3060\u3051\u884C\u3048\u307E\u3059\u3002",
  gmail_not_connected: "Gmail \u304C\u672A\u63A5\u7D9A\u3067\u3059\u3002\u9001\u4FE1\u306F\u3057\u3066\u3044\u307E\u305B\u3093\u3002",
  gmail_not_configured: "Gmail \u306E\u79D8\u5BC6\u60C5\u5831\u304C\u672A\u8A2D\u5B9A\u3067\u3059\u3002\u9001\u4FE1\u306F\u3057\u3066\u3044\u307E\u305B\u3093\u3002",
  gmail_refresh_failed: "Gmail \u306E\u63A5\u7D9A\u3092\u66F4\u65B0\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u9001\u4FE1\u306F\u3057\u3066\u3044\u307E\u305B\u3093\u3002",
  gmail_send_failed: "Gmail \u304C\u9001\u4FE1\u3092\u53D7\u3051\u4ED8\u3051\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30E1\u30FC\u30EB\u306F\u672A\u9001\u4FE1\u3067\u3059\u3002",
  mail_not_connected: "\u5DEE\u51FA\u4EBA\u304C\u672A\u9023\u643A\u3067\u3059\u3002\u63A5\u7D9A\u3057\u3066\u304B\u3089\u3001\u3082\u3046\u4E00\u5EA6\u30AB\u30FC\u30C9\u3092\u958B\u3044\u3066\u304F\u3060\u3055\u3044\u3002\u9001\u4FE1\u306F\u3057\u3066\u3044\u307E\u305B\u3093\u3002",
  thread_required: "\u9001\u4FE1\u5148\u306F\u3001\u8EE2\u9001\u3067\u5C4A\u3044\u305F\u30E1\u30FC\u30EB\u306E\u8A18\u9332\u304B\u3089\u3060\u3051\u53D6\u308A\u307E\u3059\u3002\u3053\u306E\u4E0B\u66F8\u304D\u306B\u306F\u53D7\u4FE1\u8A18\u9332\u304C\u7121\u3044\u306E\u3067\u9001\u3063\u3066\u3044\u307E\u305B\u3093\u3002",
  smtp_uncertain: "\u30B5\u30FC\u30D0\u30FC\u3068\u306E\u63A5\u7D9A\u304C\u9001\u4FE1\u306E\u9014\u4E2D\u3067\u5207\u308C\u307E\u3057\u305F\u3002\u5C4A\u3044\u305F\u304B\u3069\u3046\u304B\u78BA\u5B9A\u3067\u304D\u306A\u3044\u306E\u3067\u3001\u518D\u9001\u306F\u3057\u307E\u305B\u3093\u3002\u9001\u4FE1\u6E08\u307F\u30D5\u30A9\u30EB\u30C0\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  smtp_auth_failed: "\u30E1\u30FC\u30EB\u306E\u30ED\u30B0\u30A4\u30F3\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u63A5\u7D9A\u3092\u3084\u308A\u76F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u9001\u4FE1\u306F\u3057\u3066\u3044\u307E\u305B\u3093\u3002",
  smtp_failed: "\u30E1\u30FC\u30EB\u30B5\u30FC\u30D0\u304C\u9001\u4FE1\u3092\u53D7\u3051\u4ED8\u3051\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u30E1\u30FC\u30EB\u306F\u672A\u9001\u4FE1\u3067\u3059\u3002",
  sender_mismatch: "\u63A5\u7D9A\u4E2D\u306E\u30A2\u30AB\u30A6\u30F3\u30C8\u304C\u5DEE\u51FA\u4EBA\u3068\u9055\u3046\u306E\u3067\u3001\u9001\u3063\u3066\u3044\u307E\u305B\u3093\u3002",
  invalid_server: "\u30E1\u30FC\u30EB\u30B5\u30FC\u30D0\u306E\u6307\u5B9A\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u9001\u4FE1\u306F\u3057\u3066\u3044\u307E\u305B\u3093\u3002",
  channel_not_email: "\u3053\u306E\u30AB\u30FC\u30C9\u304C\u9001\u308C\u308B\u306E\u306F\u30E1\u30FC\u30EB\u3060\u3051\u3067\u3059\u3002LINE \u3084 Chatwork \u306F\u3053\u3053\u304B\u3089\u9001\u308A\u307E\u305B\u3093\u3002",
  llm_not_configured: "LLM \u306F\u672A\u63A5\u7D9A\u306E\u305F\u3081\u3001\u5B9A\u578B\u6587\u306B\u3057\u3066\u3044\u307E\u3059\u3002",
  llm_unavailable: "LLM \u3092\u4F7F\u3048\u306A\u304B\u3063\u305F\u305F\u3081\u3001\u5B9A\u578B\u6587\u306B\u3057\u3066\u3044\u307E\u3059\u3002",
  llm_failed: "LLM \u304C\u5931\u6557\u3057\u305F\u305F\u3081\u3001\u5B9A\u578B\u6587\u306B\u3057\u3066\u3044\u307E\u3059\u3002",
  user_quota_exhausted: "\u539F\u4FA1\u306E\u56DE\u6570\u3092\u4F7F\u3044\u5207\u3063\u305F\u305F\u3081\u3001\u5B9A\u578B\u6587\u306B\u3057\u3066\u3044\u307E\u3059\u3002",
  daily_budget_exhausted: "\u672C\u65E5\u306E\u539F\u4FA1\u4E0A\u9650\u306B\u9054\u3057\u305F\u305F\u3081\u3001\u5B9A\u578B\u6587\u306B\u3057\u3066\u3044\u307E\u3059\u3002",
  cost_guard_unavailable: "\u539F\u4FA1\u30AC\u30FC\u30C9\u304C\u4F7F\u3048\u306A\u304B\u3063\u305F\u305F\u3081\u3001\u5B9A\u578B\u6587\u306B\u3057\u3066\u3044\u307E\u3059\u3002"
};
var WIDGET_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>\u30E1\u30FC\u30EB\u306E\u4F5C\u6210 | AI\u8FD4\u4FE1\u79D8\u66F8</title>
<meta name="referrer" content="no-referrer" />
<style>
  :root { color-scheme: light; --bg: #f4f7fb; --card: #fff; --ink: #0f172a; --muted: #64748b; --line: #e2e8f0; --chip: #f8fafc; --field: transparent; }
  :root[data-theme="dark"] { color-scheme: dark; --bg: #0f1115; --card: #2a2f38; --ink: #f8fafc; --muted: #cbd5e1; --line: #3b4250; --chip: #343b46; --field: transparent; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { color-scheme: dark; --bg: #0f1115; --card: #2a2f38; --ink: #f8fafc; --muted: #cbd5e1; --line: #3b4250; --chip: #343b46; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; background: var(--bg); color: var(--ink); line-height: 1.5; }
  main { width: min(44rem, 100%); margin: 0 auto; padding: 12px; }
  h1 { font-size: 1.05rem; margin: 0; font-weight: 700; }
  p { margin: 0 0 8px; }
  .card { background: var(--card); color: var(--ink); border-radius: 18px; padding: 14px 14px 12px; box-shadow: 0 10px 28px rgba(0,0,0,.18); }
  .head { display: flex; gap: 8px; align-items: flex-start; justify-content: space-between; }
  .iconrow { display: flex; gap: 6px; align-items: center; flex: 0 0 auto; }
  button.icon, button.pill, button.quiet { border: 0; cursor: pointer; font: inherit; }
  button.icon { width: 34px; height: 34px; border-radius: 999px; background: transparent; color: var(--ink); }
  button.pill { border-radius: 999px; background: #1d4ed8; color: #fff; font-weight: 700; padding: 8px 16px; font-size: 15px; }
  button.quiet { background: transparent; color: #1d4ed8; font-weight: 700; padding: 8px 4px; }
  button:disabled { opacity: .55; cursor: not-allowed; }
  .row { display: grid; grid-template-columns: 4.5rem 1fr; gap: 8px; align-items: center; padding: 7px 0; }
  .row span { color: var(--muted); font-size: .92rem; }
  input, textarea, select { width: 100%; border: 0; background: var(--field); color: inherit; font: inherit; font-size: 16px; padding: 0; }
  textarea { min-height: 11rem; max-height: 22rem; resize: vertical; overflow: auto; line-height: 1.6; }
  .rule { border: 0; border-top: 1px solid var(--line); margin: 4px 0 8px; }
  .chips { display: flex; gap: 8px; overflow-x: auto; padding: 8px 0; }
  .chips button { text-align: left; border: 1px solid var(--line); background: var(--chip); color: inherit; border-radius: 12px; padding: 8px; min-width: 9.5rem; cursor: pointer; }
  .chips button[aria-pressed="true"] { border-color: #1d4ed8; box-shadow: inset 0 0 0 1px #1d4ed8; }
  .chips small { display: block; color: var(--muted); }
  details { color: var(--muted); font-size: .92rem; }
  .paste { margin-top: 12px; }
  .paste textarea { min-height: 5rem; border: 1px solid var(--line); border-radius: 10px; padding: 8px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .status, .patent, .note, .fromline { color: var(--muted); font-size: .85rem; }
  .fromline { color: var(--ink); font-size: 1rem; margin: 0; }
  .check { display: flex; gap: 8px; align-items: flex-start; font-weight: 650; margin: 8px 0; }
  [hidden] { display: none !important; }
  :focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }
</style>
</head>
<body>
<main>
  <article id="composeCard" class="card">
    <div class="head">
      <h1 id="cardTitle">\u8FD4\u4FE1</h1>
      <div class="iconrow">
        <button id="copyButton" class="icon" type="button" aria-label="\u672C\u6587\u3092\u30B3\u30D4\u30FC">\u29C9</button>
        <button id="openButton" class="icon" type="button" aria-label="\u30E1\u30FC\u30EB\u3092\u958B\u304F">\u2197</button>
        <button id="sendButton" class="pill" type="button">\u9001\u4FE1</button>
      </div>
    </div>
    <div id="candidateChips" class="chips"></div>
    <p id="emotionCaption" class="note">\u76F8\u624B\u306E\u6C17\u6301\u3061\u306F\u3001\u5019\u88DC\u3092\u62BC\u3059\u3068\u672C\u6587\u3078\u5165\u308A\u307E\u3059\u3002\u70B9\u6570\u306F\u4E88\u6E2C\u3067\u3059\u3002</p>
    <div class="row"><span>\u5DEE\u51FA\u4EBA</span><p id="composeFromText" class="fromline">\u672A\u9023\u643A</p></div>
    <p id="providerLine" class="note" hidden></p>
    <button id="connectLink" class="quiet" type="button" hidden>\u63A5\u7D9A\u3059\u308B</button>
    <input id="composeFrom" type="hidden" />
    <label class="row"><span>\u5B9B\u5148</span><input id="composeTo" type="email" autocomplete="email" placeholder="\u76F8\u624B\u306E\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9" /></label>
    <details>
      <summary>Cc / Bcc</summary>
      <label class="row"><span>Cc</span><input id="composeCc" type="email" autocomplete="email" /></label>
      <label class="row"><span>Bcc</span><input id="composeBcc" type="email" autocomplete="email" /></label>
    </details>
    <label class="row"><span>\u4EF6\u540D</span><input id="composeSubject" type="text" /></label>
    <hr class="rule" />
    <textarea id="composeBody" aria-label="\u672C\u6587" placeholder="\u672C\u6587"></textarea>
    <label id="riskRow" class="check" hidden><input id="riskCheck" type="checkbox" /> \u9AD8\u30EA\u30B9\u30AF\u306E\u305F\u3081\u3001\u7D04\u675F\u3084\u65AD\u5B9A\u3092\u3057\u306A\u3044\u3053\u3068\u3092\u78BA\u8A8D\u3057\u307E\u3057\u305F\u3002</label>
    <div class="actions">
      <button id="draftButton" class="quiet" type="button">\u4E0B\u66F8\u304D\u4FDD\u5B58</button>
      <button id="confirmButton" class="quiet" type="button">\u30B3\u30D4\u30FC\u7528\u306B\u78BA\u8A8D</button>
    </div>
  </article>
  <p id="unsentLine" class="note">\u3053\u306E\u30E1\u30FC\u30EB\u306F\u672A\u9001\u4FE1\u3067\u3059\u3002</p>
  <p id="handoffLine" class="note"></p>
  <p id="referenceLine" class="note"></p>
  <form id="deskForm" class="paste">
    <label>\u53D7\u3051\u53D6\u3063\u305F\u30E1\u30FC\u30EB<textarea id="pasteBody" name="body" placeholder="\u76F8\u624B\u304B\u3089\u306E\u672C\u6587"></textarea></label>
    <div class="row"><span>\u5DEE\u51FA\u4EBA</span><input id="pasteSender" name="sender" type="text" /></div>
    <div class="row"><span>\u4EF6\u540D</span><input id="pasteSubject" name="subject" type="text" /></div>
    <label class="row">\u30C1\u30E3\u30CD\u30EB
      <select id="pasteChannel" name="channel">
        <option value="email">\u30E1\u30FC\u30EB</option>
        <option value="line">LINE</option>
        <option value="chatwork">Chatwork</option>
        <option value="other">\u305D\u306E\u4ED6</option>
      </select>
    </label>
    <input id="pasteTone" name="tone" type="hidden" value="polite" />
    <input id="pasteIntent" name="intent" type="hidden" value="" />
    <input id="pasteDiscount" name="discountCeilingPercent" type="hidden" value="" />
    <input id="pasteMinOrder" name="minOrderValueYen" type="hidden" value="" />
    <label class="row"><span>\u30E1\u30FC\u30EB</span><input id="pasteEmail" name="email" type="email" autocomplete="email" /></label>
    <div class="actions">
      <button id="proposeButton" class="pill" type="submit">\u5019\u88DC\u3092\u4F5C\u308B</button>
      <button id="shioriButton" class="quiet" type="button">\u3057\u304A\u308A\u306B\u6B8B\u3059</button>
      <button id="trialButton" class="quiet" type="button">\u304A\u8A66\u3057</button>
      <button id="priceButton" class="quiet" type="button">\u6599\u91D1</button>
    </div>
  </form>
  <section id="riskCard" hidden>
    <p><span id="riskBadge"></span> <span id="riskScore"></span></p>
    <div id="riskMeter" hidden><span id="riskBar"></span></div>
    <ul id="riskReasons"></ul>
    <p id="classLine"></p>
  </section>
  <div id="emotionCompare" hidden></div>
  <div id="candidateList" hidden></div>
  <label id="humanRow" class="check" hidden><input id="humanCheck" type="checkbox" checked /> \u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u307E\u3057\u305F\u3002</label>
  <label id="copyLabel" hidden>\u30B3\u30D4\u30FC\u3059\u308B\u6587\u9762<textarea id="copyOut" readonly></textarea></label>
  <div id="shioriList"></div>
  <p id="billingLine" class="note"></p>
  <p id="statusLine" class="status" role="status" aria-live="polite"></p>
  <p class="patent">${PATENT_LABEL}</p>
</main>
<script type="module">
const reasons = ${JSON.stringify(REASONS)};
const $ = (id) => document.getElementById(id);
let deskId = '';
let view = {};
let priceUrl = '/price/';
let busy = false;
try {
  deskId = sessionStorage.getItem('henshinDeskId') || crypto.randomUUID();
  sessionStorage.setItem('henshinDeskId', deskId);
} catch (error) {
  deskId = crypto.randomUUID();
}
const embedded = window.parent !== window && !location.pathname.startsWith('/preview/');
let rpcId = 0;
const pending = new Map();
const rpcNotify = (method, params) => { if (embedded) window.parent.postMessage({ jsonrpc: '2.0', method, params }, '*'); };
const rpcRequest = (method, params) => new Promise((resolve, reject) => {
  const id = ++rpcId;
  pending.set(id, { resolve, reject });
  window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
});
function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
}
window.addEventListener('message', (event) => {
  if (!embedded || event.source !== window.parent) return;
  const message = event.data;
  if (!message || message.jsonrpc !== '2.0') return;
  if (typeof message.id === 'number') {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(message.error);
    else waiter.resolve(message.result);
    return;
  }
  if (message.method === 'ui/notifications/tool-result') applyResult(message.params || {});
  if (message.method === 'ui/notifications/tool-input') fillIncoming(message.params && message.params.arguments);
  if (message.method === 'ui/notifications/host-context-changed') applyTheme(message.params && message.params.theme);
});
const bridgeReady = embedded
  ? rpcRequest('ui/initialize', {
      appInfo: { name: 'henshin-hisho-compose', version: '0.2.0' },
      appCapabilities: { availableDisplayModes: ['inline'] },
      protocolVersion: '2026-01-26'
    }).then((result) => {
      applyTheme(result && result.hostContext && result.hostContext.theme);
      rpcNotify('ui/notifications/initialized', {});
    }).catch(() => setStatus('\u30DB\u30B9\u30C8\u3068\u306E\u63A5\u7D9A\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u30AB\u30FC\u30C9\u81EA\u4F53\u306F\u7DE8\u96C6\u3067\u304D\u307E\u3059\u3002'))
  : Promise.resolve();
if (embedded && window.ResizeObserver) {
  const observer = new ResizeObserver(() => rpcNotify('ui/notifications/size-changed', { height: document.documentElement.scrollHeight }));
  observer.observe(document.body);
}
function setBusy(value) {
  busy = value;
  ['sendButton', 'draftButton', 'copyButton', 'proposeButton', 'confirmButton', 'shioriButton'].forEach((id) => { $(id).disabled = value; });
  if (view.blockSend) $('sendButton').disabled = true;
}
function setStatus(text) { $('statusLine').textContent = text || ''; }
function composeFromForm() {
  return {
    from: $('composeFrom').value,
    to: $('composeTo').value,
    cc: $('composeCc').value,
    bcc: $('composeBcc').value,
    subject: $('composeSubject').value,
    body: $('composeBody').value
  };
}
function fillCompose(compose) {
  if (!compose) return;
  $('composeFrom').value = compose.from || '';
  $('composeTo').value = compose.to || '';
  $('composeCc').value = compose.cc || '';
  $('composeBcc').value = compose.bcc || '';
  $('composeSubject').value = compose.subject || '';
  $('composeBody').value = compose.body || '';
  $('cardTitle').textContent = compose.subject || '\u8FD4\u4FE1';
  const linked = compose.linked !== false && (compose.providerLabel || compose.from);
  const provider = linked
    ? (compose.providerLabel ? compose.providerLabel + (compose.from ? ' \xB7 ' + compose.from : '') : compose.from)
    : '\u672A\u9023\u643A';
  $('composeFromText').textContent = provider;
  $('providerLine').textContent = provider;
  $('connectLink').hidden = linked;
  if (!linked && compose.connectUrl) $('connectLink').dataset.href = compose.connectUrl;
}
function fillIncoming(args) {
  if (!args) return;
  if (!$('pasteSender').value && args.sender) $('pasteSender').value = args.sender;
  if (!$('pasteSubject').value && args.subject) $('pasteSubject').value = args.subject;
  if (!$('pasteBody').value && args.body) $('pasteBody').value = args.body;
}
function payloadFromForm() {
  return {
    deskId,
    sender: $('pasteSender').value,
    subject: $('pasteSubject').value,
    channel: $('pasteChannel').value,
    tone: $('pasteTone').value,
    body: $('pasteBody').value,
    intent: $('pasteIntent').value,
    instruction: $('pasteIntent').value,
    discountCeilingPercent: $('pasteDiscount').value,
    minOrderValueYen: $('pasteMinOrder').value,
    email: $('pasteEmail').value,
    incomingId: view.incomingId || ''
  };
}
async function callTool(name, args) {
  await bridgeReady;
  if (!embedded) {
    const response = await fetch('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
    });
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message || 'tool_error');
    return payload.result || {};
  }
  try {
    return await rpcRequest('tools/call', { name, arguments: args });
  } catch (error) {
    if (window.openai && typeof window.openai.callTool === 'function') return window.openai.callTool(name, args);
    throw error;
  }
}
function renderChips() {
  const box = $('candidateChips');
  box.replaceChildren();
  const compare = $('emotionCompare');
  compare.replaceChildren();
  (view.candidates || []).forEach((candidate) => {
    const emotion = candidate.emotion || {};
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-pressed', candidate.text === $('composeBody').value ? 'true' : 'false');
    const name = document.createElement('strong');
    name.textContent = candidate.label || '';
    const meta = document.createElement('small');
    meta.textContent = '\u76F8\u624B\u306E\u6C17\u6301\u3061 ' + (emotion.category || '') + ' ' + (emotion.score ?? '');
    button.append(name, meta);
    button.addEventListener('click', () => {
      $('composeBody').value = candidate.text || '';
      view.selectedId = candidate.id;
      renderChips();
    });
    box.appendChild(button);
    const cell = document.createElement('p');
    cell.textContent = (candidate.label || '') + ' ' + (emotion.category || '') + ' ' + (emotion.score ?? '') + ' ' + (emotion.reason || '');
    compare.appendChild(cell);
  });
  $('riskRow').hidden = !(view.risk && view.risk.level === 'high');
  $('unsentLine').textContent = view.sent ? '\u9001\u4FE1\u3057\u307E\u3057\u305F\u3002' : '\u3053\u306E\u30E1\u30FC\u30EB\u306F\u672A\u9001\u4FE1\u3067\u3059\u3002';
  $('cardTitle').textContent = $('composeSubject').value || '\u8FD4\u4FE1';
}
function applyResult(result) {
  const data = result.structuredContent || result;
  if (!data || typeof data !== 'object') return;
  if (result._meta && result._meta.sendNonce) view.sendNonce = result._meta.sendNonce;
  if (data.deskId) deskId = data.deskId;
  if (data.priceUrl) priceUrl = data.priceUrl;
  const next = { ...data };
  if (!Object.prototype.hasOwnProperty.call(data, 'candidates')) delete next.candidates;
  const previousSnapshot = view.snapshotId;
  if (data.snapshotId && data.snapshotId !== previousSnapshot) {
    view = { ...view, ...next, reconfirm: false, blockSend: false };
    fillCompose(data.compose);
  } else {
    view = { ...view, ...next };
    if (data.compose && !view.snapshotId) fillCompose(data.compose);
  }
  if (data.reconfirm) view.reconfirm = true;
  if (data.sent === true) view.sent = true;
  if (data.uncertain === true) view.blockSend = true;
  $('handoffLine').textContent = data.handoff || view.handoff || '';
  const reference = view.reference;
  $('referenceLine').textContent = reference && reference.refersToPrevious
    ? (reference.resolved ? '\u300C\u3055\u3063\u304D\u306E\u4EBA\u300D\u306F\u3057\u304A\u308A\u306E' + (reference.sender || '\u76F8\u624B') + '\u306B\u89E3\u6C7A\u3057\u307E\u3057\u305F\u3002' : '\u300C\u3055\u3063\u304D\u306E\u4EBA\u300D\u306B\u5F53\u305F\u308B\u3057\u304A\u308A\u304C\u3042\u308A\u307E\u305B\u3093\u3002\u76F8\u624B\u306F\u63A8\u6E2C\u3057\u3066\u3044\u307E\u305B\u3093\u3002')
    : '';
  if (view.risk) {
    $('riskCard').hidden = false;
    $('riskBadge').textContent = view.risk.level === 'high' ? '\u9AD8' : view.risk.level === 'medium' ? '\u4E2D' : '\u4F4E';
    $('riskScore').textContent = String(view.risk.score || 0);
    $('classLine').textContent = view.classification === 'notice' ? '\u901A\u77E5\u30FB\u81EA\u52D5\u914D\u4FE1\u3068\u3057\u3066\u632F\u308A\u5206\u3051\u307E\u3057\u305F\u3002\u8FD4\u4FE1\u5019\u88DC\u306F\u4F5C\u3063\u3066\u3044\u307E\u305B\u3093\u3002' : '';
  }
  if (data.copyText) {
    $('copyOut').value = data.copyText;
    $('copyLabel').hidden = false;
  }
  renderChips();
  if (data.reason && reasons[data.reason]) setStatus(reasons[data.reason]);
}
async function run(name, args, pendingLabel) {
  if (busy) return;
  setBusy(true);
  setStatus(pendingLabel);
  try {
    const result = await callTool(name, args);
    applyResult(result || {});
    const data = (result && result.structuredContent) || {};
    if (data.uncertain === true) setStatus(reasons.smtp_uncertain);
    else if (data.sent === true) setStatus('\u9001\u4FE1\u3057\u307E\u3057\u305F\u3002');
    else if (data.reason && reasons[data.reason]) setStatus(reasons[data.reason]);
    else if (data.classification === 'notice') setStatus('\u901A\u77E5\u3068\u3057\u3066\u632F\u308A\u5206\u3051\u307E\u3057\u305F\u3002\u3053\u306E\u30E1\u30FC\u30EB\u306F\u672A\u9001\u4FE1\u3067\u3059\u3002');
    else if (name === 'save_compose_draft' && data.ok) setStatus('\u4E0B\u66F8\u304D\u3092\u30A2\u30D7\u30EA\u306B\u4FDD\u5B58\u3057\u307E\u3057\u305F\u3002\u3053\u306E\u30E1\u30FC\u30EB\u306F\u672A\u9001\u4FE1\u3067\u3059\u3002');
    else setStatus('\u3053\u306E\u30E1\u30FC\u30EB\u306F\u672A\u9001\u4FE1\u3067\u3059\u3002');
  } catch (error) {
    setStatus('\u51E6\u7406\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u3053\u306E\u30E1\u30FC\u30EB\u306F\u672A\u9001\u4FE1\u3067\u3059\u3002');
  } finally {
    setBusy(false);
  }
}
$('composeSubject').addEventListener('input', () => { $('cardTitle').textContent = $('composeSubject').value || '\u8FD4\u4FE1'; });
$('deskForm').addEventListener('submit', (event) => {
  event.preventDefault();
  run('propose_replies', payloadFromForm(), '\u5019\u88DC\u3092\u4F5C\u3063\u3066\u3044\u307E\u3059\u3002');
});
$('sendButton').addEventListener('click', () => {
  run('send_reply', {
    userApproved: true,
    reconfirmed: view.reconfirm === true,
    sendNonce: view.sendNonce || '',
    snapshotId: view.snapshotId || '',
    incomingId: (view.compose && view.compose.incomingId) || '',
    riskAcknowledged: $('riskCheck').checked === true,
    riskLevel: (view.risk && view.risk.level) || 'low',
    channel: $('pasteChannel').value,
    deskId,
    ...composeFromForm()
  }, '\u9001\u4FE1\u524D\u306B\u72B6\u614B\u3092\u78BA\u8A8D\u3057\u3066\u3044\u307E\u3059\u3002');
});
$('draftButton').addEventListener('click', () => {
  run('save_compose_draft', { deskId, snapshotId: view.snapshotId || '', ...composeFromForm() }, '\u4E0B\u66F8\u304D\u3092\u4FDD\u5B58\u3057\u3066\u3044\u307E\u3059\u3002');
});
$('copyButton').addEventListener('click', async () => {
  const text = $('composeBody').value;
  $('copyOut').value = text;
  try { await navigator.clipboard.writeText(text); setStatus('\u672C\u6587\u3092\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F\u3002\u3053\u306E\u30E1\u30FC\u30EB\u306F\u672A\u9001\u4FE1\u3067\u3059\u3002'); }
  catch (error) { setStatus('\u30B3\u30D4\u30FC\u306F\u7AEF\u672B\u306B\u62D2\u5426\u3055\u308C\u307E\u3057\u305F\u3002\u3053\u306E\u30E1\u30FC\u30EB\u306F\u672A\u9001\u4FE1\u3067\u3059\u3002'); }
});
$('connectLink').addEventListener('click', () => {
  const href = $('connectLink').dataset.href || '/auth/mail-app/setup';
  if (window.openai && window.openai.openExternal) window.openai.openExternal({ href });
  else window.open(href, '_blank', 'noopener');
});
$('openButton').addEventListener('click', () => {
  const href = view.provider === 'gmail' || (view.compose && view.compose.provider === 'gmail') ? 'https://mail.google.com/mail/' : priceUrl;
  if (window.openai && window.openai.openExternal) window.openai.openExternal({ href });
  else window.open(href, '_blank', 'noopener');
});
$('confirmButton').addEventListener('click', () => {
  run('confirm_candidate', {
    deskId,
    text: $('composeBody').value,
    humanConfirmed: true,
    riskAcknowledged: $('riskCheck').checked === true,
    riskLevel: (view.risk && view.risk.level) || 'unknown',
    channel: $('pasteChannel').value,
    snapshotId: view.snapshotId || ''
  }, '\u78BA\u8A8D\u3092\u8A18\u9332\u3057\u3066\u3044\u307E\u3059\u3002');
});
$('shioriButton').addEventListener('click', () => {
  run('save_shiori', { ...payloadFromForm(), candidateText: $('composeBody').value, riskLevel: (view.risk && view.risk.level) || 'unknown' }, '\u3057\u304A\u308A\u306B\u6B8B\u3057\u3066\u3044\u307E\u3059\u3002');
});
$('trialButton').addEventListener('click', () => run('start_trial', { email: $('pasteEmail').value, deskId }, '\u304A\u8A66\u3057\u3092\u958B\u59CB\u3057\u3066\u3044\u307E\u3059\u3002'));
$('priceButton').addEventListener('click', () => {
  if (window.openai && window.openai.openExternal) window.openai.openExternal({ href: priceUrl });
  else window.open(priceUrl, '_blank', 'noopener');
});
if (window.openai && window.openai.toolOutput) {
  applyResult({ structuredContent: window.openai.toolOutput, _meta: window.openai.toolResponseMetadata || {} });
}
renderChips();
<\/script>
</body>
</html>`;

// src/mcp.js
var RESOURCE_URI = "ui://henshin-hisho/reply-form.html";
var RESOURCE_MIME = "text/html;profile=mcp-app";
var FALLBACK_PROTOCOL_VERSION = "2026-06-18";
function uiMeta(appOnly = false) {
  const ui = { resourceUri: RESOURCE_URI };
  if (appOnly) ui.visibility = ["app"];
  return {
    ui,
    "ui/resourceUri": RESOURCE_URI,
    "openai/outputTemplate": RESOURCE_URI
  };
}
__name(uiMeta, "uiMeta");
var TOOLS = [
  {
    name: "open_reply_desk",
    title: "\u30E1\u30FC\u30EB\u306E\u4F5C\u6210\u30AB\u30FC\u30C9\u3092\u958B\u304F",
    description: "\u5B9B\u5148\u30FB\u4EF6\u540D\u30FB\u672C\u6587\u306E\u4F5C\u6210\u30AB\u30FC\u30C9\u3092\u958B\u304F\u3002\u9001\u4FE1\u306F\u3057\u306A\u3044\u3002\u5019\u88DC\u304C\u5FC5\u8981\u306A\u3089 propose_replies \u3092\u4F7F\u3046\u3002",
    inputSchema: messageSchema(),
    _meta: uiMeta()
  },
  {
    name: "propose_replies",
    title: "\u8FD4\u4FE1\u306E\u4F5C\u6210\u30AB\u30FC\u30C9\u3092\u4F5C\u308B",
    description: "\u53D7\u3051\u53D6\u3063\u305F\u30E1\u30FC\u30EB\u3078\u306E\u8FD4\u4FE1\u30AB\u30FC\u30C9\u3092\u8FD4\u3059\u3002\u5B9B\u5148\u306F\u5143\u30E1\u30FC\u30EB\u304B\u3001\u3057\u304A\u308A\u306E\u300C\u3055\u3063\u304D\u306E\u4EBA\u300D\u304B\u3089\u89E3\u6C7A\u3059\u308B\u3002\u4EF6\u540D\u306F Re: \u3092\u4ED8\u3051\u308B\u3002\u672C\u6587\u306F\u5019\u88DC\u306E\u5148\u982D\u3067\u3001\u5019\u88DC\u306B\u306F\u76F8\u624B\u306E\u6C17\u6301\u3061\uFF08\u5206\u985E\u30FB\u70B9\u6570\u30FB\u7406\u7531\uFF09\u304C\u4ED8\u304F\u3002LLM \u306F backend \u306E\u4E0B\u66F8\u304D API \u3092\u901A\u3057\u3001\u4F7F\u3048\u306A\u3044\u3068\u304D\u306F\u5B9A\u578B\u6587\u306B\u3059\u308B\u3002\u9001\u4FE1\u306F\u3057\u306A\u3044\u3002",
    inputSchema: messageSchema(),
    _meta: uiMeta()
  },
  {
    name: "list_incoming",
    title: "\u5C4A\u3044\u305F\u30E1\u30FC\u30EB\u3092\u898B\u308B",
    description: "\u8EE2\u9001\uFF08Cloudflare Email Routing\uFF09\u3067\u53D6\u308A\u8FBC\u3093\u3060\u53D7\u4FE1\u30E1\u30FC\u30EB\u3092\u65B0\u3057\u3044\u9806\u306B\u8FD4\u3059\u3002\u9001\u4FE1\u306F\u3057\u306A\u3044\u3002",
    inputSchema: { type: "object", properties: {} },
    _meta: uiMeta()
  },
  {
    name: "get_incoming",
    title: "\u5C4A\u3044\u305F\u30E1\u30FC\u30EB\u30921\u4EF6\u898B\u308B",
    description: "\u53D7\u4FE1\u30E1\u30FC\u30EB\u30921\u4EF6\u8FD4\u3059\u3002\u305D\u306E\u3042\u3068 propose_replies \u306B incomingId \u3092\u6E21\u3059\u3002\u9001\u4FE1\u306F\u3057\u306A\u3044\u3002",
    inputSchema: { type: "object", properties: { incomingId: { type: "string" } }, required: ["incomingId"] },
    _meta: uiMeta()
  },
  {
    name: "save_shiori",
    title: "\u3057\u304A\u308A\u306B\u6B8B\u3059",
    description: "\u672C\u6587\u3068\u9078\u3093\u3060\u5019\u88DC\u3092\u3057\u304A\u308A\u3068\u3057\u3066\u6B8B\u3059\u3002\u9001\u4FE1\u306F\u3057\u306A\u3044\u3002",
    inputSchema: {
      type: "object",
      properties: { ...messageSchema().properties, candidateText: { type: "string" }, riskLevel: { type: "string" } }
    },
    _meta: uiMeta()
  },
  {
    name: "list_shiori",
    title: "\u3057\u304A\u308A\u3092\u898B\u308B",
    description: "\u4FDD\u5B58\u3057\u305F\u3057\u304A\u308A\u3092\u65B0\u3057\u3044\u9806\u306B\u8FD4\u3059\u3002\u9001\u4FE1\u306F\u3057\u306A\u3044\u3002",
    inputSchema: { type: "object", properties: { deskId: { type: "string" }, email: { type: "string" } } },
    _meta: uiMeta()
  },
  {
    name: "confirm_candidate",
    title: "\u78BA\u8A8D\u3057\u3066\u30B3\u30D4\u30FC\u7528\u306E\u6587\u9762\u3092\u6E21\u3059",
    description: "\u4EBA\u304C\u78BA\u8A8D\u3057\u305F\u3042\u3068\u3060\u3051\u3001\u30B3\u30D4\u30FC\u7528\u306E\u6587\u9762\u3092\u8FD4\u3059\u3002\u72B6\u614B\u304C\u9055\u3048\u3070\u6E21\u3055\u306A\u3044\u3002\u9001\u4FE1\u306F\u3057\u306A\u3044\u3002\u30AB\u30FC\u30C9\u304B\u3089\u306E\u307F\u547C\u3076\u3002",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        humanConfirmed: { type: "boolean" },
        riskAcknowledged: { type: "boolean" },
        riskLevel: { type: "string" },
        channel: { type: "string" },
        deskId: { type: "string" },
        snapshotId: { type: "string" }
      },
      required: ["text", "humanConfirmed"]
    },
    _meta: uiMeta(true)
  },
  {
    name: "save_compose_draft",
    title: "\u4E0B\u66F8\u304D\u3092\u30A2\u30D7\u30EA\u306B\u4FDD\u5B58\u3059\u308B",
    description: "\u4F5C\u6210\u4E2D\u306E\u5B9B\u5148\u30FB\u4EF6\u540D\u30FB\u672C\u6587\u3092\u30A2\u30D7\u30EA\u5074\u306B\u4FDD\u5B58\u3059\u308B\u3002Gmail \u306E\u4E0B\u66F8\u304D\u306B\u306F\u3057\u306A\u3044\u3002\u9001\u4FE1\u306F\u3057\u306A\u3044\u3002\u30AB\u30FC\u30C9\u304B\u3089\u306E\u307F\u547C\u3076\u3002",
    inputSchema: {
      type: "object",
      properties: {
        deskId: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        cc: { type: "string" },
        bcc: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" }
      }
    },
    _meta: uiMeta(true)
  },
  {
    name: "send_reply",
    title: "\u4F5C\u6210\u30AB\u30FC\u30C9\u304B\u3089\u9001\u4FE1\u3059\u308B",
    description: "\u30AB\u30FC\u30C9\u306E\u300C\u9001\u4FE1\u300D\u3092\u62BC\u3057\u305F\u3068\u304D\u3060\u3051\u9001\u308B\u3002\u5DEE\u51FA\u4EBA\u304C Gmail / Workspace \u306A\u3089 Gmail API\u3001\u305D\u308C\u4EE5\u5916\u306E\u63A5\u7D9A\u6E08\u307F\u30A2\u30C9\u30EC\u30B9\u306A\u3089 SMTP\u3002\u5B9B\u5148\u306F\u4FDD\u5B58\u3057\u305F\u53D7\u4FE1\u30B9\u30EC\u30C3\u30C9\u3060\u3051\u3092\u4F7F\u3044\u3001\u76F4\u524D\u306B\u53D6\u308A\u76F4\u3059\u3002\u9055\u3048\u3070\u9001\u3089\u305A\u518D\u78BA\u8A8D\u3092\u6C42\u3081\u308B\u3002\u30E2\u30C7\u30EB\u304B\u3089\u306F\u547C\u3070\u306A\u3044\u3002",
    inputSchema: {
      type: "object",
      properties: {
        userApproved: { type: "boolean" },
        reconfirmed: { type: "boolean" },
        sendNonce: { type: "string" },
        snapshotId: { type: "string" },
        riskAcknowledged: { type: "boolean" },
        riskLevel: { type: "string" },
        channel: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        cc: { type: "string" },
        bcc: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" }
      },
      required: ["userApproved", "sendNonce", "snapshotId"]
    },
    _meta: uiMeta(true)
  },
  {
    name: "start_trial",
    title: "14\u65E5\u306E\u304A\u8A66\u3057\u3092\u59CB\u3081\u308B",
    description: `\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u3067${14}\u65E5\u306E\u304A\u8A66\u3057\u3092\u958B\u59CB\u3059\u308B\u3002\u540C\u3058\u30E1\u30FC\u30EB\u3067\u4E8C\u5EA6\u306F\u958B\u59CB\u3057\u306A\u3044\u3002\u9001\u4FE1\u306F\u3057\u306A\u3044\u3002`,
    inputSchema: {
      type: "object",
      properties: { email: { type: "string" }, deskId: { type: "string" } },
      required: ["email"]
    },
    _meta: uiMeta()
  },
  {
    name: "billing_status",
    title: "\u30D7\u30E9\u30F3\u3092\u78BA\u8A8D\u3059\u308B",
    description: `\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u306E\u30D7\u30E9\u30F3\u3068\u6599\u91D1\uFF08\u6708\u984D${PRICE_YEN}\u5186\uFF09\u3092\u8FD4\u3059\u3002\u9001\u4FE1\u306F\u3057\u306A\u3044\u3002`,
    inputSchema: { type: "object", properties: { email: { type: "string" }, deskId: { type: "string" } } },
    _meta: uiMeta()
  }
];
function messageSchema() {
  return {
    type: "object",
    properties: {
      sender: { type: "string", description: "\u76F8\u624B\u306E\u540D\u524D\u307E\u305F\u306F\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9" },
      to: { type: "string", description: "\u5B9B\u5148\u3002\u7A7A\u306A\u3089\u76F8\u624B\u306E\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u3092\u4F7F\u3046" },
      from: { type: "string", description: "\u8868\u793A\u7528\u3002\u9001\u4FE1\u6642\u306E\u5DEE\u51FA\u4EBA\u306F\u63A5\u7D9A\u6E08\u307F\u30A2\u30AB\u30A6\u30F3\u30C8\u304B\u3089\u6C7A\u3081\u308B" },
      cc: { type: "string" },
      bcc: { type: "string" },
      subject: { type: "string", description: "\u76F8\u624B\u306E\u4EF6\u540D\u3002\u8FD4\u4FE1\u3067\u306F Re: \u3092\u4ED8\u3051\u308B" },
      body: { type: "string", description: "\u76F8\u624B\u304B\u3089\u306E\u672C\u6587" },
      channel: { type: "string", enum: ["email", "line", "chatwork", "other"] },
      tone: { type: "string", enum: ["polite", "firm", "calm", "casual"] },
      intent: { type: "string", description: "\u8FD4\u4FE1\u306E\u610F\u56F3" },
      instruction: { type: "string", description: "\u81EA\u7136\u6587\u306E\u6307\u793A\u3002\u3055\u3063\u304D\u306E\u4EBA\u3001\u306A\u3069" },
      email: { type: "string", description: "\u5229\u7528\u8005\u306E\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9" },
      deskId: { type: "string" },
      incomingId: { type: "string", description: "\u53D6\u308A\u8FBC\u3093\u3060\u53D7\u4FE1\u30E1\u30FC\u30EB\u306E id" },
      discountCeilingPercent: { type: "integer" },
      minOrderValueYen: { type: "integer" }
    }
  };
}
__name(messageSchema, "messageSchema");
function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}
__name(rpcResult, "rpcResult");
function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
__name(rpcError, "rpcError");
function respond(request, body, status = 200) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...mcpCorsHeaders()
  };
  const session = request.headers.get("mcp-session-id");
  if (session) headers["mcp-session-id"] = session;
  return new Response(JSON.stringify(body), { status, headers });
}
__name(respond, "respond");
function deskOf(input = {}) {
  return { ...input, deskId: validDeskId(input.deskId) || crypto.randomUUID() };
}
__name(deskOf, "deskOf");
async function present(env, input, origin, extra = {}) {
  const desk = deskOf(input);
  const assessment = assessMessage(desk);
  const billing = extra.billing || await billingView(env, desk.email);
  const shiori = await listShiori(env, desk);
  const thread = extra.incoming || null;
  let compose = extra.compose;
  if (!compose) {
    compose = buildCompose(desk, extra.reference || {});
    if (thread) {
      const recipients = threadRecipients(thread);
      compose.to = recipients.to || thread.from || compose.to;
      compose.cc = recipients.cc;
      compose.bcc = recipients.bcc;
      compose.threadId = thread.id || "";
      compose.incomingId = thread.id || "";
    }
    Object.assign(compose, senderFields(await resolveReplySender(env, { thread, origin }), origin));
  }
  const payload = {
    ok: extra.ok !== false,
    reason: extra.reason || "",
    deskId: desk.deskId,
    sender: assessment.message.sender,
    subject: assessment.message.subject,
    body: assessment.message.body,
    intent: assessment.message.intent,
    tone: assessment.message.tone,
    channel: assessment.message.channel,
    discountCeilingPercent: assessment.message.discountCeilingPercent,
    minOrderValueYen: assessment.message.minOrderValueYen,
    classification: assessment.classification,
    handoff: extra.handoff || assessment.handoff,
    risk: assessment.risk,
    shiori: shiori.items || [],
    billing,
    priceUrl: `${origin}/price/`,
    patentLabel: PATENT_LABEL,
    compose,
    draftSource: extra.draftSource || "",
    sent: extra.sent === true
  };
  if (Object.prototype.hasOwnProperty.call(extra, "candidates")) payload.candidates = extra.candidates;
  if (extra.reference) payload.reference = extra.reference;
  if (extra.instruction) payload.instruction = extra.instruction;
  if (extra.snapshotId !== void 0) payload.snapshotId = extra.snapshotId;
  if (extra.stateCheck) payload.stateCheck = extra.stateCheck;
  if (extra.reconfirm) payload.reconfirm = true;
  if (extra.incoming) payload.incoming = extra.incoming;
  return payload;
}
__name(present, "present");
async function prepareInput(env, input) {
  const listed = await listShiori(env, input);
  const prepared = applyInstruction(input, listed.items || []);
  const source = { ...prepared.input };
  let incoming = null;
  if (source.incomingId) {
    incoming = await getIncoming(env, source.incomingId);
    if (incoming) {
      if (!source.sender) source.sender = incoming.from;
      if (!source.subject) source.subject = incoming.subject;
      if (!source.body) source.body = incoming.body;
      const recipients = threadRecipients(incoming);
      source.to = recipients.to || incoming.from;
      source.cc = recipients.cc;
      source.bcc = recipients.bcc;
      source.incomingId = incoming.id;
    }
  }
  return { ...prepared, input: source, incoming };
}
__name(prepareInput, "prepareInput");
async function storeSnapshot(env, assessment, candidates, compose, incoming) {
  const sendNonce = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  const snapshot = {
    id: snapshotId,
    riskLevel: assessment.risk.level,
    texts: candidates.map((candidate) => candidate.text),
    to: compose.to,
    cc: compose.cc,
    bcc: compose.bcc,
    subject: compose.subject,
    body: compose.body,
    incomingId: incoming?.id || "",
    incomingHash: incoming?.hash || "",
    threadId: incoming?.id || "",
    threadHash: incoming?.hash || "",
    sendNonce
  };
  if (!candidates.length) return { snapshotId: "", stateCheck: "not_needed", sendNonce: "" };
  if (!env.CHATGPT_KV) return { snapshotId, stateCheck: "not_stored", sendNonce };
  await env.CHATGPT_KV.put(`snapshot:${snapshotId}`, JSON.stringify(snapshot), { expirationTtl: 86400 });
  return { snapshotId, stateCheck: "stored", sendNonce };
}
__name(storeSnapshot, "storeSnapshot");
function toolResult(payload, meta) {
  const result = {
    isError: payload.ok === false,
    content: [{ type: "text", text: fallbackText(payload) }],
    structuredContent: payload
  };
  if (meta) result._meta = meta;
  return result;
}
__name(toolResult, "toolResult");
async function loadSnapshot(env, id) {
  if (!env.CHATGPT_KV || !id) return null;
  const raw = await env.CHATGPT_KV.get(`snapshot:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
__name(loadSnapshot, "loadSnapshot");
async function callTool(env, name, args, origin, accountEmail = "") {
  const input = { ...args && typeof args === "object" ? args : {} };
  if (accountEmail) input.email = accountEmail;
  if (name === "open_reply_desk") {
    const payload = await present(env, input, origin, { candidates: [] });
    return toolResult(payload);
  }
  if (name === "list_incoming") {
    const listed = await listIncoming(env);
    const payload = await present(env, input, origin, { ok: listed.ok, reason: listed.reason || "", candidates: [] });
    payload.incomingItems = listed.items || [];
    return toolResult(payload);
  }
  if (name === "get_incoming") {
    const item = await getIncoming(env, input.incomingId);
    const payload = await present(env, item ? { ...input, sender: item.from, subject: item.subject, body: item.body, to: item.from, incomingId: item.id } : input, origin, {
      ok: Boolean(item),
      reason: item ? "" : "invalid_incoming",
      candidates: [],
      incoming: item
    });
    return toolResult(payload);
  }
  if (name === "propose_replies") {
    const prepared = await prepareInput(env, input);
    const source = prepared.input;
    const context = { reference: prepared.reference, instruction: prepared.instruction, incoming: prepared.incoming };
    const assessment = assessMessage(source);
    if (!assessment.message.body) {
      const payload2 = await present(env, source, origin, { ok: false, reason: "empty_message", candidates: [], ...context });
      return toolResult(payload2);
    }
    if (assessment.classification === "notice") {
      const payload2 = await present(env, source, origin, { candidates: [], ...context });
      return toolResult(payload2);
    }
    const gate = await consumeGeneration(env, source);
    const generated = gate.ok ? await generateCandidates(env, assessment) : { candidates: buildCandidates(assessment), draftSource: "template", draftReason: gate.reason };
    const compose = buildCompose(source, prepared.reference);
    if (prepared.incoming) {
      const recipients = threadRecipients(prepared.incoming);
      compose.to = recipients.to || prepared.incoming.from || compose.to;
      compose.cc = recipients.cc;
      compose.bcc = recipients.bcc;
      compose.threadId = prepared.incoming.id;
      compose.incomingId = prepared.incoming.id;
    }
    Object.assign(compose, senderFields(await resolveReplySender(env, { thread: prepared.incoming, origin }), origin));
    compose.body = generated.candidates[0]?.text || "";
    const snapshot = await storeSnapshot(env, assessment, generated.candidates, compose, prepared.incoming);
    const payload = await present(env, source, origin, {
      candidates: generated.candidates,
      billing: gate.billing || await billingView(env, source.email),
      compose,
      draftSource: generated.draftSource,
      reason: generated.draftReason || "",
      snapshotId: snapshot.snapshotId,
      stateCheck: snapshot.stateCheck,
      ...context
    });
    return toolResult(payload, snapshot.sendNonce ? { sendNonce: snapshot.sendNonce } : null);
  }
  if (name === "save_shiori") {
    const saved = await saveShiori(env, input);
    const payload = await present(env, input, origin, { ok: saved.ok, reason: saved.reason || "" });
    return toolResult(payload);
  }
  if (name === "list_shiori") {
    const payload = await present(env, input, origin);
    return toolResult(payload);
  }
  if (name === "save_compose_draft") {
    if (!env.CHATGPT_KV) {
      const payload2 = await present(env, input, origin, { ok: false, reason: "storage_not_configured", sent: false });
      return toolResult(payload2);
    }
    const id = crypto.randomUUID();
    const compose = buildCompose(input, {});
    Object.assign(compose, senderFields(await resolveReplySender(env, { origin }), origin));
    compose.body = String(input.body || "").slice(0, 4e3);
    compose.subject = String(input.subject || compose.subject).slice(0, 200);
    await env.CHATGPT_KV.put(`app-draft:${id}`, JSON.stringify({ id, compose, at: Date.now() }));
    const payload = await present(env, input, origin, { compose, sent: false });
    payload.draftId = id;
    return toolResult(payload);
  }
  if (name === "send_reply") {
    const channel = input.channel || "email";
    if (channel !== "email") {
      const payload2 = await present(env, input, origin, { ok: false, reason: "channel_not_email", sent: false, handoff: handoffFor(channel) });
      return toolResult(payload2);
    }
    const snapshot = await loadSnapshot(env, input.snapshotId);
    const thread = snapshot?.threadId ? await getIncoming(env, snapshot.threadId) : null;
    const compared = compareSendState(snapshot, thread, input);
    const sender = await resolveReplySender(env, { thread, origin });
    const recipients = threadRecipients(thread);
    const compose = {
      ...senderFields(sender, origin),
      to: recipients.to,
      cc: recipients.cc,
      bcc: recipients.bcc,
      subject: input.subject || snapshot?.subject || "",
      body: input.body || snapshot?.body || "",
      threadId: thread?.id || "",
      incomingId: thread?.id || ""
    };
    if (!compared.ok) {
      const payload2 = await present(env, input, origin, {
        ok: false,
        reason: compared.reason,
        reconfirm: compared.reason === "state_mismatch",
        sent: false,
        incoming: thread,
        compose
      });
      return toolResult(payload2);
    }
    if (snapshot.riskLevel === "high" && input.riskAcknowledged !== true) {
      const payload2 = await present(env, input, origin, { ok: false, reason: "risk_acknowledgement_required", sent: false, compose });
      return toolResult(payload2);
    }
    if (!sender.linked) {
      const payload2 = await present(env, input, origin, { ok: false, reason: "mail_not_connected", sent: false, incoming: thread, compose });
      return toolResult(payload2);
    }
    const sent = await deliverReply(env, {
      sender,
      thread,
      subject: input.subject || snapshot.subject,
      body: input.body ?? snapshot.body
    });
    const payload = await present(env, input, origin, {
      ok: sent.ok,
      reason: sent.ok ? "" : sent.reason,
      sent: sent.sent === true,
      incoming: thread,
      compose: { ...compose, subject: input.subject || snapshot.subject, body: input.body ?? snapshot.body }
    });
    payload.uncertain = sent.uncertain === true;
    if (sent.gmailId || sent.messageId) payload.providerMessageId = sent.gmailId || sent.messageId;
    return toolResult(payload);
  }
  if (name === "confirm_candidate") {
    const review = reviewConfirmation(input);
    if (!review.ok) {
      return toolResult({ ok: false, reason: review.reason, sent: false, priceUrl: `${origin}/price/`, patentLabel: PATENT_LABEL, compose: {}, candidates: [] });
    }
    let stateCheck = "not_stored";
    if (env.CHATGPT_KV) {
      const snapshot = await loadSnapshot(env, input.snapshotId);
      const compared = compareSnapshot(snapshot, review);
      if (!compared.ok) {
        return toolResult({
          ok: false,
          reason: "state_mismatch",
          reconfirm: true,
          sent: false,
          priceUrl: `${origin}/price/`,
          patentLabel: PATENT_LABEL,
          compose: { body: "" },
          candidates: []
        });
      }
      stateCheck = "matched";
    }
    return toolResult({
      ok: true,
      copyText: review.copyText,
      confirmation: { id: crypto.randomUUID(), sent: false },
      handoff: handoffFor(input.channel),
      stateCheck,
      sent: false,
      priceUrl: `${origin}/price/`,
      patentLabel: PATENT_LABEL,
      compose: { body: review.copyText, subject: "", to: "", from: "" },
      candidates: []
    });
  }
  if (name === "start_trial") {
    const started = await startTrial(env, input.email);
    const payload = await present(env, input, origin, { ok: started.ok, reason: started.reason || "", billing: started.billing, candidates: [] });
    return toolResult(payload);
  }
  if (name === "billing_status") {
    const billing = await billingView(env, input.email);
    const payload = await present(env, input, origin, { billing, candidates: [] });
    return toolResult(payload);
  }
  throw Object.assign(new Error(`unknown tool: ${name}`), { rpcCode: -32602 });
}
__name(callTool, "callTool");
async function handleMcpRequest(request, env) {
  const origin = publicOrigin(request);
  let body;
  try {
    body = await request.json();
  } catch {
    return respond(request, rpcError(null, -32700, "parse error"), 400);
  }
  if (Array.isArray(body)) return respond(request, rpcError(null, -32600, "batch not supported"), 400);
  const { id, method, params } = body || {};
  if (method === "initialize") {
    const requested = params?.protocolVersion;
    const protocolVersion = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : FALLBACK_PROTOCOL_VERSION;
    return respond(
      request,
      rpcResult(id, {
        protocolVersion,
        capabilities: {
          tools: {},
          resources: {},
          extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [RESOURCE_MIME] } }
        },
        serverInfo: { name: "henshin-hisho", version: "0.2.0" }
      })
    );
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return new Response(null, { status: 202, headers: mcpCorsHeaders() });
  }
  if (method === "ping") return respond(request, rpcResult(id, {}));
  if (method === "tools/list") return respond(request, rpcResult(id, { tools: TOOLS }));
  if (method === "resources/list") {
    return respond(
      request,
      rpcResult(id, {
        resources: [{ uri: RESOURCE_URI, name: "reply-form", description: "\u30E1\u30FC\u30EB\u306E\u4F5C\u6210\u30AB\u30FC\u30C9", mimeType: RESOURCE_MIME }]
      })
    );
  }
  if (method === "resources/read") {
    if (params?.uri !== RESOURCE_URI) return respond(request, rpcError(id, -32002, "resource not found"));
    return respond(request, rpcResult(id, { contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME, text: WIDGET_HTML }] }));
  }
  if (method === "tools/call") {
    try {
      const header = request.headers.get("authorization") || "";
      const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      const access = await accessTokenRecord(env, bearer);
      const accountEmail = normalizeEmail(access?.accountEmail || "");
      const result = await callTool(env, params?.name, params?.arguments, origin, accountEmail);
      console.log(JSON.stringify({ event: "mcp_tool", tool: params?.name || "", ok: result?.structuredContent?.ok !== false }));
      return respond(request, rpcResult(id, result));
    } catch (error) {
      console.log(JSON.stringify({ event: "mcp_error", message: error?.message || "error" }));
      return respond(request, rpcError(id, error.rpcCode || -32e3, error.rpcCode ? error.message : "server_error"));
    }
  }
  return respond(request, rpcError(id, -32601, `method not found: ${method}`));
}
__name(handleMcpRequest, "handleMcpRequest");

// src/pages.js
var NOTICES = {
  trial_started: `${TRIAL_DAYS}\u65E5\u306E\u304A\u8A66\u3057\u3092\u958B\u59CB\u3057\u307E\u3057\u305F\u3002ChatGPT\u306E\u8FD4\u4FE1\u5019\u88DC\u30D5\u30A9\u30FC\u30E0\u306B\u3001\u540C\u3058\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u3092\u5165\u308C\u3066\u304F\u3060\u3055\u3044\u3002`,
  trial_used: "\u3053\u306E\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u306E\u304A\u8A66\u3057\u306F\u7D42\u4E86\u3057\u3066\u3044\u307E\u3059\u3002\u7D9A\u3051\u308B\u306B\u306F\u6708\u984D\u30D7\u30E9\u30F3\u304C\u5FC5\u8981\u3067\u3059\u3002",
  trial_busy: "\u305F\u3060\u3044\u307E\u304A\u8A66\u3057\u306E\u958B\u59CB\u304C\u96C6\u4E2D\u3057\u3066\u3044\u307E\u3059\u3002\u3057\u3070\u3089\u304F\u3057\u3066\u304B\u3089\u3082\u3046\u4E00\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002",
  checkout_pending: `\u6C7A\u6E08\u306E\u63A5\u7D9A\u3092\u6E96\u5099\u3057\u3066\u3044\u307E\u3059\u3002\u6599\u91D1\u306F\u6708\u984D${PRICE_YEN.toLocaleString("ja-JP")}\u5186\u3067\u3059\u3002\u63A5\u7D9A\u5F8C\u3001\u3053\u306E\u30DA\u30FC\u30B8\u304B\u3089\u652F\u6255\u3044\u3078\u9032\u3081\u307E\u3059\u3002`,
  checkout_cancel: "\u652F\u6255\u3044\u306F\u30AD\u30E3\u30F3\u30BB\u30EB\u3055\u308C\u307E\u3057\u305F\u3002",
  checkout_success: "\u652F\u6255\u3044\u3092\u53D7\u3051\u4ED8\u3051\u307E\u3057\u305F\u3002\u30D7\u30E9\u30F3\u3078\u306E\u53CD\u6620\u307E\u3067\u5C11\u3057\u6642\u9593\u304C\u304B\u304B\u308B\u3053\u3068\u304C\u3042\u308A\u307E\u3059\u3002",
  invalid_email: "\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u306E\u5F62\u5F0F\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  storage_not_configured: "\u304A\u8A66\u3057\u306E\u4FDD\u5B58\u5148\u304C\u672A\u63A5\u7D9A\u306E\u305F\u3081\u3001\u958B\u59CB\u3092\u8A18\u9332\u3067\u304D\u307E\u305B\u3093\u3002",
  forbidden: "\u5225\u306E\u30B5\u30A4\u30C8\u304B\u3089\u306E\u9001\u4FE1\u306F\u53D7\u3051\u4ED8\u3051\u3066\u3044\u307E\u305B\u3093\u3002"
};
function escapeHtml4(value) {
  return String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
}
__name(escapeHtml4, "escapeHtml");
function noticeText(key) {
  return NOTICES[key] || "";
}
__name(noticeText, "noticeText");
function pricePage(noticeKey = "") {
  const notice = noticeText(noticeKey);
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>\u6599\u91D1 | AI\u8FD4\u4FE1\u79D8\u66F8</title>
<meta name="description" content="AI\u8FD4\u4FE1\u79D8\u66F8\u306EChatGPT\u30A2\u30D7\u30EA\u3002\u6708\u984D${PRICE_YEN.toLocaleString("ja-JP")}\u5186\u3001${TRIAL_DAYS}\u65E5\u306E\u304A\u8A66\u3057\u3002\u8FD4\u4FE1\u306E\u9001\u4FE1\u306F\u672C\u4EBA\u304C\u884C\u3044\u307E\u3059\u3002" />
<link rel="canonical" href="/price/" />
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; background: #f4f7fb; color: #0f172a; line-height: 1.6; }
  main { width: min(40rem, 100%); margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: clamp(1.6rem, 4vw, 2.1rem); line-height: 1.3; margin: 0 0 8px; }
  h2 { font-size: 1.1rem; margin: 0 0 8px; }
  .card { background: #fff; border-radius: 16px; padding: 20px; margin-top: 16px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06); }
  .price { font-size: clamp(2rem, 6vw, 2.6rem); font-weight: 700; margin: 0; }
  .price span { font-size: 1rem; font-weight: 600; }
  .notice { background: #e0e7ff; border-radius: 12px; padding: 12px 14px; }
  label { display: block; font-weight: 600; margin-bottom: 12px; }
  input { width: 100%; margin-top: 6px; padding: 12px; font-size: 16px; border: 1px solid #cbd5e1; border-radius: 10px; }
  button { width: 100%; margin-top: 4px; border: 0; border-radius: 10px; padding: 12px 16px; font-size: 16px; font-weight: 700; background: #1d4ed8; color: #fff; cursor: pointer; }
  button.secondary { background: #fff; color: #1d4ed8; border: 1px solid #1d4ed8; }
  ul { margin: 0; padding-left: 1.2rem; }
  .patent { color: #475569; font-size: 0.85rem; }
  :focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }
  @media (min-width: 640px) {
    button { width: auto; }
  }
</style>
</head>
<body>
<main>
  <p>AI\u8FD4\u4FE1\u79D8\u66F8</p>
  <h1>\u6599\u91D1</h1>
  <p>\u4E00\u3064\u306E\u5951\u7D04\u3067\u3001ChatGPT\u3001Claude\u3001Grok \u306E\u4F5C\u6210\u30AB\u30FC\u30C9\u3068\u3001Web\u3001iPhone\u3001Android \u304C\u4F7F\u3048\u307E\u3059\u3002\u9001\u4FE1\u306F\u3001\u30AB\u30FC\u30C9\u306E\u300C\u9001\u4FE1\u300D\u3092\u62BC\u3057\u305F\u3068\u304D\u3060\u3051\u3067\u3059\u3002</p>
  ${notice ? `<p class="notice" role="status">${escapeHtml4(notice)}</p>` : ""}
  <section class="card" aria-labelledby="planTitle">
    <h2 id="planTitle">\u30B9\u30BF\u30F3\u30C0\u30FC\u30C9</h2>
    <p class="price">${PRICE_YEN.toLocaleString("ja-JP")}<span>\u5186 / \u6708</span></p>
    <p>\u5E74\u984D\u306F ${ANNUAL_YEN.toLocaleString("ja-JP")}\u5186\u3067\u3059\u3002\u304A\u8A66\u3057\u306F${TRIAL_DAYS}\u65E5\u9593\u3067\u3059\u3002\u671F\u9593\u306E\u3042\u3068\u306F\u3001\u7D9A\u3051\u308B\u304B\u3069\u3046\u304B\u3092\u9078\u3079\u307E\u3059\u3002</p>
    <ul>
      <li>\u8FD4\u4FE1\u5019\u88DC\u3092\u30C8\u30FC\u30F3\u5225\u306B\u898B\u6BD4\u3079\u308B</li>
      <li>\u5371\u967A\u5EA6\u3068\u7406\u7531\u3092\u3001\u30B3\u30D4\u30FC\u3059\u308B\u524D\u306B\u8868\u793A\u3059\u308B</li>
      <li>\u6587\u9762\u3068\u3057\u304A\u308A\u3092\u6B8B\u3057\u3001\u6B21\u306B\u53C2\u7167\u3059\u308B</li>
      <li>\u9AD8\u30EA\u30B9\u30AF\u306E\u6587\u9762\u306F\u3001\u78BA\u8A8D\u30C1\u30A7\u30C3\u30AF\u307E\u3067\u30B3\u30D4\u30FC\u3067\u304D\u306A\u3044</li>
    </ul>
  </section>
  <section class="card" aria-labelledby="trialTitle">
    <h2 id="trialTitle">\u304A\u8A66\u3057\u3092\u59CB\u3081\u308B</h2>
    <form method="post" action="/billing/trial">
      <label>\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9
        <input name="email" type="email" autocomplete="email" required />
      </label>
      <button type="submit">14\u65E5\u306E\u304A\u8A66\u3057\u3092\u958B\u59CB\u3059\u308B</button>
    </form>
  </section>
  <section class="card" aria-labelledby="payTitle">
    <h2 id="payTitle">\u6708\u984D\u3068\u5E74\u984D</h2>
    <p>Web \u3068\u4F5C\u6210\u30AB\u30FC\u30C9\u306E\u652F\u6255\u3044\u306F\u3001\u3053\u3053\u3067\u540C\u3058\u6599\u91D1\u3092\u4F7F\u3044\u307E\u3059\u3002iPhone \u3068 Android \u306F\u3001\u305D\u308C\u305E\u308C\u306E\u30B9\u30C8\u30A2\u306E\u5B9A\u671F\u8CFC\u5165\u3067\u3059\u3002\u3069\u306E\u753B\u9762\u3067\u7533\u3057\u8FBC\u3093\u3067\u3082\u3001\u540C\u3058\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u306E\u5951\u7D04\u304C\u958B\u304D\u307E\u3059\u3002</p>
    <form method="post" action="/billing/checkout">
      <input type="hidden" name="plan" value="monthly" />
      <label>\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9
        <input name="email" type="email" autocomplete="email" required />
      </label>
      <button class="secondary" type="submit">\u6708\u984D ${PRICE_YEN.toLocaleString("ja-JP")}\u5186\u3067\u59CB\u3081\u308B</button>
    </form>
    <form method="post" action="/billing/checkout">
      <input type="hidden" name="plan" value="annual" />
      <label>\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9
        <input name="email" type="email" autocomplete="email" required />
      </label>
      <button class="secondary" type="submit">\u5E74\u984D ${ANNUAL_YEN.toLocaleString("ja-JP")}\u5186\u3067\u59CB\u3081\u308B</button>
    </form>
    <p>\u904B\u55B6\u306F${OPERATOR_NAME}\u3067\u3059\u3002</p>
  </section>
  <p class="patent">${PATENT_LABEL}</p>
</main>
</body>
</html>`;
}
__name(pricePage, "pricePage");

// src/index.js
function redirect(location, status = 308) {
  return new Response(null, {
    status,
    headers: { location, "cache-control": "no-store" }
  });
}
__name(redirect, "redirect");
function noticeRedirect(request, key) {
  const safe = noticeText(key) ? key : "invalid_email";
  return redirect(`${publicOrigin(request)}/price/?notice=${encodeURIComponent(safe)}`, 303);
}
__name(noticeRedirect, "noticeRedirect");
async function billingPost(request, env, pathname) {
  if (!sameSitePost(request)) return noticeRedirect(request, "forbidden");
  const form = await readForm(request);
  if (!form) return noticeRedirect(request, "invalid_email");
  if (pathname === "/billing/trial") {
    const started = await startTrial(env, form.email);
    if (started.ok) return noticeRedirect(request, "trial_started");
    return noticeRedirect(request, started.reason || "invalid_email");
  }
  const session = await createCheckoutSession(env, {
    email: form.email,
    origin: publicOrigin(request),
    planId: form.plan || "monthly"
  });
  if (!session.ok) {
    return noticeRedirect(request, session.reason === "invalid_email" ? "invalid_email" : "checkout_pending");
  }
  return redirect(session.url, 303);
}
__name(billingPost, "billingPost");
async function webhook(request, env) {
  const payload = await request.text();
  const valid = await verifyStripeSignature(payload, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return json({ ok: false, reason: "invalid_signature" }, 400);
  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ ok: false, reason: "invalid_json" }, 400);
  }
  const result = await applyStripeEvent(env, event);
  return json({ ok: result.ok, ignored: Boolean(result.ignored), reason: result.reason || "" }, result.ok ? 200 : 400);
}
__name(webhook, "webhook");
function unauthorized(request) {
  return json({ error: "unauthorized" }, 401, {
    "www-authenticate": wwwAuthenticate(publicOrigin(request)),
    ...mcpCorsHeaders()
  });
}
__name(unauthorized, "unauthorized");
async function bearerAllowed(request, env) {
  const header = request.headers.get("authorization") || "";
  const token2 = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (env.MCP_ACCESS_TOKEN && timingSafeEqual(token2, env.MCP_ACCESS_TOKEN)) return true;
  return Boolean(await accessTokenRecord(env, token2));
}
__name(bearerAllowed, "bearerAllowed");
async function mcpEntry(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: mcpCorsHeaders() });
  if (request.method === "DELETE") return new Response(null, { status: 204, headers: mcpCorsHeaders() });
  if (request.method !== "POST") {
    return new Response("method not allowed", {
      status: 405,
      headers: { allow: "POST, DELETE, OPTIONS", ...mcpCorsHeaders() }
    });
  }
  const required = Boolean(env.MCP_ACCESS_TOKEN) || env.MCP_AUTH_REQUIRED === "1";
  if (required && !await bearerAllowed(request, env)) return unauthorized(request);
  return handleMcpRequest(request, env);
}
__name(mcpEntry, "mcpEntry");
async function googleStart(request, env) {
  const url = new URL(request.url);
  const adminKey = url.searchParams.get("key") || "";
  if (!env.OAUTH_ADMIN_KEY || !timingSafeEqual(adminKey, env.OAUTH_ADMIN_KEY) || !env.CHATGPT_KV) {
    return new Response("forbidden", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const state = crypto.randomUUID();
  await env.CHATGPT_KV.put(`google-state:${state}`, "1", { expirationTtl: 600 });
  return Response.redirect(buildGoogleAuthUrl(env, state), 302);
}
__name(googleStart, "googleStart");
async function googleCallback(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const stateOk = state && env.CHATGPT_KV && await env.CHATGPT_KV.get(`google-state:${state}`);
  if (!stateOk || !code) {
    return new Response("\u7121\u52B9\u306A\u30EA\u30AF\u30A8\u30B9\u30C8\u3067\u3059\u3002\u3082\u3046\u4E00\u5EA6\u63A5\u7D9A\u3092\u958B\u59CB\u3057\u3066\u304F\u3060\u3055\u3044\u3002", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
  await env.CHATGPT_KV.delete(`google-state:${state}`);
  const saved = await exchangeGoogleCode(env, code, env.GMAIL_FETCH || fetch);
  const text = saved.ok ? `Gmail\uFF08${saved.email}\uFF09\u3092\u63A5\u7D9A\u3057\u307E\u3057\u305F\u3002\u3053\u306E\u30BF\u30D6\u306F\u9589\u3058\u3066\u304F\u3060\u3055\u3044\u3002` : "Gmail \u306E\u63A5\u7D9A\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u9001\u4FE1\u306F\u3057\u3066\u3044\u307E\u305B\u3093\u3002";
  return new Response(text, { status: saved.ok ? 200 : 400, headers: { "content-type": "text/plain; charset=utf-8" } });
}
__name(googleCallback, "googleCallback");
async function msStart(request, env) {
  if (!msOauthEnabled(env)) {
    return new Response("Microsoft \u306E\u9001\u4FE1\u306F\u7121\u52B9\u3067\u3059\u3002\u53D7\u4FE1\u306E\u8EE2\u9001\u3060\u3051\u4F7F\u3048\u307E\u3059\u3002", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
  const url = new URL(request.url);
  const adminKey = url.searchParams.get("key") || "";
  if (!env.OAUTH_ADMIN_KEY || !timingSafeEqual(adminKey, env.OAUTH_ADMIN_KEY) || !env.CHATGPT_KV) {
    return new Response("forbidden", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const hint = url.searchParams.get("login_hint") || "";
  const state = crypto.randomUUID();
  await env.CHATGPT_KV.put(`ms-state:${state}`, hint, { expirationTtl: 600 });
  return Response.redirect(buildMicrosoftAuthUrl(env, state, hint), 302);
}
__name(msStart, "msStart");
async function msCallback(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const hint = state && env.CHATGPT_KV ? await env.CHATGPT_KV.get(`ms-state:${state}`) : null;
  if (hint == null || !code) {
    return new Response("\u7121\u52B9\u306A\u30EA\u30AF\u30A8\u30B9\u30C8\u3067\u3059\u3002\u3082\u3046\u4E00\u5EA6\u63A5\u7D9A\u3092\u958B\u59CB\u3057\u3066\u304F\u3060\u3055\u3044\u3002", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
  await env.CHATGPT_KV.delete(`ms-state:${state}`);
  const saved = await exchangeMicrosoftCode(env, code, hint, env.MAIL_FETCH || fetch);
  const text = saved.ok ? `Microsoft\uFF08${saved.email}\uFF09\u3092\u63A5\u7D9A\u3057\u307E\u3057\u305F\u3002\u3053\u306E\u30BF\u30D6\u306F\u9589\u3058\u3066\u304F\u3060\u3055\u3044\u3002` : "Microsoft \u306E\u63A5\u7D9A\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u9001\u4FE1\u306F\u3057\u3066\u3044\u307E\u305B\u3093\u3002";
  return new Response(text, { status: saved.ok ? 200 : 400, headers: { "content-type": "text/plain; charset=utf-8" } });
}
__name(msCallback, "msCallback");
async function issueMailSetup(request, env) {
  const url = new URL(request.url);
  const adminKey = url.searchParams.get("key") || "";
  if (!env.OAUTH_ADMIN_KEY || !timingSafeEqual(adminKey, env.OAUTH_ADMIN_KEY) || !env.CHATGPT_KV) {
    return new Response("forbidden", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const address = url.searchParams.get("address") || "";
  let provider = providerOf(address);
  if (provider === "other") provider = await detectProvider(domainOf(address), env.MAIL_FETCH || fetch);
  if (provider === "gmail" || provider === "workspace") {
    return new Response("\u3053\u306E\u30A2\u30C9\u30EC\u30B9\u306F Gmail \u306E\u63A5\u7D9A\u3092\u4F7F\u3044\u307E\u3059\u3002/oauth/google/start \u3092\u958B\u3044\u3066\u304F\u3060\u3055\u3044\u3002", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
  if (provider === "microsoft" && !msOauthEnabled(env)) {
    return new Response("Microsoft \u306E\u9001\u4FE1\u306F\u7121\u52B9\u3067\u3059\u3002\u53D7\u4FE1\u306E\u8EE2\u9001\u3060\u3051\u4F7F\u3048\u307E\u3059\u3002", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
  if (provider === "microsoft") {
    return new Response("Microsoft \u306F OAuth \u3067\u63A5\u7D9A\u3057\u307E\u3059\u3002/auth/ms/start \u3092\u958B\u3044\u3066\u304F\u3060\u3055\u3044\u3002", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
  const issued = await issueSetupCode(env, {
    address,
    provider,
    kind: url.searchParams.get("kind") || "operator",
    owner: url.searchParams.get("owner") || address
  });
  if (!issued.ok) {
    return new Response("\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return new Response(`\u63A5\u7D9A\u30DA\u30FC\u30B8\uFF0810\u5206\u30015\u56DE\u307E\u3067\uFF09:
${publicOrigin(request)}/auth/mail-app/setup?c=${issued.code}
`, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
  });
}
__name(issueMailSetup, "issueMailSetup");
async function incomingForward(request, env) {
  const header = request.headers.get("x-incoming-token") || "";
  if (!env.INCOMING_FORWARD_TOKEN || !timingSafeEqual(header, env.INCOMING_FORWARD_TOKEN)) {
    return json({ ok: false, reason: "unauthorized" }, 401);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, reason: "invalid_json" }, 400);
  }
  const saved = await saveIncoming(env, { ...body, provider: "email_routing" });
  return json(saved, saved.ok ? 200 : 400);
}
__name(incomingForward, "incomingForward");
var PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'";
var index_default = {
  async fetch(request, env) {
    const canonical = canonicalUrl(request);
    if (canonical) return redirect(canonical.toString(), 308);
    const url = new URL(request.url);
    const storeBilling = await handleStoreBillingRequest(request, env);
    if (storeBilling) return storeBilling;
    const oauth = await handleOAuthRoute(request, env, publicOrigin(request));
    if (oauth) return oauth;
    if (url.pathname === "/oauth/google/start" && request.method === "GET") return googleStart(request, env);
    if (url.pathname === "/oauth/google/callback" && request.method === "GET") return googleCallback(request, env);
    if (url.pathname === "/auth/ms/start" && request.method === "GET") return msStart(request, env);
    if (url.pathname === "/auth/ms/callback" && request.method === "GET") return msCallback(request, env);
    if (url.pathname === "/auth/mail-app/issue" && request.method === "GET") return issueMailSetup(request, env);
    if (url.pathname === "/auth/mail-app/setup" && (request.method === "GET" || request.method === "POST")) return mailSetup(request, env);
    if (url.pathname === "/incoming/forward" && request.method === "POST") return incomingForward(request, env);
    if (url.pathname === "/mcp") return mcpEntry(request, env);
    if (url.pathname === "/price/" && request.method === "GET") {
      return new Response(pricePage(url.searchParams.get("notice") || ""), { headers: htmlHeaders() });
    }
    if (url.pathname === "/preview/reply-form/" && request.method === "GET") {
      return new Response(WIDGET_HTML, {
        headers: htmlHeaders({
          "x-robots-tag": "noindex",
          "content-security-policy": PREVIEW_CSP
        })
      });
    }
    if ((url.pathname === "/billing/trial" || url.pathname === "/billing/checkout") && request.method === "POST") {
      return billingPost(request, env, url.pathname);
    }
    if (url.pathname === "/billing/webhook" && request.method === "POST") return webhook(request, env);
    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });
    if (url.pathname === "/health" && request.method === "GET") {
      return new Response("ok", { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    }
    if (url.pathname === "/" && request.method === "GET") return redirect(`${publicOrigin(request)}/price/`, 308);
    return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
  async email(message, env) {
    try {
      await handleIncomingEmail(message, env);
    } catch (error) {
      console.error("email", error && error.message);
    }
  },
  async scheduled(_event, env, ctx) {
    const pending = pollAnsweredThreads(env).catch(() => {
    });
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(pending);
    else await pending;
  }
};
export {
  index_default as default
};
