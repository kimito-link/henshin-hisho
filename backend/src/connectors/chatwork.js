/**
 * chatwork.js — Chatwork公式APIからの取り込み。
 *
 * 設計: docs/PROJECT-AI-IMPLEMENTATION-HANDOFF.md F節。
 * ★地雷2（force=0の罠）: 「未取得分だけ返す」パラメータは同一トークンの他クライアント利用で
 *   欠落しうる。必ず force=1 で全件取得し、自前カーソル(sync_cursor)＋UNIQUE制約の
 *   ON CONFLICT DO NOTHINGで冪等性を担保する（カーソルはAPI節約の最適化にすぎない）。
 * ★地雷3（レート制限 300req/5min）: 1同期あたりチャネル数×2リクエスト程度に収める
 *   （room詳細1回＋messages1回、ページングしない・最新分のみ）。
 */

import { decideSenderRole, decideVisibility } from '../projects/visibility.js';
import { maskSecrets } from '../projects/masker.js';
import { insertMessageIfNew, updateChannelSync } from '../projects/db.js';

const CW_BASE = 'https://api.chatwork.com/v2';

export async function cwGet(env, path, options = {}) {
  const token = String(env.CHATWORK_API_TOKEN || '').trim();
  if (!token) throw new Error('chatwork_not_configured');
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${CW_BASE}${path}`, {
    method: 'GET',
    headers: { 'x-chatworktoken': token }
  });
  if (response.status === 204) return [];
  if (!response.ok) throw new Error(`chatwork_status_${response.status}`);
  return await response.json();
}

/**
 * 1チャネル分を同期する。room詳細（概要欄）＋メッセージ最新分を取得し、
 * 取り込み時にsenderRole/visibility/マスクを確定してD1へ冪等挿入する。
 *
 * @returns {Promise<{ fetched: number, stored: number }>}
 */
export async function syncChatworkChannel(env, db, channelLink, staffMap, options = {}) {
  const roomId = channelLink.external_conversation_id;

  // 1. room詳細（概要欄）を取得しマスクして保存
  const roomInfo = await cwGet(env, `/rooms/${roomId}`, options);
  const { text: descriptionMasked } = maskSecrets(roomInfo?.description || '');

  // 2. メッセージ取得。force=1で全件（未取得分だけ、という当てにならないAPIの節約は使わない）
  const rawMessages = await cwGet(env, `/rooms/${roomId}/messages?force=1`, options);
  const messages = Array.isArray(rawMessages) ? rawMessages : [];

  const cursor = Number(channelLink.sync_cursor || 0);
  let stored = 0;
  let maxMessageId = cursor;

  for (const msg of messages) {
    const messageIdNum = Number(msg.message_id);
    if (Number.isFinite(messageIdNum) && messageIdNum > maxMessageId) maxMessageId = messageIdNum;
    // カーソルより古いものはスキップ（API節約の最適化。冪等性自体はUNIQUE制約が担保）
    if (Number.isFinite(messageIdNum) && messageIdNum <= cursor) continue;

    const { text: bodyMasked, masked } = maskSecrets(msg.body || '');
    const senderAccountId = String(msg.account?.account_id || '');
    const senderRole = decideSenderRole({
      source: 'chatwork',
      senderAccountId,
      channelLink,
      staffMap
    });
    const visibility = decideVisibility({ senderRole, channelLink });

    const { inserted } = await insertMessageIfNew(db, {
      projectId: channelLink.project_id,
      channelLinkId: channelLink.id,
      source: 'chatwork',
      externalMessageId: String(msg.message_id),
      senderRole,
      senderAccountId,
      senderDisplayName: String(msg.account?.name || ''),
      visibility,
      body: bodyMasked,
      masked,
      sentAt: Number(msg.send_time || 0) * 1000
    });
    if (inserted) stored += 1;
  }

  await updateChannelSync(db, {
    channelLinkId: channelLink.id,
    descriptionMasked,
    syncCursor: String(maxMessageId)
  });

  return { fetched: messages.length, stored };
}

/**
 * 登録済みの全Chatworkチャネルを同期する（cron・手動sync両方から呼ばれる入口）。
 * @returns {Promise<{ channelLinkId: string, fetched: number, stored: number }[]>}
 */
export async function runChatworkSync(env, db, channelLinks, staffMap, options = {}) {
  const results = [];
  for (const channelLink of channelLinks) {
    if (channelLink.source !== 'chatwork') continue;
    try {
      const result = await syncChatworkChannel(env, db, channelLink, staffMap, options);
      results.push({ channelLinkId: channelLink.id, ...result });
    } catch (error) {
      results.push({ channelLinkId: channelLink.id, error: String(error?.message || error) });
    }
  }
  return results;
}
