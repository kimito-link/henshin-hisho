/** ストアの appAccountToken。メールアドレスそのものは入れない。同じアドレスなら同じ UUID になる。 */
const NAMESPACE = '6ba7b8119dad11d180b400c04fd430c8';

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export async function accountTokenForEmail(email) {
  const name = new TextEncoder().encode(String(email || '').trim().toLowerCase());
  const ns = hexToBytes(NAMESPACE);
  const data = new Uint8Array(ns.length + name.length);
  data.set(ns, 0);
  data.set(name, ns.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', data)).slice(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
