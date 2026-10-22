import { digest } from './compose.js';
import { clip, normalizeEmail } from './http.js';

const INDEX_KEY = 'incoming-index';

function itemKey(id) {
  return `incoming:${id}`;
}

async function readIndex(env) {
  if (!env.CHATGPT_KV) return [];
  const raw = await env.CHATGPT_KV.get(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveIncoming(env, input = {}) {
  if (!env.CHATGPT_KV) return { ok: false, reason: 'storage_not_configured' };
  const from = normalizeEmail(input.from || input.sender || '');
  const subject = clip(input.subject, 200);
  const body = clip(input.body || input.text, 4000);
  if (!from || !body) return { ok: false, reason: 'invalid_incoming' };
  const id = /^[A-Za-z0-9_-]{8,80}$/.test(clip(input.id, 80)) ? clip(input.id, 80) : crypto.randomUUID();
  const provider = input.provider === 'email_routing' ? 'email_routing' : 'email_routing';
  const item = {
    id,
    provider,
    from,
    to: normalizeEmail(input.to || ''),
    subject,
    body,
    receivedAt: Number(input.receivedAt) || Date.now(),
    hash: await digest(`${from}\n${subject}\n${body}`)
  };
  const index = [id, ...(await readIndex(env)).filter((entry) => entry !== id)].slice(0, 50);
  await env.CHATGPT_KV.put(itemKey(id), JSON.stringify(item));
  await env.CHATGPT_KV.put(INDEX_KEY, JSON.stringify(index));
  return { ok: true, item };
}

export async function getIncoming(env, id) {
  if (!env.CHATGPT_KV || !id) return null;
  const raw = await env.CHATGPT_KV.get(itemKey(clip(id, 80)));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function listIncoming(env) {
  if (!env.CHATGPT_KV) return { ok: false, reason: 'storage_not_configured', items: [] };
  const items = [];
  for (const id of await readIndex(env)) {
    const item = await getIncoming(env, id);
    if (item) items.push(item);
  }
  return { ok: true, items };
}
