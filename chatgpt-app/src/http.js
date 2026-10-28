export function timingSafeEqual(a, b) {
  const bufA = new TextEncoder().encode(String(a || ''));
  const bufB = new TextEncoder().encode(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i += 1) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

export function clip(value, max) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

export function normalizeEmail(value) {
  const email = clip(value, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

export function validDeskId(value) {
  const id = clip(value, 80);
  return /^[A-Za-z0-9_-]{8,80}$/.test(id) ? id : '';
}

const SLASH_PATHS = new Set(['/price', '/preview/reply-form']);

function isLocalHost(host) {
  return host.startsWith('localhost') || host.startsWith('127.0.0.1');
}

/** www を外し、公開ホストの http は https へ、料金とプレビューは末尾スラッシュへ揃える。 */
export function canonicalUrl(request) {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost) url.host = forwardedHost.split(',')[0].trim();
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto) url.protocol = `${forwardedProto.split(',')[0].trim()}:`;

  let host = url.host;
  const local = isLocalHost(host);
  let changed = false;
  if (host.toLowerCase().startsWith('www.')) {
    host = host.slice(4);
    changed = true;
  }
  if (!local && url.protocol === 'http:') changed = true;
  if (SLASH_PATHS.has(url.pathname)) {
    url.pathname = `${url.pathname}/`;
    changed = true;
  }
  if (!changed) return null;
  url.protocol = local ? url.protocol : 'https:';
  url.host = host;
  return url;
}

export function publicOrigin(request) {
  const redirected = canonicalUrl(request);
  if (redirected) return redirected.origin;
  const url = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost) url.host = forwardedHost.split(',')[0].trim();
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto) url.protocol = `${forwardedProto.split(',')[0].trim()}:`;
  if (!isLocalHost(url.host)) url.protocol = 'https:';
  return url.origin;
}

export function htmlHeaders(extra = {}) {
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'content-security-policy':
      "default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'self'; frame-ancestors 'none'",
    ...extra
  };
}

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extra
    }
  });
}

export async function readForm(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    try {
      return await request.json();
    } catch {
      return null;
    }
  }
  const text = await request.text();
  return Object.fromEntries(new URLSearchParams(text));
}

export function sameSitePost(request) {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site') return false;
  const origin = request.headers.get('origin');
  // Chrome は Referrer-Policy によっては Origin に文字列 "null" を付ける。
  // その場合も Sec-Fetch-Site が cross-site でなければ同一サイトの送信として扱う。
  if (!origin || origin === 'null') return true;
  try {
    const originHost = new URL(origin).host.replace(/^www\./i, '');
    const requestHost = new URL(request.url).host.replace(/^www\./i, '');
    return originHost === requestHost;
  } catch {
    return false;
  }
}

export function mcpCorsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, mcp-session-id, authorization',
    'access-control-expose-headers': 'mcp-session-id'
  };
}
