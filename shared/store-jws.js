import { APPLE_BUNDLE_ID, APPLE_ROOT_CA_G3_SHA256, planByAppleProduct } from './plans.js';

const CURVES = [
  { oid: [0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07], crv: 'P-256', size: 32 },
  { oid: [0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22], crv: 'P-384', size: 48 }
];

function bytesToB64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64UrlToBytes(value) {
  const padded = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function b64DerToBytes(value) {
  const binary = atob(String(value || '').replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function curveKeyFromCert(der, wanted) {
  const bytes = der instanceof Uint8Array ? der : new Uint8Array(der);
  for (const curve of CURVES) {
    if (wanted && curve.crv !== wanted) continue;
    for (let i = 0; i < bytes.length - curve.oid.length - curve.size * 2; i += 1) {
      let match = true;
      for (let j = 0; j < curve.oid.length; j += 1) {
        if (bytes[i + j] !== curve.oid[j]) match = false;
      }
      if (!match || bytes[i + curve.oid.length] !== 0x03) continue;
      const length = bytes[i + curve.oid.length + 1];
      const start = i + curve.oid.length + 2;
      if (length !== curve.size * 2 + 2 || bytes[start] !== 0x00 || bytes[start + 1] !== 0x04) continue;
      const point = start + 2;
      return {
        kty: 'EC',
        crv: curve.crv,
        x: bytesToB64Url(bytes.slice(point, point + curve.size)),
        y: bytesToB64Url(bytes.slice(point + curve.size, point + curve.size * 2))
      };
    }
  }
  return null;
}

export function p256JwkFromCert(der) {
  return curveKeyFromCert(der, 'P-256');
}

export function ecJwkFromCert(der) {
  return curveKeyFromCert(der, '');
}

async function importVerifyKey(publicJwk) {
  return crypto.subtle.importKey(
    'jwk',
    { ...publicJwk, key_ops: ['verify'], ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
}

export async function verifyEs256Jws(jws, publicJwk) {
  try {
    const parts = String(jws || '').split('.');
    if (parts.length !== 3 || !publicJwk || publicJwk.kty !== 'EC' || publicJwk.crv !== 'P-256') {
      return { ok: false, reason: 'bad_signature' };
    }
    const key = await importVerifyKey(publicJwk);
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = b64UrlToBytes(parts[2]);
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, data);
    if (!valid) return { ok: false, reason: 'bad_signature' };
    const payload = JSON.parse(new TextDecoder().decode(b64UrlToBytes(parts[1])));
    return { ok: true, payload, header: JSON.parse(new TextDecoder().decode(b64UrlToBytes(parts[0]))) };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
}

async function certSignedByIssuer(childDer, issuerDer) {
  const { X509Certificate } = await import('node:crypto');
  const child = new X509Certificate(childDer);
  const issuer = new X509Certificate(issuerDer);
  return child.verify(issuer.publicKey);
}

export async function verifyAppleJws(jws, options = {}) {
  if (options.publicJwk) return verifyEs256Jws(jws, options.publicJwk);
  const parts = String(jws || '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'bad_signature' };
  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(b64UrlToBytes(parts[0])));
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
  const chain = Array.isArray(header.x5c) ? header.x5c.map(b64DerToBytes) : [];
  if (chain.length === 0) return { ok: false, reason: 'bad_signature' };
  const rootHash = await sha256Hex(chain[chain.length - 1]);
  if (rootHash !== APPLE_ROOT_CA_G3_SHA256) return { ok: false, reason: 'bad_signature' };
  try {
    for (let i = 0; i < chain.length - 1; i += 1) {
      if (!(await certSignedByIssuer(chain[i], chain[i + 1]))) return { ok: false, reason: 'bad_signature' };
    }
    if (chain.length === 1 && !(await certSignedByIssuer(chain[0], chain[0]))) {
      return { ok: false, reason: 'bad_signature' };
    }
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
  const leaf = p256JwkFromCert(chain[0]);
  if (!leaf) return { ok: false, reason: 'bad_signature' };
  return verifyEs256Jws(jws, leaf);
}

export function assessAppleTransaction(claims = {}, nowMs = Date.now()) {
  const product = planByAppleProduct(claims.productId);
  if (!product) return { ok: false, reason: 'unknown_product' };
  if (claims.bundleId && claims.bundleId !== APPLE_BUNDLE_ID) return { ok: false, reason: 'bundle_mismatch' };
  const expiresMs = Number(claims.expiresDate || 0);
  const revoked = Boolean(claims.revocationDate);
  const active = !revoked && (!expiresMs || expiresMs > nowMs);
  return {
    ok: true,
    active,
    currentPeriodEnd: expiresMs ? Math.floor(expiresMs / 1000) : 0,
    productId: claims.productId,
    planId: product.id,
    originalTransactionId: String(claims.originalTransactionId || ''),
    accountToken: String(claims.appAccountToken || '')
  };
}

export function appleTrustFromEnv(env = {}) {
  if (!env.APPLE_IAP_TRUST_JWK) return null;
  try {
    const parsed = JSON.parse(env.APPLE_IAP_TRUST_JWK);
    return parsed && parsed.kty === 'EC' ? parsed : null;
  } catch {
    return null;
  }
}
