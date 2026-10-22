import { clip, normalizeEmail } from './http.js';
import { providerById } from './providers.js';

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

export function buildCompose(input = {}, reference = {}, account = null) {
  const provider = providerById(account?.provider || 'gmail');
  const from = normalizeEmail(input.from || account?.email || '');
  return {
    from,
    provider: account?.email ? provider?.id || '' : '',
    providerLabel: account?.email ? provider?.label || '' : '',
    to: resolveRecipient(input, reference),
    cc: normalizeEmail(input.cc || ''),
    bcc: normalizeEmail(input.bcc || ''),
    subject: replySubject(input.subject),
    body: '',
    incomingId: clip(input.incomingId, 80)
  };
}

export function fallbackText(payload = {}) {
  const compose = payload.compose || {};
  const who = compose.providerLabel ? `${compose.from || ''}（${compose.providerLabel}）` : compose.from || '';
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

/** 送信直前に、保存した宛先・件名と、受信レコードのハッシュを取り直して比べる。 */
export function compareSendState(snapshot, incoming, request = {}) {
  if (!snapshot || snapshot.sendNonce !== request.sendNonce) return { ok: false, reason: 'approval_required' };
  if (request.userApproved !== true) return { ok: false, reason: 'approval_required' };
  if (snapshot.incomingId) {
    if (!incoming || incoming.id !== snapshot.incomingId || incoming.hash !== snapshot.incomingHash) {
      return { ok: false, reason: 'state_mismatch' };
    }
  }
  const same =
    (request.to || '') === (snapshot.to || '') &&
    (request.cc || '') === (snapshot.cc || '') &&
    (request.bcc || '') === (snapshot.bcc || '') &&
    (request.subject || '') === (snapshot.subject || '') &&
    (request.body || '') === (snapshot.body || '');
  if (!same && request.reconfirmed !== true) return { ok: false, reason: 'state_mismatch' };
  return { ok: true };
}
