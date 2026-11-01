import { digest } from '../compose.js';
import { clip, normalizeEmail } from '../http.js';

const INDEX_KEY = 'email-thread-index';

function threadKey(id) {
  return `email-thread:${id}`;
}

function messageKey(messageId) {
  return `email-thread-msgid:${messageId}`;
}

export function addressList(value) {
  const parts = String(value || '').split(/[,;]/);
  const emails = [];
  for (const part of parts) {
    const angled = part.match(/<([^>]+)>/);
    const email = normalizeEmail(angled ? angled[1] : part);
    if (email && !emails.includes(email)) emails.push(email);
  }
  return emails.join(', ');
}

export function threadRecipients(thread) {
  if (!thread) return { to: '', cc: '', bcc: '' };
  return {
    to: thread.reply_to_address || thread.from_address || '',
    cc: thread.cc_address || '',
    bcc: thread.bcc_address || ''
  };
}

export async function recipientHash(thread) {
  return digest(
    [
      thread.reply_to_address || '',
      thread.from_address || '',
      thread.to_address || '',
      thread.cc_address || '',
      thread.bcc_address || '',
      thread.message_id || ''
    ].join('\n')
  );
}

export async function getEmailThread(env, id) {
  if (!env.CHATGPT_KV || !id) return null;
  const raw = await env.CHATGPT_KV.get(threadKey(clip(id, 80)));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

export async function threadByMessageId(env, messageId) {
  if (!env.CHATGPT_KV || !messageId) return null;
  const id = await env.CHATGPT_KV.get(messageKey(messageId));
  if (!id) return null;
  return getEmailThread(env, id);
}

export async function recordEmailThread(env, fields) {
  if (!env.CHATGPT_KV) return { ok: false, reason: 'storage_not_configured' };
  const messageId = clip(fields.message_id, 300);
  if (!messageId) return { ok: false, reason: 'invalid_incoming' };
  const existingId = await env.CHATGPT_KV.get(messageKey(messageId));
  if (existingId) {
    const existing = await getEmailThread(env, existingId);
    return { ok: true, duplicate: true, item: existing };
  }
  const thread = {
    id: crypto.randomUUID(),
    message_id: messageId,
    reply_to_address: addressList(fields.reply_to_address),
    from_address: normalizeEmail(fields.from_address),
    to_address: addressList(fields.to_address),
    cc_address: addressList(fields.cc_address),
    bcc_address: addressList(fields.bcc_address),
    subject: clip(fields.subject, 200),
    in_reply_to: clip(fields.in_reply_to, 500),
    reference_ids: clip(fields.reference_ids, 2000),
    quote_text: clip(fields.quote_text, 280),
    received_at: Number(fields.received_at) || Date.now(),
    owner: normalizeEmail(fields.owner) || ''
  };
  if (!thread.from_address && !thread.reply_to_address) return { ok: false, reason: 'invalid_incoming' };
  thread.recipient_hash = await recipientHash(thread);
  await env.CHATGPT_KV.put(threadKey(thread.id), JSON.stringify(thread));
  await env.CHATGPT_KV.put(messageKey(messageId), thread.id);
  const rawIndex = await env.CHATGPT_KV.get(INDEX_KEY);
  let index = [];
  try {
    index = JSON.parse(rawIndex || '[]');
  } catch {
    index = [];
  }
  if (!Array.isArray(index)) index = [];
  await env.CHATGPT_KV.put(INDEX_KEY, JSON.stringify([thread.id, ...index.filter((id) => id !== thread.id)].slice(0, 50)));
  return { ok: true, item: thread };
}

export async function listEmailThreads(env) {
  if (!env.CHATGPT_KV) return [];
  const raw = await env.CHATGPT_KV.get(INDEX_KEY);
  let index = [];
  try {
    index = JSON.parse(raw || '[]');
  } catch {
    index = [];
  }
  const items = [];
  for (const id of Array.isArray(index) ? index : []) {
    const thread = await getEmailThread(env, id);
    if (thread) items.push(thread);
  }
  return items;
}

export async function markThreadAnswered(env, messageId, at = Date.now()) {
  const thread = await threadByMessageId(env, messageId);
  if (!thread) return { ok: false };
  thread.answered_at = at;
  await env.CHATGPT_KV.put(threadKey(thread.id), JSON.stringify(thread));
  return { ok: true, item: thread };
}

/** In-Reply-To が保存済み message_id と一致したら、そのスレッドを返信済みにする。本文は見ない。 */
export async function markAnsweredFromHeaders(env, headerText) {
  const lines = String(headerText || '').split(/\r?\n/);
  let marked = 0;
  for (const line of lines) {
    const match = line.match(/^\s*in-reply-to:\s*(.+)$/i);
    if (!match) continue;
    for (const token of match[1].split(/\s+/)) {
      const id = token.trim();
      if (!id) continue;
      const saved = await markThreadAnswered(env, id);
      if (saved.ok) marked += 1;
    }
  }
  return { ok: true, marked };
}
