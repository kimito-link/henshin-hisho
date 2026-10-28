/**
 * IMAP。秘密が oauth2: で始まるときは AUTHENTICATE XOAUTH2、そうでなければ LOGIN。
 * sentMailbox() は LIST の \Sent を使い、無ければ Sent。append() は送信済みへ APPEND する。
 * ポーリングはヘッダだけを見る。
 */

import { imapQuote, xoauth2Initial } from './auth.js';

async function command(transport, tag, line) {
  await transport.write(`${tag} ${line}`);
  return transport.readResponse(tag);
}

export async function imapLogin(transport, { username, secret }) {
  const greeting = await transport.readResponse('*');
  if (greeting && greeting.ok === false) return { ok: false, auth: false, error: 'greeting' };
  const secretText = String(secret || '');
  const response = secretText.startsWith('oauth2:')
    ? await command(transport, 'A1', `AUTHENTICATE XOAUTH2 ${xoauth2Initial(username, secretText.slice('oauth2:'.length))}`)
    : await command(transport, 'A1', `LOGIN ${imapQuote(username)} ${imapQuote(secretText)}`);
  if (!response?.ok) return { ok: false, auth: true, error: (response?.lines || []).join(' ') || 'auth' };
  return { ok: true };
}

export function sentMailbox(listResponse, fallback = 'Sent') {
  const lines = listResponse?.lines || [];
  for (const line of lines) {
    if (!/\\Sent\b/i.test(line)) continue;
    const quoted = line.match(/"((?:\\.|[^"\\])*)"\s*$/);
    if (quoted) return quoted[1].replace(/\\"/g, '"');
    const bare = line.match(/\s(\S+)\s*$/);
    if (bare) return bare[1];
  }
  return fallback || 'Sent';
}

export async function imapList(transport) {
  return command(transport, 'A2', 'LIST "" "*"');
}

export async function imapSelect(transport, mailbox) {
  return command(transport, 'A5', `SELECT ${imapQuote(mailbox)}`);
}

export async function imapAppend(transport, mailbox, message) {
  const bytes = new TextEncoder().encode(message).length;
  await transport.write(`A3 APPEND ${imapQuote(mailbox)} (\\Seen) {${bytes}}`);
  const continued = await transport.readResponse('A3');
  if (!continued?.continuation && !continued?.ok) return { ok: false, error: 'append rejected' };
  if (continued?.continuation) {
    await transport.writeRaw(`${message}\r\n`);
    const done = await transport.readResponse('A3');
    if (!done?.ok) return { ok: false, error: 'append failed' };
  }
  return { ok: true };
}

/** ヘッダだけ。BODY.PEEK なので既読にはしない。 */
export async function imapFetchHeaders(transport) {
  const response = await command(transport, 'A4', 'UID FETCH 1:* (BODY.PEEK[HEADER.FIELDS (MESSAGE-ID IN-REPLY-TO)])');
  return (response?.lines || []).join('\n');
}
