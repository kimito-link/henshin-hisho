import { requireAuth } from './auth.js';
// 旧: このファイルに単一オリジン完全一致の jsonResponse コピーがあり、
// APP_ALLOWED_ORIGIN のカンマ区切り化で /inbox 系だけ ACAO が消えた。正は http.js。
import { jsonResponse, readJson } from './http.js';
import { callOpenRouter } from './llm.js';
import { getJson, listKeys, putJson } from './kv.js';
import { generateDraftBody, normalizeSecretaryNote } from './draft-gen.js';
import { accountPolicyForUser } from './account-policy.js';
import { sendLineMessage } from './connectors/line.js';
import { canGenerateDraft, canSendLineMessage } from './risk-gate.js';
import { normalizeInboxItem, normalizeText } from './schema.js';
import { triageInboxItem } from './triage.js';

export function inboxKey(userId, itemId) {
  return `inbox:${userId}:${itemId}`;
}

export async function readInboxItem(env, userId, itemId) {
  return await getJson(env, inboxKey(userId, itemId));
}

export async function writeInboxItem(env, userId, item) {
  const normalized = normalizeInboxItem(item, { now: Date.now() });
  await putJson(env, inboxKey(userId, normalized.id), normalized);
  return normalized;
}

async function readAllInboxItems(env, userId) {
  const keys = await listKeys(env, `inbox:${userId}:`);
  const items = [];
  for (const key of keys) {
    const item = await getJson(env, key);
    if (item) items.push(item);
  }
  return items.sort((a, b) => Number(b.receivedAt || 0) - Number(a.receivedAt || 0));
}

function bucketForItem(item = {}) {
  const triage = item.triage || {};
  if (item.status === 'needs_human_review' || item.riskLevel === 'high' || triage.requiresHumanApproval) return 'needs_human_review';
  if (triage.priority === 'urgent') return 'urgent';
  if (triage.category === 'invoice' || triage.category === 'legal' || triage.category === 'financial') return 'money_or_contract';
  if (triage.suggestedAction === 'create_draft' || triage.category === 'reply_needed' || triage.category === 'support') return 'needs_reply';
  if (triage.category === 'schedule') return 'schedule';
  if (triage.category === 'sales') return 'sales';
  if (triage.suggestedAction === 'snooze') return 'later';
  if (triage.suggestedAction === 'ignore' || triage.category === 'spam_or_promo') return 'ignore';
  return 'fyi';
}

function groupedInbox(items = []) {
  const buckets = {
    urgent: [],
    needs_human_review: [],
    money_or_contract: [],
    needs_reply: [],
    schedule: [],
    sales: [],
    later: [],
    ignore: [],
    fyi: []
  };
  for (const item of items) buckets[bucketForItem(item)].push(item);
  return buckets;
}

function authError(request, env, auth) {
  return jsonResponse(request, env, auth.body, auth.status);
}

export async function handleInboxAssess(request, env, options = {}) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return authError(request, env, auth);
  const payload = await readJson(request);
  if (!payload) return jsonResponse(request, env, { ok: false, reason: 'invalid_json' }, 400);

  const item = normalizeInboxItem({
    channel: payload.channel || 'paste',
    externalId: payload.externalId,
    from: payload.from,
    subject: payload.subject,
    body: payload.body || payload.text,
    receivedAt: payload.receivedAt,
    status: 'untriaged'
  });

  try {
    const triage = await triageInboxItem(item, {
      callLLM: (args) => callOpenRouter(env, args, options)
    });
    const saved = await writeInboxItem(env, auth.user.id, {
      ...item,
      triage,
      riskLevel: triage.riskLevel,
      status: triage.requiresHumanApproval ? 'needs_human_review' : 'triaged',
      updatedAt: Date.now()
    });
    return jsonResponse(request, env, { ok: true, item: saved });
  } catch (error) {
    if (error?.message === 'llm_not_configured') {
      return jsonResponse(request, env, { ok: false, reason: 'llm_not_configured' }, 503);
    }
    return jsonResponse(request, env, { ok: false, reason: 'triage_failed' }, 502);
  }
}

export async function handleInboxList(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return authError(request, env, auth);
  const items = await readAllInboxItems(env, auth.user.id);
  return jsonResponse(request, env, { ok: true, items, buckets: groupedInbox(items) });
}

export async function handleConfirmRisk(request, env, itemId) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return authError(request, env, auth);
  const item = await readInboxItem(env, auth.user.id, itemId);
  if (!item) return jsonResponse(request, env, { ok: false, reason: 'item_not_found' }, 404);
  const saved = await writeInboxItem(env, auth.user.id, {
    ...item,
    riskConfirmed: true,
    status: item.status === 'needs_human_review' ? 'triaged' : item.status,
    updatedAt: Date.now()
  });
  return jsonResponse(request, env, { ok: true, item: saved });
}

export async function handleDraft(request, env, itemId, options = {}) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return authError(request, env, auth);
  const payload = await readJson(request);
  if (!payload) return jsonResponse(request, env, { ok: false, reason: 'invalid_json' }, 400);
  const item = await readInboxItem(env, auth.user.id, itemId);
  if (!item) return jsonResponse(request, env, { ok: false, reason: 'item_not_found' }, 404);

  const gate = canGenerateDraft(item);
  if (!gate.ok) return jsonResponse(request, env, { ok: false, reason: gate.reason }, 409);

  const accountPolicy = accountPolicyForUser(auth.user);
  const secretaryNote = normalizeSecretaryNote(item.secretaryNote, {
    tone: payload.tone || accountPolicy.defaultTone,
    intent: payload.intent,
    extraContext: payload.extraContext
  });

  try {
    const body = await generateDraftBody({ ...item, secretaryNote }, {
      callLLM: (args) => callOpenRouter(env, args, options),
      accountPolicy
    });
    const draft = {
      body,
      tone: secretaryNote.tone,
      createdAt: Date.now()
    };
    const saved = await writeInboxItem(env, auth.user.id, {
      ...item,
      secretaryNote,
      draft,
      status: 'draft_ready',
      updatedAt: Date.now()
    });
    return jsonResponse(request, env, { ok: true, item: saved, draft });
  } catch (error) {
    if (error?.message === 'llm_not_configured') {
      return jsonResponse(request, env, { ok: false, reason: 'llm_not_configured' }, 503);
    }
    return jsonResponse(request, env, { ok: false, reason: 'draft_failed' }, 502);
  }
}

export function inboxRouteMatch(pathname) {
  const draft = pathname.match(/^\/inbox\/([^/]+)\/draft$/);
  if (draft) return { action: 'draft', itemId: normalizeText(decodeURIComponent(draft[1]), 200) };
  const confirm = pathname.match(/^\/inbox\/([^/]+)\/confirm-risk$/);
  if (confirm) return { action: 'confirm-risk', itemId: normalizeText(decodeURIComponent(confirm[1]), 200) };
  const send = pathname.match(/^\/inbox\/([^/]+)\/send$/);
  if (send) return { action: 'send', itemId: normalizeText(decodeURIComponent(send[1]), 200) };
  return null;
}

export async function handleSend(request, env, itemId, options = {}) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return authError(request, env, auth);
  const payload = await readJson(request);
  if (!payload) return jsonResponse(request, env, { ok: false, reason: 'invalid_json' }, 400);
  const item = await readInboxItem(env, auth.user.id, itemId);
  if (!item) return jsonResponse(request, env, { ok: false, reason: 'item_not_found' }, 404);
  if (item.channel !== 'line') {
    return jsonResponse(request, env, { ok: false, reason: 'send_not_supported_for_channel' }, 400);
  }

  const gate = canSendLineMessage(item, { confirmSend: payload.confirmSend === true });
  if (!gate.ok) {
    const status = gate.reason === 'risk_confirmation_required' ? 409 : 400;
    return jsonResponse(request, env, { ok: false, reason: gate.reason }, status);
  }

  const body = normalizeText(payload.body || item.draft?.body);
  if (!body) return jsonResponse(request, env, { ok: false, reason: 'missing_send_body' }, 400);

  const result = await sendLineMessage(env, item, body, options);
  if (!result.ok) {
    const status = result.reason === 'line_not_configured' ? 503 : 502;
    return jsonResponse(request, env, result, status);
  }
  const saved = await writeInboxItem(env, auth.user.id, {
    ...item,
    status: 'sent',
    sentAt: Date.now(),
    updatedAt: Date.now()
  });
  return jsonResponse(request, env, { ok: true, item: saved, line: result });
}
