import { timingSafeEqual } from './http.js';
import { WIRED_PROVIDERS } from './providers.js';

/** linebot の apps/worker/wrangler.toml と同じ公開クライアント。秘密は置かない。 */
export const LINEBOT_GOOGLE_CLIENT_ID = '899798982543-2jk3d2fp97c02js71opg7l1j9fa7oh5a.apps.googleusercontent.com';
export const LINEBOT_GOOGLE_PROJECT = 'kimito-talk-oauth';
export const LINEBOT_GOOGLE_REDIRECT = 'https://reply.kimitotalk.link/oauth/google/callback';

const GMAIL = WIRED_PROVIDERS.find((provider) => provider.id === 'gmail');
export const GMAIL_SCOPES = GMAIL.scopes;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

export function gmailScopeString() {
  return GMAIL_SCOPES.join(' ');
}

export function googleRedirectUri(env) {
  return env.GOOGLE_REDIRECT_URI || LINEBOT_GOOGLE_REDIRECT;
}

export function googleClientId(env) {
  return env.GOOGLE_CLIENT_ID || LINEBOT_GOOGLE_CLIENT_ID;
}

export function buildGoogleAuthUrl(env, state) {
  const params = new URLSearchParams({
    client_id: googleClientId(env),
    redirect_uri: googleRedirectUri(env),
    response_type: 'code',
    scope: gmailScopeString(),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state
  });
  return `${AUTH_URL}?${params.toString()}`;
}

function accountKey(email) {
  return `gmail-account:${email}`;
}

export async function readGmailAccount(env, email) {
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

export async function readPrimaryGmailAccount(env) {
  if (!env.CHATGPT_KV) return null;
  const raw = await env.CHATGPT_KV.get('gmail-primary');
  if (!raw) return null;
  return readGmailAccount(env, raw);
}

async function saveGmailAccount(env, account) {
  await env.CHATGPT_KV.put(accountKey(account.email), JSON.stringify(account));
  await env.CHATGPT_KV.put('gmail-primary', account.email);
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encodedHeader(value) {
  const bytes = new TextEncoder().encode(value);
  return `=?UTF-8?B?${base64Url(bytes)}?=`;
}

export function buildRawMessage({ from, to, cc, bcc, subject, body }) {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : '',
    bcc ? `Bcc: ${bcc}` : '',
    `Subject: ${encodedHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit'
  ].filter(Boolean);
  const raw = `${headers.join('\r\n')}\r\n\r\n${body || ''}`;
  return base64Url(new TextEncoder().encode(raw));
}

async function refreshAccessToken(env, refreshToken, fetchImpl) {
  if (!env.GOOGLE_CLIENT_SECRET) return { ok: false, reason: 'gmail_not_configured' };
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: googleClientId(env),
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) return { ok: false, reason: 'gmail_refresh_failed' };
  return { ok: true, accessToken: json.access_token };
}

export async function sendViaGmail(env, account, message, fetchImpl = fetch) {
  if (!account?.refreshToken) return { ok: false, reason: 'gmail_not_connected', sent: false };
  if (gmailScopeString().includes('gmail.readonly') || gmailScopeString().includes('gmail.compose')) {
    return { ok: false, reason: 'scope_refused', sent: false };
  }
  const token = await refreshAccessToken(env, account.refreshToken, fetchImpl);
  if (!token.ok) return { ok: false, reason: token.reason, sent: false };
  const response = await fetchImpl(SEND_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${token.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: buildRawMessage(message) })
  });
  if (!response.ok) return { ok: false, reason: 'gmail_send_failed', sent: false };
  const json = await response.json().catch(() => ({}));
  return { ok: true, sent: true, provider: 'gmail', messageId: json.id || '' };
}

export async function exchangeGoogleCode(env, code, fetchImpl = fetch) {
  if (!env.GOOGLE_CLIENT_SECRET || !env.CHATGPT_KV) return { ok: false, reason: 'gmail_not_configured' };
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: googleClientId(env),
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: googleRedirectUri(env)
    })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.refresh_token) return { ok: false, reason: 'gmail_code_rejected' };
  const profile = await fetchImpl(USERINFO_URL, { headers: { authorization: `Bearer ${json.access_token}` } });
  const user = await profile.json().catch(() => ({}));
  const email = String(user.email || '').toLowerCase();
  if (!profile.ok || !email) return { ok: false, reason: 'gmail_profile_failed' };
  if (env.ALLOWED_GMAIL && !timingSafeEqual(email, String(env.ALLOWED_GMAIL).toLowerCase())) {
    return { ok: false, reason: 'gmail_account_rejected' };
  }
  await saveGmailAccount(env, { email, refreshToken: json.refresh_token, provider: 'gmail' });
  return { ok: true, email };
}
