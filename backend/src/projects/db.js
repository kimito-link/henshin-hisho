/**
 * db.js — D1クエリの薄いラッパー。kv.js と対称的な役割。
 *
 * 設計: docs/PROJECT-AI-IMPLEMENTATION-HANDOFF.md B・C節。
 * ★visibility二段階防御の第2段（取得時SQLフィルタ）はこのファイルの fetchProjectMessages が担う。
 *   呼び出し側（assist.js）は、この関数が返した以外のメッセージにアクセスする手段を持たない。
 */

function randomHex(len) {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(len / 2)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, len);
}

export function newProjectId() {
  return `proj_${randomHex(16)}`;
}
export function newChannelLinkId() {
  return `chan_${randomHex(16)}`;
}
export function newStaffId() {
  return `staff_${randomHex(16)}`;
}
export function newMessageId() {
  return `msg_${randomHex(16)}`;
}
export function newManualExternalMessageId() {
  return `manual_${Date.now()}_${randomHex(8)}`;
}

export async function createProject(db, { userId, name, summary = '' }) {
  const id = newProjectId();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO projects (id, user_id, name, status, summary, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'active', ?4, ?5, ?5)`
    )
    .bind(id, userId, name, summary, now)
    .run();
  return { id, user_id: userId, name, status: 'active', summary, created_at: now, updated_at: now };
}

export async function listProjects(db, { userId }) {
  const { results } = await db
    .prepare(`SELECT * FROM projects WHERE user_id = ?1 ORDER BY updated_at DESC`)
    .bind(userId)
    .all();
  return results;
}

export async function getProjectForUser(db, { userId, projectId }) {
  const row = await db
    .prepare(`SELECT * FROM projects WHERE id = ?1 AND user_id = ?2`)
    .bind(projectId, userId)
    .first();
  return row || null;
}

export async function listChannelLinks(db, { projectId }) {
  const { results } = await db
    .prepare(`SELECT * FROM project_channel_links WHERE project_id = ?1 ORDER BY created_at ASC`)
    .bind(projectId)
    .all();
  return results;
}

export async function getChannelLink(db, { channelLinkId }) {
  const row = await db
    .prepare(`SELECT * FROM project_channel_links WHERE id = ?1`)
    .bind(channelLinkId)
    .first();
  return row || null;
}

/** cronからの全ユーザー横断Chatwork同期用。ユーザー単位の絞り込みは行わない（PoCは運営者1人のため）。 */
export async function listAllChannelLinksBySource(db, { source }) {
  const { results } = await db
    .prepare(`SELECT * FROM project_channel_links WHERE source = ?1 ORDER BY created_at ASC`)
    .bind(source)
    .all();
  return results;
}

export async function createChannelLink(db, { projectId, source, externalConversationId, label, counterpartRole, defaultVisibility }) {
  const id = newChannelLinkId();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO project_channel_links
         (id, project_id, source, external_conversation_id, label, counterpart_role, default_visibility, description_masked, sync_cursor, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '', '', ?8)`
    )
    .bind(id, projectId, source, externalConversationId, label || '', counterpartRole, defaultVisibility, now)
    .run();
  return {
    id,
    project_id: projectId,
    source,
    external_conversation_id: externalConversationId,
    label: label || '',
    counterpart_role: counterpartRole,
    default_visibility: defaultVisibility,
    description_masked: '',
    sync_cursor: '',
    created_at: now
  };
}

export async function updateChannelSync(db, { channelLinkId, descriptionMasked, syncCursor }) {
  await db
    .prepare(`UPDATE project_channel_links SET description_masked = ?1, sync_cursor = ?2 WHERE id = ?3`)
    .bind(descriptionMasked, syncCursor, channelLinkId)
    .run();
}

export async function listInternalStaff(db, { userId }) {
  const { results } = await db
    .prepare(`SELECT * FROM internal_staff WHERE user_id = ?1 ORDER BY created_at ASC`)
    .bind(userId)
    .all();
  return results;
}

/** 全staffを1回だけロードして Map<"source:accountId", {staff_role}> にする（visibility.jsへ渡す形）。 */
export async function loadStaffMap(db) {
  const { results } = await db.prepare(`SELECT source, source_account_id, staff_role FROM internal_staff`).all();
  const map = new Map();
  for (const row of results) {
    map.set(`${row.source}:${row.source_account_id}`, { staff_role: row.staff_role });
  }
  return map;
}

export async function createInternalStaff(db, { userId, source, sourceAccountId, staffRole, displayName }) {
  const id = newStaffId();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO internal_staff (id, user_id, source, source_account_id, staff_role, display_name, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(source, source_account_id) DO UPDATE SET staff_role = excluded.staff_role, display_name = excluded.display_name`
    )
    .bind(id, userId, source, sourceAccountId, staffRole, displayName || '', now)
    .run();
  return { id, user_id: userId, source, source_account_id: sourceAccountId, staff_role: staffRole, display_name: displayName || '', created_at: now };
}

/**
 * メッセージを冪等挿入する。UNIQUE(source, external_message_id) が正本。
 * 既存行があれば何もしない（visibility_source='manual'で人間が訂正した行を再同期で潰さないため）。
 */
export async function insertMessageIfNew(db, {
  projectId,
  channelLinkId,
  source,
  externalMessageId,
  senderRole,
  senderAccountId,
  senderDisplayName,
  visibility,
  body,
  masked,
  sentAt
}) {
  const id = newMessageId();
  const now = Date.now();
  const result = await db
    .prepare(
      `INSERT INTO messages
         (id, project_id, channel_link_id, source, external_message_id, sender_role, sender_account_id,
          sender_display_name, visibility, visibility_source, body, masked, sent_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'auto', ?10, ?11, ?12, ?13)
       ON CONFLICT(source, external_message_id) DO NOTHING`
    )
    .bind(
      id, projectId, channelLinkId, source, externalMessageId, senderRole, senderAccountId || '',
      senderDisplayName || '', visibility, body, masked ? 1 : 0, sentAt, now
    )
    .run();
  return { inserted: result.meta.changes === 1, id };
}

/**
 * ★visibility二段階防御の第2段。取得時にSQLのWHERE句でフィルタする。
 * audience: 'owner'（運営者UI・AI状況把握用＝全件） | 'customer_facing'（顧客向け引用候補＝publicのみ）
 */
export async function fetchProjectMessages(db, { projectId, audience, limit = 100 }) {
  const base = `SELECT m.*, c.label AS channel_label, c.source AS channel_source
                FROM messages m JOIN project_channel_links c ON m.channel_link_id = c.id
                WHERE m.project_id = ?1`;
  const sql =
    audience === 'customer_facing'
      ? `${base} AND m.visibility = 'public' ORDER BY m.sent_at DESC LIMIT ?2`
      : `${base} ORDER BY m.sent_at DESC LIMIT ?2`;
  const { results } = await db.prepare(sql).bind(projectId, limit).all();
  return results.reverse(); // 時系列昇順で返す
}

/** 事後修正API: 誤判定を訂正する手段。所有権チェックをJOINで同時に行う。 */
export async function patchMessageVisibility(db, { userId, projectId, messageId, visibility }) {
  const result = await db
    .prepare(
      `UPDATE messages SET visibility = ?1, visibility_source = 'manual'
       WHERE id = ?2 AND project_id = ?3
         AND EXISTS (SELECT 1 FROM projects p WHERE p.id = ?3 AND p.user_id = ?4)`
    )
    .bind(visibility, messageId, projectId, userId)
    .run();
  return { ok: result.meta.changes === 1 };
}
