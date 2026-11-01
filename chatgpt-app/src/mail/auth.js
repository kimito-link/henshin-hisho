/** SMTP AUTH PLAIN と XOAUTH2 の初期応答。トークンそのものはここでは作らない。 */

function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function plainInitial(username, password) {
  return base64(`\u0000${username}\u0000${password}`);
}

/** xoauth2 = user=${u}\x01auth=Bearer ${t}\x01\x01 */
export function xoauth2Initial(username, token) {
  return base64(`user=${username}\u0001auth=Bearer ${token}\u0001\u0001`);
}

export function imapQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
