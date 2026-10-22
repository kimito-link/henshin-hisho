import { clip, normalizeEmail, validDeskId } from './http.js';

function ownerKey(input = {}) {
  const email = normalizeEmail(input.email);
  if (email) return `email:${email}`;
  const deskId = validDeskId(input.deskId);
  if (deskId) return `desk:${deskId}`;
  return '';
}

async function readJson(env, key) {
  const raw = await env.CHATGPT_KV.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function listShiori(env, input = {}) {
  if (!env.CHATGPT_KV) return { ok: false, reason: 'storage_not_configured', items: [] };
  const owner = ownerKey(input);
  if (!owner) return { ok: false, reason: 'owner_required', items: [] };
  const ids = (await readJson(env, `shiori-index:${owner}`)) || [];
  const items = [];
  for (const id of ids) {
    const record = await readJson(env, `shiori:${owner}:${id}`);
    if (record) items.push(record);
  }
  return { ok: true, items };
}

export async function saveShiori(env, input = {}, nowMs = Date.now()) {
  if (!env.CHATGPT_KV) return { ok: false, reason: 'storage_not_configured', items: [] };
  const owner = ownerKey(input);
  if (!owner) return { ok: false, reason: 'owner_required', items: [] };
  const excerpt = clip(input.body || input.excerpt || '', 280);
  const candidateText = clip(input.candidateText || input.text || '', 4000);
  if (!excerpt && !candidateText) return { ok: false, reason: 'empty_shiori', items: [] };
  const id = crypto.randomUUID();
  const record = {
    id,
    subject: clip(input.subject, 200),
    sender: clip(input.sender, 120),
    excerpt,
    candidateText,
    riskLevel: clip(input.riskLevel || 'unknown', 20),
    savedAt: nowMs
  };
  await env.CHATGPT_KV.put(`shiori:${owner}:${id}`, JSON.stringify(record));
  const indexKey = `shiori-index:${owner}`;
  const previous = (await readJson(env, indexKey)) || [];
  const next = [id, ...previous.filter((item) => item !== id)].slice(0, 20);
  const dropped = previous.filter((item) => !next.includes(item));
  await env.CHATGPT_KV.put(indexKey, JSON.stringify(next));
  await Promise.all(dropped.map((item) => env.CHATGPT_KV.delete(`shiori:${owner}:${item}`)));
  const listed = await listShiori(env, input);
  return { ok: true, shiori: record, items: listed.items };
}
