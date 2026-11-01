import { encryptSecret } from './crypto.js';
import { putLink } from './links.js';
import { providerOf } from './providers.js';

const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
export const MS_SCOPES = 'offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send';

export function msOauthEnabled(env) {
  return env.MS_OAUTH_ENABLED === '1' && Boolean(env.MS_CLIENT_ID) && Boolean(env.MS_CLIENT_SECRET);
}

export function msRedirectUri(env) {
  const base = String(env.WORKER_PUBLIC_URL || 'https://reply.kimitotalk.link').replace(/\/$/, '');
  return `${base}/auth/ms/callback`;
}

export function buildMicrosoftAuthUrl(env, state, loginHint) {
  const params = new URLSearchParams({
    client_id: env.MS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: msRedirectUri(env),
    response_mode: 'query',
    scope: MS_SCOPES,
    prompt: 'select_account',
    state
  });
  if (loginHint) params.set('login_hint', loginHint);
  return `${AUTH_URL}?${params.toString()}`;
}

async function tokenRequest(env, body, fetchImpl) {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) return { ok: false, reason: 'ms_token_failed' };
  return { ok: true, json };
}

function emailFromIdToken(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length < 2) return '';
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(padded));
    return String(json.email || json.preferred_username || '').toLowerCase();
  } catch {
    return '';
  }
}

export async function exchangeMicrosoftCode(env, code, loginHint, fetchImpl = fetch) {
  if (!msOauthEnabled(env) || !env.CHATGPT_KV) return { ok: false, reason: 'ms_not_configured' };
  const token = await tokenRequest(
    env,
    {
      client_id: env.MS_CLIENT_ID,
      client_secret: env.MS_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: msRedirectUri(env),
      scope: MS_SCOPES
    },
    fetchImpl
  );
  if (!token.ok || !token.json.refresh_token) return { ok: false, reason: 'ms_code_rejected' };
  const email = emailFromIdToken(token.json.id_token) || String(loginHint || '').toLowerCase();
  if (!email.includes('@')) return { ok: false, reason: 'ms_profile_failed' };
  const packed = await encryptSecret(env.MAIL_TOKEN_ENCRYPTION_KEY, `msrt:${token.json.refresh_token}`);
  if (!packed.ok) return packed;
  const saved = await putLink(env, {
    kind: 'operator',
    address: email,
    provider: providerOf(email) === 'microsoft' ? 'microsoft' : 'microsoft',
    owner: email,
    password_enc: packed.packed,
    status: 'active',
    verified_at: Date.now(),
    setup_code_hash: '',
    setup_expires_at: 0,
    attempts: 0
  });
  return saved.ok ? { ok: true, email } : saved;
}

export async function microsoftAccessToken(env, refreshToken, fetchImpl = fetch) {
  if (!msOauthEnabled(env)) return { ok: false, reason: 'ms_not_configured' };
  const token = await tokenRequest(
    env,
    {
      client_id: env.MS_CLIENT_ID,
      client_secret: env.MS_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: MS_SCOPES
    },
    fetchImpl
  );
  if (!token.ok) return token;
  return { ok: true, accessToken: token.json.access_token };
}
