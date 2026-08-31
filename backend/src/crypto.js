const PBKDF2_ITERATIONS = 100000;
const PBKDF2_HASH_BYTES = 32;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function bytesToBase64Url(bytes) {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function pbkdf2(password, saltBytes) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(password || '')),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS
    },
    key,
    PBKDF2_HASH_BYTES * 8
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`;
}

export async function verifyPassword(password, passwordHash) {
  const [scheme, iterations, salt, expected] = String(passwordHash || '').split('$');
  if (scheme !== 'pbkdf2' || Number(iterations) !== PBKDF2_ITERATIONS || !salt || !expected) return false;
  const actual = await pbkdf2(password, base64UrlToBytes(salt));
  return timingSafeEqual(actual, base64UrlToBytes(expected));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function requireSessionSecret(env) {
  const secret = String(env.SESSION_SECRET || '').trim();
  if (!secret) throw new Error('session_secret_not_configured');
  return secret;
}

export async function createSignedSessionToken(env, userId, options = {}) {
  const secret = requireSessionSecret(env);
  const header = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const issuedAt = options.now ?? nowSeconds();
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({
    sub: userId,
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS,
    nonce: bytesToBase64Url(randomBytes(12))
  })));
  const signingInput = `${header}.${payload}`;
  const signature = bytesToBase64Url(await hmac(secret, signingInput));
  return `${signingInput}.${signature}`;
}

export async function verifySignedSessionToken(env, token) {
  const secret = requireSessionSecret(env);
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const signingInput = `${parts[0]}.${parts[1]}`;
  const expected = await hmac(secret, signingInput);
  if (!timingSafeEqual(expected, base64UrlToBytes(parts[2]))) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));
    if (!payload.sub || Number(payload.exp || 0) < nowSeconds()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createOpaqueToken(prefix = 'tok') {
  return `${prefix}_${bytesToBase64Url(randomBytes(24))}`;
}

export function sessionTtlSeconds() {
  return SESSION_TTL_SECONDS;
}
