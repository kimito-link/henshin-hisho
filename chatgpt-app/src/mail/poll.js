import { imapFetchHeaders, imapList, imapLogin, imapSelect, sentMailbox } from './imap.js';
import { listLinks, putLink } from './links.js';
import { decryptSecret } from './crypto.js';
import { microsoftAccessToken } from './microsoft.js';
import { sendPath, serversFor } from './providers.js';
import { openSmtpTransport } from './smtp.js';
import { markAnsweredFromHeaders } from './threads.js';

async function secretOf(env, link) {
  const decrypted = await decryptSecret(env.MAIL_TOKEN_ENCRYPTION_KEY, link.password_enc);
  if (!decrypted.ok) return '';
  if (decrypted.plain.startsWith('msrt:')) {
    const access = await microsoftAccessToken(env, decrypted.plain.slice('msrt:'.length), env.MAIL_FETCH || fetch);
    return access.ok ? `oauth2:${access.accessToken}` : '';
  }
  return decrypted.plain;
}

async function headersViaImap(env, link) {
  const servers = serversFor(link.provider, link.servers_json);
  if (!servers.ok) return '';
  const secret = await secretOf(env, link);
  if (!secret) return '';
  const username = servers.login || link.address;
  const open = env.MAIL_CONNECT || ((target) => openSmtpTransport(target.host, target.port, target.secureTransport));
  const transport = await open({ host: servers.imap.host, port: servers.imap.port, secureTransport: 'on' });
  const login = await imapLogin(transport, { username, secret });
  if (!login.ok) return '';
  const list = await imapList(transport);
  const mailbox = sentMailbox(list, servers.sentMailbox || 'Sent');
  await imapSelect(transport, mailbox);
  return imapFetchHeaders(transport);
}

/** 送信済みメールのヘッダだけを見て、元スレッドを返信済みにする。失敗しても投げない。 */
export async function pollAnsweredThreads(env, deps = {}) {
  const links = (await listLinks(env)).filter((link) => link.status === 'active' && sendPath(link.provider, env) === 'password');
  for (const link of links) {
    try {
      const headers = deps.headersFor ? await deps.headersFor(link) : await headersViaImap(env, link);
      const marked = await markAnsweredFromHeaders(env, headers);
      await putLink(env, { ...link, last_poll_at: Date.now(), last_result: marked.marked ? 'answered' : 'polled' });
    } catch {
      await putLink(env, { ...link, last_poll_at: Date.now(), last_result: 'poll_failed' });
    }
  }
}
