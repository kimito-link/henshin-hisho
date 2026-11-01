/**
 * Google Play の購読確認に使うアクセストークン。
 * サービスアカウントの PKCS#8 秘密鍵で RS256 の JWT を作り、OAuth のトークンエンドポイントと交換する。
 * 秘密鍵の値は引数で受け取り、このファイルには置かない。
 */
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function textToBase64Url(text) {
  return bytesToBase64Url(new TextEncoder().encode(text));
}

function pemToDer(pem) {
  const b64 = String(pem)
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function mintPlayAccessToken(saJson, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  let sa = saJson;
  if (typeof saJson === 'string') {
    try {
      sa = JSON.parse(saJson);
    } catch {
      return '';
    }
  }
  if (!sa?.client_email || !sa?.private_key) return '';
  const header = textToBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const now = Math.floor(nowMs / 1000);
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
      'pkcs8',
      pemToDer(sa.private_key),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
  } catch {
    return '';
  }
  const signature = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput))
  );
  const assertion = `${signingInput}.${bytesToBase64Url(signature)}`;
  let response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      })
    });
  } catch {
    return '';
  }
  if (!response?.ok) return '';
  const payload = await response.json().catch(() => null);
  return payload?.access_token || '';
}

export async function playAccessTokenFromEnv(env) {
  if (env.PLAY_ACCESS_TOKEN) return env.PLAY_ACCESS_TOKEN;
  if (!env.GOOGLE_PLAY_SA_JSON) return '';
  return mintPlayAccessToken(env.GOOGLE_PLAY_SA_JSON, {
    fetchImpl: env.PLAY_TOKEN_FETCH || fetch
  });
}
