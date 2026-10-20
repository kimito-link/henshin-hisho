/**
 * routes.js — 案件統合AI秘書機能のAPIエンドポイント群。
 *
 * 設計: docs/PROJECT-AI-IMPLEMENTATION-HANDOFF.md F節。
 * index.js への変更はimport1行＋委譲2行のみ（既存ルートは触らない）。
 * CORS/JSONは http.js の jsonResponse/readJson を使う（コピーを作らない）。
 */

import { requireAuth } from '../auth.js';
import { jsonResponse, readJson } from '../http.js';
import { runChatworkSync } from '../connectors/chatwork.js';
import { ASSIST_MAX_TOKENS, prepareAssist, runAssist } from './assist.js';
import { costGuard, estimateCallMilli, resolveModel } from '../cost-guard.js';
import { MAX_PROMPT_CHARS } from '../llm.js';
import {
  createChannelLink,
  createImportToken,
  createInternalStaff,
  createProject,
  fetchProjectMessages,
  findChannelLinkBySource,
  getChannelLink,
  getProjectForUser,
  insertMessageIfNew,
  listChannelLinks,
  listImportTokens,
  listInternalStaff,
  listProjects,
  loadStaffMap,
  newManualExternalMessageId,
  patchMessageVisibility,
  resolveImportToken,
  revokeImportToken
} from './db.js';
import { decideVisibility } from './visibility.js';
import { maskSecrets } from './masker.js';

function authError(request, env, auth) {
  return jsonResponse(request, env, auth.body, auth.status);
}

/**
 * /projects 配下のパスを解析する（inbox.js の inboxRouteMatch と同型）。
 */
export function projectsRouteMatch(pathname) {
  const withMessagePatch = pathname.match(/^\/projects\/([^/]+)\/messages\/([^/]+)\/visibility$/);
  if (withMessagePatch) {
    return { projectId: decodeURIComponent(withMessagePatch[1]), action: 'message-visibility', subId: decodeURIComponent(withMessagePatch[2]) };
  }
  const withTokenRevoke = pathname.match(/^\/projects\/([^/]+)\/import-tokens\/([^/]+)$/);
  if (withTokenRevoke) {
    return { projectId: decodeURIComponent(withTokenRevoke[1]), action: 'import-token-revoke', subId: decodeURIComponent(withTokenRevoke[2]) };
  }
  const withAction = pathname.match(/^\/projects\/([^/]+)\/(channels|messages\/manual|messages\/import|sync|assist|import-tokens)$/);
  if (withAction) {
    return { projectId: decodeURIComponent(withAction[1]), action: withAction[2] };
  }
  const detail = pathname.match(/^\/projects\/([^/]+)$/);
  if (detail) return { projectId: decodeURIComponent(detail[1]), action: 'detail' };
  return null;
}

async function handleCreateProject(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return authError(request, env, auth);
  const payload = await readJson(request);
  if (!payload || !String(payload.name || '').trim()) {
    return jsonResponse(request, env, { ok: false, reason: 'invalid_json' }, 400);
  }
  const project = await createProject(env.PROJECT_DB, {
    userId: auth.user.id,
    name: String(payload.name).trim(),
    summary: String(payload.summary || '').trim()
  });
  return jsonResponse(request, env, { ok: true, project });
}

async function handleListProjects(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return authError(request, env, auth);
  const projects = await listProjects(env.PROJECT_DB, { userId: auth.user.id });
  return jsonResponse(request, env, { ok: true, projects });
}

async function handleProjectDetail(request, env, projectId) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return authError(request, env, auth);
  const project = await getProjectForUser(env.PROJECT_DB, { userId: auth.user.id, projectId });
  if (!project) return jsonResponse(request, env, { ok: false, reason: 'not_found' }, 404);
  const channels = await listChannelLinks(env.PROJECT_DB, { projectId });
  const messages = await fetchProjectMessages(env.PROJECT_DB, { projectId, audience: 'owner', limit: 100 });
  return jsonResponse(request, env, { ok: true, project, channels, messages });
}

async function handleCreateChannel(request, env, projectId) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return authError(request, env, auth);
  const project = await getProjectForUser(env.PROJECT_DB, { userId: auth.user.id, projectId });
  if (!project) return jsonResponse(request, env, { ok: false, reason: 'not_found' }, 404);
  const payload = await readJson(request);
  const source = String(payload?.source || '').trim();
  const counterpartRole = String(payload?.counterpartRole || '').trim();
  const externalConversationId = String(payload?.externalConversationId || '').trim();
  if (!source || !externalConversationId || !['customer', 'engineer', 'mixed'].includes(counterpartRole)) {
    return jsonResponse(request, env, { ok: false, reason: 'invalid_json' }, 400);
  }
  const channel = await createChannelLink(env.PROJECT_DB, {
    projectId,
    source,
    externalConversationId,
    label: String(payload?.label || '').trim(),
    counterpartRole,
    defaultVisibility: decideVisibility({ senderRole: 'unknown', channelLink: { counterpart_role: counterpartRole } })
  });
  return jsonResponse(request, env, { ok: true, channel });
}

async function handleManualMessage(request, env, projectId) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return authError(request, env, auth);
  const project = await getProjectForUser(env.PROJECT_DB, { userId: auth.user.id, projectId });
  if (!project) return jsonResponse(request, env, { ok: false, reason: 'not_found' }, 404);
  const payload = await readJson(request);
  const channelLinkId = String(payload?.channelLinkId || '').trim();
  const senderRole = String(payload?.senderRole || '').trim();
  const body = String(payload?.body || '').trim();
  if (!channelLinkId || !['internal', 'customer', 'engineer'].includes(senderRole) || !body) {
    return jsonResponse(request, env, { ok: false, reason: 'invalid_json' }, 400);
  }
  const channelLink = await getChannelLink(env.PROJECT_DB, { channelLinkId });
  if (!channelLink || channelLink.project_id !== projectId) {
    return jsonResponse(request, env, { ok: false, reason: 'channel_not_found' }, 404);
  }
  const visibility = decideVisibility({ senderRole, channelLink });
  const { text: bodyMasked, masked } = maskSecrets(body);
  const { id } = await insertMessageIfNew(env.PROJECT_DB, {
    projectId,
    channelLinkId,
    source: channelLink.source,
    externalMessageId: newManualExternalMessageId(),
    senderRole,
    senderAccountId: '',
    senderDisplayName: String(payload?.senderDisplayName || '').trim(),
    visibility,
    body: bodyMasked,
    masked,
    sentAt: Number(payload?.sentAt) || Date.now()
  });
  return jsonResponse(request, env, { ok: true, message: { id, visibility, masked } });
}

/**
 * 拡張連携（henshin-hisho-sync）用のトークン認証。requireAuth（セッション）とは別軸。
 * トークンが正しくても projectId が一致しなければ 404 にする（他人のプロジェクトIDを
 * 総当たりされても、存在確認すら返さないため）。
 */
async function requireImportToken(request, env, projectId) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, body: { ok: false, reason: 'missing_token' } };
  const resolvedProjectId = await resolveImportToken(env.PROJECT_DB, { token });
  if (!resolvedProjectId || resolvedProjectId !== projectId) {
    return { ok: false, status: 404, body: { ok: false, reason: 'not_found' } };
  }
  return { ok: true };
}

async function handleCreateImportToken(request, env, projectId) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return authError(request, env, auth);
  const project = await getProjectForUser(env.PROJECT_DB, { userId: auth.user.id, projectId });
  if (!project) return jsonResponse(request, env, { ok: false, reason: 'not_found' }, 404);
  const created = await createImportToken(env.PROJECT_DB, { projectId });
  return jsonResponse(request, env, { ok: true, importToken: created });
}

async function handleListImportTokens(request, env, projectId) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return authError(request, env, auth);
  const project = await getProjectForUser(env.PROJECT_DB, { userId: auth.user.id, projectId });
  if (!project) return jsonResponse(request, env, { ok: false, reason: 'not_found' }, 404);
  const importTokens = await listImportTokens(env.PROJECT_DB, { projectId });
  return jsonResponse(request, env, { ok: true, importTokens });
}

async function handleRevokeImportToken(request, env, projectId, token) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return authError(request, env, auth);
  const result = await revokeImportToken(env.PROJECT_DB, { userId: auth.user.id, projectId, token });
  return jsonResponse(request, env, result, result.ok ? 200 : 404);
}

/**
 * 拡張（Chrome拡張「りんくのAI返信秘書」しおり機能）から、既に抽出済みのメッセージを
 * 一括で受け取る。ランサーズ・Chatwork向け（ココナラはhandleManualMessageの手動貼り付けを使う）。
 *
 * handleManualMessage と違い、externalMessageId は呼び出し側（拡張）が発行した値を
 * そのまま使う。insertMessageIfNew の UNIQUE(source, external_message_id) が冪等性を担保する
 * ため、拡張側が同じデータを再送しても二重登録されない。
 * チャネル（project_channel_links）が無ければ自動作成する（counterpart_role の既定は customer、
 * 後からUIで変更可能）。
 */
async function handleImportMessages(request, env, projectId) {
  const tokenAuth = await requireImportToken(request, env, projectId);
  if (!tokenAuth.ok) return jsonResponse(request, env, tokenAuth.body, tokenAuth.status);
  // ↑ トークンが有効かつ projectId と一致していれば、プロジェクトの実在は保証される
  //   （project_import_tokens.project_id は projects(id) への外部キー参照）。
  const payload = await readJson(request);
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  if (!messages.length) {
    return jsonResponse(request, env, { ok: false, reason: 'empty_messages' }, 400);
  }
  const defaultCounterpartRole = ['customer', 'engineer', 'mixed'].includes(payload?.defaultCounterpartRole)
    ? payload.defaultCounterpartRole
    : 'customer';

  const channelCache = new Map(); // "source:externalConversationId" -> channelLink
  let imported = 0;
  let skipped = 0;
  for (const raw of messages) {
    const source = String(raw?.source || '').trim();
    const externalConversationId = String(raw?.externalConversationId || '').trim();
    const externalMessageId = String(raw?.externalMessageId || '').trim();
    const body = String(raw?.body || '').trim();
    if (!source || !externalConversationId || !externalMessageId || !body) {
      skipped += 1;
      continue;
    }
    const cacheKey = `${source}:${externalConversationId}`;
    let channelLink = channelCache.get(cacheKey);
    if (!channelLink) {
      channelLink = await findChannelLinkBySource(env.PROJECT_DB, { projectId, source, externalConversationId });
      if (!channelLink) {
        channelLink = await createChannelLink(env.PROJECT_DB, {
          projectId,
          source,
          externalConversationId,
          label: String(raw?.conversationLabel || '').trim(),
          counterpartRole: defaultCounterpartRole,
          defaultVisibility: decideVisibility({ senderRole: 'unknown', channelLink: { counterpart_role: defaultCounterpartRole } })
        });
      }
      channelCache.set(cacheKey, channelLink);
    }
    const senderRole = raw?.fromSelf ? 'internal' : 'unknown';
    const visibility = decideVisibility({ senderRole, channelLink });
    const { text: bodyMasked, masked } = maskSecrets(body);
    const { inserted } = await insertMessageIfNew(env.PROJECT_DB, {
      projectId,
      channelLinkId: channelLink.id,
      source: channelLink.source,
      externalMessageId,
      senderRole,
      senderAccountId: '',
      senderDisplayName: String(raw?.senderDisplayName || '').trim(),
      visibility,
      body: bodyMasked,
      masked,
      sentAt: Number(raw?.sentAt) || Date.now()
    });
    if (inserted) imported += 1;
    else skipped += 1;
  }
  return jsonResponse(request, env, { ok: true, imported, skipped });
}

async function handleSync(request, env, projectId) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return authError(request, env, auth);
  const project = await getProjectForUser(env.PROJECT_DB, { userId: auth.user.id, projectId });
  if (!project) return jsonResponse(request, env, { ok: false, reason: 'not_found' }, 404);
  const channels = await listChannelLinks(env.PROJECT_DB, { projectId });
  const staffMap = await loadStaffMap(env.PROJECT_DB);
  const synced = await runChatworkSync(env, env.PROJECT_DB, channels, staffMap);
  return jsonResponse(request, env, { ok: true, synced });
}

async function handlePatchVisibility(request, env, projectId, messageId) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return authError(request, env, auth);
  const payload = await readJson(request);
  const visibility = String(payload?.visibility || '').trim();
  if (!['public', 'internal'].includes(visibility)) {
    return jsonResponse(request, env, { ok: false, reason: 'invalid_json' }, 400);
  }
  const result = await patchMessageVisibility(env.PROJECT_DB, { userId: auth.user.id, projectId, messageId, visibility });
  return jsonResponse(request, env, result, result.ok ? 200 : 404);
}

async function handleAssist(request, env, projectId) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return authError(request, env, auth);
  const project = await getProjectForUser(env.PROJECT_DB, { userId: auth.user.id, projectId });
  if (!project) return jsonResponse(request, env, { ok: false, reason: 'not_found' }, 404);
  const payload = await readJson(request);
  const mode = String(payload?.mode || 'status').trim();
  if (!['status', 'reconcile', 'draft_reply'].includes(mode)) {
    return jsonResponse(request, env, { ok: false, reason: 'invalid_mode' }, 400);
  }
  const audience = String(payload?.audience || 'customer').trim();
  if (!['customer', 'engineer'].includes(audience)) {
    return jsonResponse(request, env, { ok: false, reason: 'invalid_audience' }, 400);
  }
  const channels = await listChannelLinks(env.PROJECT_DB, { projectId });
  const allMessages = await fetchProjectMessages(env.PROJECT_DB, { projectId, audience: 'owner', limit: 200 });
  const intent = String(payload?.intent || '').slice(0, 500);
  const prepared = prepareAssist({ project, channels, allMessages, mode, intent, audience });
  // 発言を全部落としても長い（カルテ・チャネル概要が長すぎる）ときは、予約する前に断る。
  if (prepared.userPrompt.length > MAX_PROMPT_CHARS) {
    return jsonResponse(request, env, { ok: false, reason: 'prompt_too_long', message: '案件カルテが長すぎるためAIに渡せません。カルテを短くしてください。' }, 413);
  }
  const guard = await costGuard(env, auth.user, {
    estimateMilli: estimateCallMilli({
      model: resolveModel(env),
      promptChars: prepared.userPrompt.length,
      maxTokens: ASSIST_MAX_TOKENS
    })
  });
  if (!guard.ok) return jsonResponse(request, env, guard.body, guard.status);
  try {
    const result = await runAssist(env, prepared, guard.reservation);
    return jsonResponse(request, env, { ok: true, result });
  } catch (error) {
    if (error?.message === 'llm_not_configured') {
      return jsonResponse(request, env, { ok: false, reason: 'llm_not_configured' }, 503);
    }
    return jsonResponse(request, env, { ok: false, reason: 'server_error' }, 500);
  }
}

async function handleCreateStaff(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return authError(request, env, auth);
  const payload = await readJson(request);
  const source = String(payload?.source || '').trim();
  const sourceAccountId = String(payload?.sourceAccountId || '').trim();
  const staffRole = String(payload?.staffRole || '').trim();
  if (!source || !sourceAccountId || !['operator', 'engineer'].includes(staffRole)) {
    return jsonResponse(request, env, { ok: false, reason: 'invalid_json' }, 400);
  }
  const staff = await createInternalStaff(env.PROJECT_DB, {
    userId: auth.user.id,
    source,
    sourceAccountId,
    staffRole,
    displayName: String(payload?.displayName || '').trim()
  });
  return jsonResponse(request, env, { ok: true, staff });
}

async function handleListStaff(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return authError(request, env, auth);
  const staff = await listInternalStaff(env.PROJECT_DB, { userId: auth.user.id });
  return jsonResponse(request, env, { ok: true, staff });
}

/**
 * /projects と /projects/* の入口。index.js から丸ごと委譲される。
 * env.PROJECT_DB が無い場合はfail-closedで503を返す（既存機能には影響しない）。
 */
export async function handleProjectsRoute(request, env) {
  if (!env.PROJECT_DB) {
    return jsonResponse(request, env, { ok: false, reason: 'd1_not_configured' }, 503);
  }
  const url = new URL(request.url);

  if (url.pathname === '/projects/staff') {
    if (request.method === 'POST') return await handleCreateStaff(request, env);
    if (request.method === 'GET') return await handleListStaff(request, env);
  }
  if (url.pathname === '/projects') {
    if (request.method === 'POST') return await handleCreateProject(request, env);
    if (request.method === 'GET') return await handleListProjects(request, env);
  }

  const match = projectsRouteMatch(url.pathname);
  if (match && request.method === 'GET' && match.action === 'detail') {
    return await handleProjectDetail(request, env, match.projectId);
  }
  if (match && request.method === 'POST' && match.action === 'channels') {
    return await handleCreateChannel(request, env, match.projectId);
  }
  if (match && request.method === 'POST' && match.action === 'messages/manual') {
    return await handleManualMessage(request, env, match.projectId);
  }
  if (match && request.method === 'POST' && match.action === 'messages/import') {
    return await handleImportMessages(request, env, match.projectId);
  }
  if (match && request.method === 'POST' && match.action === 'import-tokens') {
    return await handleCreateImportToken(request, env, match.projectId);
  }
  if (match && request.method === 'GET' && match.action === 'import-tokens') {
    return await handleListImportTokens(request, env, match.projectId);
  }
  if (match && request.method === 'DELETE' && match.action === 'import-token-revoke') {
    return await handleRevokeImportToken(request, env, match.projectId, match.subId);
  }
  if (match && request.method === 'POST' && match.action === 'sync') {
    return await handleSync(request, env, match.projectId);
  }
  if (match && request.method === 'POST' && match.action === 'assist') {
    return await handleAssist(request, env, match.projectId);
  }
  if (match && request.method === 'PATCH' && match.action === 'message-visibility') {
    return await handlePatchVisibility(request, env, match.projectId, match.subId);
  }

  return jsonResponse(request, env, { ok: false, reason: 'not_found' }, 404);
}
