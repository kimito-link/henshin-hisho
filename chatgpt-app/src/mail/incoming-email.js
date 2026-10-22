import PostalMime from 'postal-mime';
import { clip } from '../http.js';
import { addressList, recordEmailThread } from './threads.js';

function headerValue(parsed, name) {
  const headers = parsed?.headers || [];
  const found = headers.find((header) => header.key === name);
  return found?.value || '';
}

function mailboxList(value) {
  if (!value) return '';
  const list = Array.isArray(value) ? value : [value];
  const emails = [];
  for (const item of list) {
    if (item?.group) emails.push(...item.group.map((member) => member.address));
    else if (item?.address) emails.push(item.address);
    else if (typeof item === 'string') emails.push(item);
  }
  return addressList(emails.join(', '));
}

function ownerOf(parsed, message) {
  const forwarded = headerValue(parsed, 'x-forwarded-for') || message?.headers?.get?.('x-forwarded-for') || '';
  const fromHeader = addressList(forwarded);
  if (fromHeader) return fromHeader.split(', ')[0];
  const envelope = addressList(message?.from || '');
  const first = envelope.split(', ')[0] || '';
  if (first && first !== 'notify@kimitotalk.link') return first;
  return '';
}

export function threadFromParsed(parsed, message) {
  const from = mailboxList(parsed.from);
  const replyTo = mailboxList(parsed.replyTo) || from;
  return {
    message_id: clip(parsed.messageId, 300),
    reply_to_address: replyTo,
    from_address: from,
    to_address: mailboxList(parsed.to),
    cc_address: mailboxList(parsed.cc),
    bcc_address: mailboxList(parsed.bcc),
    subject: parsed.subject || '',
    in_reply_to: parsed.inReplyTo || '',
    reference_ids: parsed.references || '',
    quote_text: clip(parsed.text || '', 280),
    received_at: parsed.date ? Date.parse(parsed.date) || Date.now() : Date.now(),
    owner: ownerOf(parsed, message)
  };
}

export async function handleIncomingEmail(message, env) {
  try {
    const raw = await new Response(message.raw).arrayBuffer();
    const parsed = await PostalMime.parse(raw);
    const fields = threadFromParsed(parsed, message);
    if (!fields.message_id) {
      const bytes = crypto.getRandomValues(new Uint8Array(8));
      const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      fields.message_id = `<${hex}@kimitotalk.link>`;
    }
    return await recordEmailThread(env, fields);
  } catch (error) {
    return { ok: false, reason: 'parse_failed' };
  }
}
