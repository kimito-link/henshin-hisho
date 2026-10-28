/** MAIL_TOKEN_ENCRYPTION_KEY は 64 桁の hex。形式は v1:<iv hex>:<cipher hex>（AES-256-GCM、タグは暗号文の末尾）。 */

function parseHex(hex) {
  const text = String(hex || '').trim();
  if (!/^[0-9a-fA-F]+$/.test(text) || text.length % 2) return null;
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function hexToBytes(hex) {
  const bytes = parseHex(hex);
  if (!bytes || bytes.length !== 32) return null;
  return bytes;
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function importKey(keyHex) {
  const raw = hexToBytes(keyHex);
  if (!raw) return null;
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(keyHex, plaintext) {
  const key = await importKey(keyHex);
  if (!key) return { ok: false, reason: 'mail_key_missing' };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(String(plaintext)));
  return { ok: true, packed: `v1:${bytesToHex(iv)}:${bytesToHex(new Uint8Array(cipher))}` };
}

export async function decryptSecret(keyHex, packed) {
  const key = await importKey(keyHex);
  const parts = String(packed || '').split(':');
  if (!key || parts.length !== 3 || parts[0] !== 'v1') return { ok: false, reason: 'mail_key_missing' };
  const iv = parseHex(parts[1]);
  const cipher = parseHex(parts[2]);
  if (!iv || iv.length !== 12 || !cipher) return { ok: false, reason: 'mail_secret_corrupt' };
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return { ok: true, plain: new TextDecoder().decode(plain) };
  } catch {
    return { ok: false, reason: 'mail_secret_corrupt' };
  }
}
