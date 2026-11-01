import { normalizeEmail, timingSafeEqual } from './http.js';

const SCOPE = 'replies';
const CODE_TTL = 300;
const ACCESS_TTL = 3600;

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }
  });
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

export function protectedResourceMetadata(origin) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header']
  };
}

export function authorizationServerMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: [SCOPE]
  };
}

export function wwwAuthenticate(origin) {
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="${SCOPE}"`;
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

export async function accessTokenRecord(env, token) {
  if (!token) return null;
  return readJson(env, `oauth-access:${token}`);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function formPage(params, error = '') {
  const hidden = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method']
    .map((name) => `<input type="hidden" name="${name}" value="${escapeHtml(params.get(name) || '')}">`)
    .join('');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>接続の許可</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,sans-serif;margin:24px;line-height:1.5}button{font-size:16px;padding:10px 14px}</style>
</head><body><h1>返信秘書への接続</h1><p>この画面を許可すると、クライアントは作成カードを呼べます。メールの送信は、カードの「送信」を押したときだけです。</p>
${error ? `<p>${escapeHtml(error)}</p>` : ''}
<form method="post">${hidden}<label>アカウントのメールアドレス<input name="email" type="email" autocomplete="email"></label><label>接続キー<input name="key" type="password" required></label><button type="submit">許可する</button></form></body></html>`;
}

function redirectAllowed(uri) {
  try {
    const url = new URL(uri);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

async function register(request, env) {
  if (!env.CHATGPT_KV) return json({ error: 'storage_not_configured' }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const redirects = Array.isArray(body?.redirect_uris) ? body.redirect_uris.filter(redirectAllowed) : [];
  if (redirects.length === 0) return json({ error: 'invalid_redirect_uri' }, 400);
  const clientId = crypto.randomUUID();
  await env.CHATGPT_KV.put(
    `oauth-client:${clientId}`,
    JSON.stringify({ clientId, redirectUris: redirects, name: String(body.client_name || '').slice(0, 80) })
  );
  return json({ client_id: clientId, redirect_uris: redirects, token_endpoint_auth_method: 'none' }, 201);
}

async function authorize(request, env) {
  const url = new URL(request.url);
  if (!env.CHATGPT_KV || !env.MCP_OAUTH_CONSENT_KEY) {
    return new Response('OAuthの同意キーが未設定です。', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const params = request.method === 'POST' ? new URLSearchParams(await request.text()) : url.searchParams;
  const clientId = params.get('client_id') || url.searchParams.get('client_id') || '';
  const redirectUri = params.get('redirect_uri') || url.searchParams.get('redirect_uri') || '';
  const state = params.get('state') || url.searchParams.get('state') || '';
  const challenge = params.get('code_challenge') || url.searchParams.get('code_challenge') || '';
  const method = params.get('code_challenge_method') || url.searchParams.get('code_challenge_method') || '';
  const client = await readJson(env, `oauth-client:${clientId}`);
  if (!client || !client.redirectUris?.includes(redirectUri) || method !== 'S256' || !challenge) {
    return json({ error: 'invalid_client' }, 400);
  }
  if (request.method === 'GET') {
    return new Response(formPage(url.searchParams), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (!timingSafeEqual(params.get('key') || '', env.MCP_OAUTH_CONSENT_KEY)) {
    return new Response(formPage(params, '接続キーが違います。'), {
      status: 401,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
  const accountEmail = normalizeEmail(params.get('email') || '');
  if (params.get('email') && !accountEmail) {
    return new Response(formPage(params, 'メールアドレスの形式を確認してください。'), {
      status: 400,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
  const code = crypto.randomUUID();
  await env.CHATGPT_KV.put(
    `oauth-code:${code}`,
    JSON.stringify({ clientId, redirectUri, challenge, state, accountEmail }),
    { expirationTtl: CODE_TTL }
  );
  const back = new URL(redirectUri);
  back.searchParams.set('code', code);
  if (state) back.searchParams.set('state', state);
  return Response.redirect(back.toString(), 302);
}

async function token(request, env) {
  if (!env.CHATGPT_KV) return json({ error: 'storage_not_configured' }, 503);
  const body = new URLSearchParams(await request.text());
  const grant = body.get('grant_type');
  if (grant === 'refresh_token') {
    const record = await readJson(env, `oauth-refresh:${body.get('refresh_token') || ''}`);
    if (!record) return json({ error: 'invalid_grant' }, 400);
    return issue(env, record.clientId, record.accountEmail || '');
  }
  if (grant !== 'authorization_code') return json({ error: 'unsupported_grant_type' }, 400);
  const code = body.get('code') || '';
  const record = await readJson(env, `oauth-code:${code}`);
  await env.CHATGPT_KV.delete(`oauth-code:${code}`);
  if (!record || record.clientId !== body.get('client_id') || record.redirectUri !== body.get('redirect_uri')) {
    return json({ error: 'invalid_grant' }, 400);
  }
  const hashed = await sha256(body.get('code_verifier') || '');
  if (!timingSafeEqual(hashed, record.challenge)) return json({ error: 'invalid_grant' }, 400);
  return issue(env, record.clientId, record.accountEmail || '');
}

async function issue(env, clientId, accountEmail = '') {
  const access = crypto.randomUUID();
  const refresh = crypto.randomUUID();
  const identity = accountEmail ? { accountEmail } : {};
  await env.CHATGPT_KV.put(
    `oauth-access:${access}`,
    JSON.stringify({ clientId, scope: SCOPE, ...identity }),
    { expirationTtl: ACCESS_TTL }
  );
  await env.CHATGPT_KV.put(`oauth-refresh:${refresh}`, JSON.stringify({ clientId, ...identity }));
  return json({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope: SCOPE });
}

export async function handleOAuthRoute(request, env, origin) {
  const url = new URL(request.url);
  if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') {
    return json(protectedResourceMetadata(origin));
  }
  if (url.pathname === '/.well-known/oauth-authorization-server') return json(authorizationServerMetadata(origin));
  if (url.pathname === '/oauth/register' && request.method === 'POST') return register(request, env);
  if (url.pathname === '/oauth/authorize' && (request.method === 'GET' || request.method === 'POST')) return authorize(request, env);
  if (url.pathname === '/oauth/token' && request.method === 'POST') return token(request, env);
  return null;
}
