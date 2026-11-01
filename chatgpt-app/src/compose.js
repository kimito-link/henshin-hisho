import { clip, normalizeEmail } from './http.js';

export async function digest(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function replySubject(subject) {
  const value = clip(subject, 200);
  if (!value) return '返信';
  if (/^re\s*:/i.test(value)) return value;
  return `Re: ${value}`.slice(0, 200);
}

export function resolveRecipient(input = {}, reference = {}) {
  const direct = normalizeEmail(input.to || input.recipient || '');
  if (direct) return direct;
  const sender = normalizeEmail(input.sender || '');
  if (sender) return sender;
  const previous = normalizeEmail(reference.sender || '');
  return previous;
}

export function buildCompose(input = {}, reference = {}) {
  return {
    from: normalizeEmail(input.from || ''),
    provider: '',
    providerLabel: '',
    linked: false,
    connectUrl: '',
    transport: '',
    to: resolveRecipient(input, reference),
    cc: normalizeEmail(input.cc || ''),
    bcc: normalizeEmail(input.bcc || ''),
    subject: replySubject(input.subject),
    body: '',
    incomingId: clip(input.incomingId, 80),
    threadId: clip(input.incomingId, 80)
  };
}

export function fallbackText(payload = {}) {
  const compose = payload.compose || {};
  const who = compose.linked === false
    ? '未連携'
    : compose.providerLabel
      ? `${compose.providerLabel} · ${compose.from || ''}`
      : compose.from || '';
  const lines = [
    payload.sent === true ? '送信しました。' : 'このメールは未送信です。',
    `差出人: ${who}`,
    `宛先: ${compose.to || ''}`,
    compose.cc ? `Cc: ${compose.cc}` : '',
    compose.bcc ? `Bcc: ${compose.bcc}` : '',
    `件名: ${compose.subject || ''}`,
    '本文:',
    compose.body || '',
    '候補:'
  ];
  for (const candidate of payload.candidates || []) {
    const emotion = candidate.emotion || {};
    lines.push(`- ${candidate.label || ''}（${emotion.category || ''} ${emotion.score ?? ''}）${candidate.text || ''}`);
  }
  if (payload.reason) lines.push(`理由: ${payload.reason}`);
  return lines.filter((line) => line !== '').join('\n');
}

/** 送信直前に、保存した件名と、スレッドの宛先ハッシュを取り直す。宛先はスレッドの記録だけを使う。 */
export function compareSendState(snapshot, thread, request = {}) {
  if (!snapshot || snapshot.sendNonce !== request.sendNonce) return { ok: false, reason: 'approval_required' };
  if (request.userApproved !== true) return { ok: false, reason: 'approval_required' };
  if (!snapshot.threadId) return { ok: false, reason: 'thread_required' };
  if (!thread || thread.id !== snapshot.threadId) return { ok: false, reason: 'state_mismatch' };
  const hash = thread.recipient_hash || thread.hash || '';
  const savedHash = snapshot.threadHash || snapshot.incomingHash || '';
  if (hash !== savedHash && request.reconfirmed !== true) return { ok: false, reason: 'state_mismatch' };
  const recipients = {
    to: thread.reply_to_address || thread.from_address || thread.to || '',
    cc: thread.cc_address || '',
    bcc: thread.bcc_address || ''
  };
  const typedSame =
    String(request.to || '') === recipients.to &&
    String(request.cc || '') === recipients.cc &&
    String(request.bcc || '') === recipients.bcc;
  const draftSame = String(request.subject || '') === String(snapshot.subject || '') && String(request.body || '') === String(snapshot.body || '');
  if ((!typedSame || !draftSame) && request.reconfirmed !== true) return { ok: false, reason: 'state_mismatch' };
  return { ok: true };
}
