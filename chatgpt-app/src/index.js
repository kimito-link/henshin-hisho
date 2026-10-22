/**
 * ChatGPTアプリ（MCP Apps）の Worker。
 * 接続URLは https://<ホスト>/mcp 。料金ページは /price/ 。
 * シークレット: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID, MCP_ACCESS_TOKEN（任意）。
 * KV バインディング: CHATGPT_KV。
 */
import { applyStripeEvent, createCheckoutSession, startTrial, verifyStripeSignature } from './billing.js';
import { canonicalUrl, htmlHeaders, json, mcpCorsHeaders, publicOrigin, readForm, sameSitePost, timingSafeEqual } from './http.js';
import { exchangeGoogleCode } from './gmail.js';
import { saveIncoming } from './incoming.js';
import { buildGoogleAuthUrl, handleMcpRequest } from './mcp.js';
import { accessTokenRecord, handleOAuthRoute, wwwAuthenticate } from './mcp-oauth.js';
import { noticeText, pricePage } from './pages.js';
import { WIDGET_HTML } from './widget.js';

function redirect(location, status = 308) {
  return new Response(null, {
    status,
    headers: { location, 'cache-control': 'no-store' }
  });
}

function noticeRedirect(request, key) {
  const safe = noticeText(key) ? key : 'invalid_email';
  return redirect(`${publicOrigin(request)}/price/?notice=${encodeURIComponent(safe)}`, 303);
}

async function billingPost(request, env, pathname) {
  if (!sameSitePost(request)) return noticeRedirect(request, 'forbidden');
  const form = await readForm(request);
  if (!form) return noticeRedirect(request, 'invalid_email');
  if (pathname === '/billing/trial') {
    const started = await startTrial(env, form.email);
    if (started.ok) return noticeRedirect(request, 'trial_started');
    return noticeRedirect(request, started.reason || 'invalid_email');
  }
  const session = await createCheckoutSession(env, { email: form.email, origin: publicOrigin(request) });
  if (!session.ok) {
    return noticeRedirect(request, session.reason === 'invalid_email' ? 'invalid_email' : 'checkout_pending');
  }
  return redirect(session.url, 303);
}

async function webhook(request, env) {
  const payload = await request.text();
  const valid = await verifyStripeSignature(payload, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return json({ ok: false, reason: 'invalid_signature' }, 400);
  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ ok: false, reason: 'invalid_json' }, 400);
  }
  const result = await applyStripeEvent(env, event);
  return json({ ok: result.ok, ignored: Boolean(result.ignored), reason: result.reason || '' }, result.ok ? 200 : 400);
}

function unauthorized(request) {
  return json({ error: 'unauthorized' }, 401, {
    'www-authenticate': wwwAuthenticate(publicOrigin(request)),
    ...mcpCorsHeaders()
  });
}

async function bearerAllowed(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (env.MCP_ACCESS_TOKEN && timingSafeEqual(token, env.MCP_ACCESS_TOKEN)) return true;
  return Boolean(await accessTokenRecord(env, token));
}

async function mcpEntry(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: mcpCorsHeaders() });
  if (request.method === 'DELETE') return new Response(null, { status: 204, headers: mcpCorsHeaders() });
  if (request.method !== 'POST') {
    return new Response('method not allowed', {
      status: 405,
      headers: { allow: 'POST, DELETE, OPTIONS', ...mcpCorsHeaders() }
    });
  }
  const required = Boolean(env.MCP_ACCESS_TOKEN) || env.MCP_AUTH_REQUIRED === '1';
  if (required && !(await bearerAllowed(request, env))) return unauthorized(request);
  return handleMcpRequest(request, env);
}

async function googleStart(request, env) {
  const url = new URL(request.url);
  const adminKey = url.searchParams.get('key') || '';
  if (!env.OAUTH_ADMIN_KEY || !timingSafeEqual(adminKey, env.OAUTH_ADMIN_KEY) || !env.CHATGPT_KV) {
    return new Response('forbidden', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const state = crypto.randomUUID();
  await env.CHATGPT_KV.put(`google-state:${state}`, '1', { expirationTtl: 600 });
  return Response.redirect(buildGoogleAuthUrl(env, state), 302);
}

async function googleCallback(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const stateOk = state && env.CHATGPT_KV && (await env.CHATGPT_KV.get(`google-state:${state}`));
  if (!stateOk || !code) {
    return new Response('無効なリクエストです。もう一度接続を開始してください。', {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
  }
  await env.CHATGPT_KV.delete(`google-state:${state}`);
  const saved = await exchangeGoogleCode(env, code, env.GMAIL_FETCH || fetch);
  const text = saved.ok
    ? `Gmail（${saved.email}）を接続しました。このタブは閉じてください。`
    : 'Gmail の接続に失敗しました。送信はしていません。';
  return new Response(text, { status: saved.ok ? 200 : 400, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

async function incomingForward(request, env) {
  const header = request.headers.get('x-incoming-token') || '';
  if (!env.INCOMING_FORWARD_TOKEN || !timingSafeEqual(header, env.INCOMING_FORWARD_TOKEN)) {
    return json({ ok: false, reason: 'unauthorized' }, 401);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, reason: 'invalid_json' }, 400);
  }
  const saved = await saveIncoming(env, { ...body, provider: 'email_routing' });
  return json(saved, saved.ok ? 200 : 400);
}

const PREVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'";

export default {
  async fetch(request, env) {
    const canonical = canonicalUrl(request);
    if (canonical) return redirect(canonical.toString(), 308);

    const url = new URL(request.url);
    const oauth = await handleOAuthRoute(request, env, publicOrigin(request));
    if (oauth) return oauth;
    if (url.pathname === '/oauth/google/start' && request.method === 'GET') return googleStart(request, env);
    if (url.pathname === '/oauth/google/callback' && request.method === 'GET') return googleCallback(request, env);
    if (url.pathname === '/incoming/forward' && request.method === 'POST') return incomingForward(request, env);
    if (url.pathname === '/mcp') return mcpEntry(request, env);
    if (url.pathname === '/price/' && request.method === 'GET') {
      return new Response(pricePage(url.searchParams.get('notice') || ''), { headers: htmlHeaders() });
    }
    if (url.pathname === '/preview/reply-form/' && request.method === 'GET') {
      return new Response(WIDGET_HTML, {
        headers: htmlHeaders({
          'x-robots-tag': 'noindex',
          'content-security-policy': PREVIEW_CSP
        })
      });
    }
    if ((url.pathname === '/billing/trial' || url.pathname === '/billing/checkout') && request.method === 'POST') {
      return billingPost(request, env, url.pathname);
    }
    if (url.pathname === '/billing/webhook' && request.method === 'POST') return webhook(request, env);
    if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
    if (url.pathname === '/health' && request.method === 'GET') {
      return new Response('ok', { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    }
    if (url.pathname === '/' && request.method === 'GET') return redirect(`${publicOrigin(request)}/price/`, 308);
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
};
