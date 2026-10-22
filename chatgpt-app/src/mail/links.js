import { digest } from '../compose.js';
import { clip, normalizeEmail, timingSafeEqual } from '../http.js';

const INDEX_KEY = 'mail-link-index';

function linkKey(address) {
  return `mail-link:${address}`;
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

export function blankLink(fields) {
  return {
    kind: fields.kind === 'customer' ? 'customer' : 'operator',
    address: fields.address,
    provider: fields.provider,
    password_enc: fields.password_enc || '',
    status: fields.status || 'pending',
    setup_code_hash: fields.setup_code_hash || '',
    setup_expires_at: fields.setup_expires_at || 0,
    attempts: fields.attempts || 0,
    verified_at: fields.verified_at || 0,
    last_poll_at: fields.last_poll_at || 0,
    last_result: fields.last_result || '',
    imap_state: fields.imap_state || null,
    sent_ids: Array.isArray(fields.sent_ids) ? fields.sent_ids : [],
    servers_json: fields.servers_json || null,
    owner: fields.owner || ''
  };
}

export async function putLink(env, link) {
  const address = normalizeEmail(link.address);
  if (!env.CHATGPT_KV || !address) return { ok: false, reason: 'invalid_link' };
  const stored = blankLink({ ...link, address });
  await env.CHATGPT_KV.put(linkKey(address), JSON.stringify(stored));
  const index = [address, ...(await readIndex(env)).filter((entry) => entry !== address)].slice(0, 100);
  await env.CHATGPT_KV.put(INDEX_KEY, JSON.stringify(index));
  return { ok: true, link: stored };
}

export async function getLink(env, address) {
  const email = normalizeEmail(address);
  if (!env.CHATGPT_KV || !email) return null;
  const raw = await env.CHATGPT_KV.get(linkKey(email));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function listLinks(env, owner = '') {
  if (!env.CHATGPT_KV) return [];
  const links = [];
  for (const address of await readIndex(env)) {
    const link = await getLink(env, address);
    if (!link) continue;
    if (owner && link.owner && link.owner !== owner) continue;
    links.push(link);
  }
  return links;
}

export async function issueSetupCode(env, fields) {
  const address = normalizeEmail(fields.address);
  if (!address) return { ok: false, reason: 'invalid_email' };
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const code = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const saved = await putLink(env, {
    kind: fields.kind,
    address,
    provider: fields.provider,
    owner: normalizeEmail(fields.owner || '') || address,
    status: 'pending',
    setup_code_hash: await digest(code),
    setup_expires_at: Date.now() + 10 * 60 * 1000,
    attempts: 0,
    servers_json: fields.servers_json || null
  });
  if (!saved.ok) return saved;
  return { ok: true, code, expiresAt: saved.link.setup_expires_at, link: saved.link };
}

export async function findLinkByCode(env, code) {
  const token = clip(code, 80);
  if (!/^[0-9a-f]{32}$/i.test(token)) return null;
  const hash = await digest(token);
  for (const link of await listLinks(env)) {
    if (link.setup_code_hash && timingSafeEqual(link.setup_code_hash, hash)) return link;
  }
  return null;
}

export async function addSentId(env, address, messageId) {
  const link = await getLink(env, address);
  if (!link) return { ok: false };
  const sent = [messageId, ...(link.sent_ids || []).filter((id) => id !== messageId)].slice(0, 200);
  return putLink(env, { ...link, sent_ids: sent, status: 'active', last_result: 'sent' });
}

export async function markLinkError(env, address, result) {
  const link = await getLink(env, address);
  if (!link) return { ok: false };
  return putLink(env, { ...link, status: 'error', last_result: clip(result, 200) });
}
