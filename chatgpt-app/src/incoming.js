import { clip } from './http.js';
import { getEmailThread, listEmailThreads, recordEmailThread } from './mail/threads.js';

function adapt(thread) {
  if (!thread) return null;
  return {
    ...thread,
    provider: 'email_routing',
    from: thread.from_address,
    to: thread.reply_to_address || thread.from_address,
    body: thread.quote_text || '',
    hash: thread.recipient_hash,
    receivedAt: thread.received_at
  };
}

/** JSON の転送口。本文は quote_text に短く残すだけで、全文は保存しない。 */
export async function saveIncoming(env, input = {}) {
  const from = input.from || input.sender || '';
  const quote = clip(input.quote_text || input.body || input.text || '', 280);
  if (!from || !quote) return { ok: false, reason: 'invalid_incoming' };
  const messageId = clip(input.message_id || input.messageId, 300) || `<${crypto.randomUUID()}@forward.kimitotalk.link>`;
  const saved = await recordEmailThread(env, {
    message_id: messageId,
    reply_to_address: input.reply_to || input.replyTo || from,
    from_address: from,
    to_address: input.to || '',
    cc_address: input.cc || '',
    bcc_address: input.bcc || '',
    subject: input.subject,
    in_reply_to: input.in_reply_to || input.inReplyTo || '',
    reference_ids: input.reference_ids || input.references || '',
    quote_text: quote,
    received_at: input.receivedAt,
    owner: input.owner || ''
  });
  if (!saved.ok) return saved;
  return { ok: true, duplicate: Boolean(saved.duplicate), item: adapt(saved.item) };
}

export async function getIncoming(env, id) {
  return adapt(await getEmailThread(env, id));
}

export async function listIncoming(env) {
  if (!env.CHATGPT_KV) return { ok: false, reason: 'storage_not_configured', items: [] };
  const items = [];
  for (const thread of await listEmailThreads(env)) items.push(adapt(thread));
  return { ok: true, items };
}
