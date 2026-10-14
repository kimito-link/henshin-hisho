/**
 * oauth.js — Google OAuth 2.0（Gmail読み取り専用）の認可・トークン管理。
 *
 * 設計: 初回のみ人間がブラウザで /oauth/start を開いて同意する（Refresh Tokenを取得）。
 * 以降は Refresh Token を KV に保存し、Access Token はメモリ内(Workerインスタンス寿命)キャッシュのみ。
 * gmail.readonly スコープのみ要求する（既存henshin-hisho backendの gmail.js スタブとは無関係の
 * 別プロジェクトなので、ここで独自にOAuthを完結させる）。
 */

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REFRESH_TOKEN_KEY = 'gmail_refresh_token';
const FETCH_TIMEOUT_MS = 8000;

function redirectUri(request, env) {
  if (env.OAUTH_REDIRECT_URI) return env.OAUTH_REDIRECT_URI;
  const url = new URL(request.url);
  return `${url.origin}/oauth/callback`;
}

export function buildAuthUrl(request, env, state) {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(request, env),
    response_type: 'code',
    scope: GMAIL_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

export async function exchangeCodeForTokens(request, env, code) {
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(request, env)
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${JSON.stringify(json)}`);
  return json; // { access_token, refresh_token, expires_in, ... }
}

export async function saveRefreshToken(env, refreshToken) {
  await env.MCP_KV.put(REFRESH_TOKEN_KEY, refreshToken);
}

/**
 * 連携しようとしているGmailアカウントが期待するものと一致するか確認する。
 * env.ALLOWED_GMAIL が設定されていない場合は検証をスキップする（後方互換）。
 * 【なぜ必要か】/oauth/start に第三者がアクセスすると、その人のGoogleアカウントで
 * 同意すれば REFRESH_TOKEN_KEY が上書きされ、自分のGmail連携が乗っ取られる。
 * これは同意完了後にしか分からない（誰がログインしたかは同意画面の中身なので）ため、
 * トークン交換の直後・保存の直前でこのチェックを挟む。
 */
export async function verifyAccountEmail(env, accessToken) {
  if (!env.ALLOWED_GMAIL) return true;
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res.ok) return false;
  const json = await res.json();
  return String(json.email || '').toLowerCase() === env.ALLOWED_GMAIL.toLowerCase();
}

export async function hasRefreshToken(env) {
  const token = await env.MCP_KV.get(REFRESH_TOKEN_KEY);
  return !!token;
}

/**
 * Access Tokenを取得する。Worker実行ごとに毎回リフレッシュする
 * （Cloudflare Workersはリクエスト間でメモリを保持しない前提のため、
 *  短命キャッシュの複雑さより「毎回リフレッシュ」を選ぶ。gmail.readonlyの
 *  トークン発行はレート制限に引っかかるほどの頻度にならない想定）。
 */
export async function getAccessToken(env) {
  const refreshToken = await env.MCP_KV.get(REFRESH_TOKEN_KEY);
  if (!refreshToken) {
    const err = new Error('not_connected');
    err.code = 'not_connected';
    throw err;
  }
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  const json = await res.json();
  if (!res.ok) {
    // invalid_grant は「refresh tokenが失効した」を意味することが多い
    // （OAuth同意画面がテスト状態だと7日で自動失効する。/oauth/start での再連携が必要）。
    const isInvalidGrant = json?.error === 'invalid_grant';
    const err = new Error(
      isInvalidGrant
        ? 'Gmail連携が失効しています。管理者に /oauth/start?key=... からの再連携を依頼してください。'
        : `refresh failed: ${res.status} ${JSON.stringify(json)}`
    );
    err.code = 'refresh_failed';
    throw err;
  }
  return json.access_token;
}
