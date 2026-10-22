import { readGmailAccount, readPrimaryGmailAccount, sendViaGmail } from '../gmail.js';
import { normalizeEmail } from '../http.js';
import { decryptSecret } from './crypto.js';
import { imapAppend, imapList, imapLogin, sentMailbox } from './imap.js';
import { addSentId, listLinks, markLinkError } from './links.js';
import { buildRfc822, newMessageId, referenceHeader } from './message.js';
import { microsoftAccessToken } from './microsoft.js';
import { providerLabel, sendPath, serversFor } from './providers.js';
import { openSmtpTransport, smtpSession } from './smtp.js';
import { addressList, threadRecipients } from './threads.js';

export function senderFields(sender, origin = '') {
  if (!sender?.linked) {
    return {
      from: '',
      provider: '',
      providerLabel: '',
      linked: false,
      connectUrl: sender?.connectUrl || `${origin}/auth/mail-app/setup`,
      transport: ''
    };
  }
  return {
    from: sender.address,
    provider: sender.provider,
    providerLabel: sender.label,
    linked: true,
    connectUrl: '',
    transport: sender.transport
  };
}

export async function resolveReplySender(env, { thread, origin = '' } = {}) {
  const owner = thread?.owner || '';
  const links = (await listLinks(env, owner)).filter((link) => link.status === 'active' && sendPath(link.provider, env) === 'password');
  const header = new Set(addressList(`${thread?.to_address || ''} ${thread?.cc_address || ''}`).split(', ').filter(Boolean));
  const matched = links.find((link) => header.has(link.address));
  const chosen = matched || (links.length === 1 ? links[0] : null);
  if (chosen) {
    return {
      linked: true,
      transport: 'smtp',
      address: chosen.address,
      provider: chosen.provider,
      label: providerLabel(chosen.provider),
      link: chosen
    };
  }
  let account = owner ? await readGmailAccount(env, owner) : null;
  if (!account) {
    const primary = await readPrimaryGmailAccount(env);
    if (primary && (!owner || primary.email === owner)) account = primary;
  }
  if (account?.email) {
    const provider = account.provider === 'workspace' ? 'workspace' : 'gmail';
    return {
      linked: true,
      transport: 'gmail',
      address: account.email,
      provider,
      label: providerLabel(provider),
      account
    };
  }
  return { linked: false, transport: '', address: '', provider: '', label: '', connectUrl: `${origin}/auth/mail-app/setup` };
}

async function smtpSecret(env, link, fetchImpl) {
  const decrypted = await decryptSecret(env.MAIL_TOKEN_ENCRYPTION_KEY, link.password_enc);
  if (!decrypted.ok) return decrypted;
  if (decrypted.plain.startsWith('msrt:')) {
    const access = await microsoftAccessToken(env, decrypted.plain.slice('msrt:'.length), fetchImpl);
    if (!access.ok) return { ok: false, reason: access.reason, auth: true };
    return { ok: true, secret: `oauth2:${access.accessToken}` };
  }
  return { ok: true, secret: decrypted.plain };
}

function envelopeRecipients(recipients) {
  return addressList(`${recipients.to} ${recipients.cc} ${recipients.bcc}`.replace(/ /g, ', ')).split(', ').filter(Boolean);
}

async function openTransport(env, host, port, secureTransport) {
  if (env.MAIL_CONNECT) return env.MAIL_CONNECT({ host, port, secureTransport });
  return openSmtpTransport(host, port, secureTransport);
}

export async function deliverReply(env, { sender, thread, subject, body }) {
  const recipients = threadRecipients(thread);
  if (!recipients.to) return { ok: false, sent: false, reason: 'invalid_recipient' };
  const messageId = newMessageId(sender.address);
  const inReplyTo = thread.message_id || '';
  const references = referenceHeader(thread.reference_ids, thread.message_id);
  const rfc822 = buildRfc822({
    from: sender.address,
    to: recipients.to,
    cc: recipients.cc,
    subject,
    body,
    messageId,
    inReplyTo,
    references
  });
  const fetchImpl = env.GMAIL_FETCH || env.MAIL_FETCH || fetch;
  if (sender.transport === 'gmail') {
    const sent = await sendViaGmail(
      env,
      sender.account,
      { from: sender.address, to: recipients.to, cc: recipients.cc, subject, body, rfc822, messageId, expectedSender: sender.address },
      fetchImpl
    );
    return { ...sent, uncertain: false, messageId: sent.ok ? messageId : '' };
  }
  const servers = serversFor(sender.provider, sender.link?.servers_json);
  if (!servers.ok) return { ok: false, sent: false, reason: servers.reason || 'invalid_server' };
  const secret = await smtpSecret(env, sender.link, fetchImpl);
  if (!secret.ok) {
    if (secret.auth) await markLinkError(env, sender.address, secret.reason || 'auth');
    return { ok: false, sent: false, reason: secret.auth ? 'smtp_auth_failed' : secret.reason || 'mail_key_missing' };
  }
  const username = servers.login || sender.address;
  const secureTransport = servers.smtp.port === 587 ? 'starttls' : 'on';
  let transport;
  try {
    transport = await openTransport(env, servers.smtp.host, servers.smtp.port, secureTransport);
  } catch (error) {
    return { ok: false, sent: false, reason: 'smtp_failed' };
  }
  const smtp = await smtpSession(transport, {
    secureTransport,
    username,
    secret: secret.secret,
    from: sender.address,
    rcpt: envelopeRecipients(recipients),
    data: rfc822
  });
  if (!smtp.ok) {
    if (smtp.auth) await markLinkError(env, sender.address, smtp.error || 'auth');
    return {
      ok: false,
      sent: false,
      uncertain: Boolean(smtp.uncertain),
      reason: smtp.uncertain ? 'smtp_uncertain' : smtp.auth ? 'smtp_auth_failed' : 'smtp_failed'
    };
  }
  await addSentId(env, sender.address, messageId);
  let appended = false;
  try {
    const imapTransport = await openTransport(env, servers.imap.host, servers.imap.port, 'on');
    const login = await imapLogin(imapTransport, { username, secret: secret.secret });
    if (login.ok) {
      const list = await imapList(imapTransport);
      const mailbox = sentMailbox(list, servers.sentMailbox || 'Sent');
      const append = await imapAppend(imapTransport, mailbox, rfc822);
      appended = append.ok;
      try {
        await imapTransport.close?.();
      } catch {
        /* 送信済みのコピーに失敗しても再送しない */
      }
    }
  } catch {
    appended = false;
  }
  return { ok: true, sent: true, uncertain: false, messageId, provider: sender.provider, appended };
}

export async function verifyMailboxLogin(env, { smtp, imap, username, secret }) {
  const secureTransport = smtp.port === 587 ? 'starttls' : 'on';
  const smtpTransport = await openTransport(env, smtp.host, smtp.port, secureTransport);
  const smtpResult = await smtpSession(smtpTransport, { secureTransport, username, secret });
  if (!smtpResult.ok) return smtpResult;
  const imapTransport = await openTransport(env, imap.host, imap.port, 'on');
  return imapLogin(imapTransport, { username, secret });
}

export function splitEmails(value) {
  return addressList(value).split(', ').filter(Boolean);
}

export function sameAddress(left, right) {
  return normalizeEmail(left) === normalizeEmail(right);
}
