import assert from 'node:assert/strict';
import { syncChatworkChannel } from '../src/connectors/chatwork.js';

let pass = 0;
let fail = 0;

async function test(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    fail += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

// D1のprepare/bind/run/allをメモリ上で模擬する最小スタブ
function createFakeD1() {
  const messages = [];
  const channelUpdates = [];
  return {
    messages,
    channelUpdates,
    prepare(sql) {
      return {
        _sql: sql,
        _params: [],
        bind(...params) {
          this._params = params;
          return this;
        },
        async run() {
          if (this._sql.includes('INSERT INTO messages')) {
            const [id, projectId, channelLinkId, source, externalMessageId, senderRole, senderAccountId,
              senderDisplayName, visibility, body, masked, sentAt] = this._params;
            const dup = messages.find((m) => m.source === source && m.external_message_id === externalMessageId);
            if (dup) return { meta: { changes: 0 } };
            messages.push({
              id, project_id: projectId, channel_link_id: channelLinkId, source,
              external_message_id: externalMessageId, sender_role: senderRole, sender_account_id: senderAccountId,
              sender_display_name: senderDisplayName, visibility, body, masked, sent_at: sentAt
            });
            return { meta: { changes: 1 } };
          }
          if (this._sql.includes('UPDATE project_channel_links')) {
            channelUpdates.push({ descriptionMasked: this._params[0], syncCursor: this._params[1], channelLinkId: this._params[2] });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
      };
    }
  };
}

function createFetchImplFromFixture({ roomInfo, roomMessages }) {
  return async (url) => {
    if (url.includes('/messages')) {
      return { ok: true, status: 200, json: async () => roomMessages };
    }
    return { ok: true, status: 200, json: async () => roomInfo };
  };
}

await test('syncChatworkChannel: 顧客窓口ルームは全メッセージがpublic', async () => {
  const db = createFakeD1();
  const channelLink = {
    id: 'chan_1', project_id: 'proj_1', external_conversation_id: '446167323',
    counterpart_role: 'customer', sync_cursor: ''
  };
  const fetchImpl = createFetchImplFromFixture({
    roomInfo: { description: '相談内容: サイト移行' },
    roomMessages: [
      { message_id: '100', account: { account_id: 999, name: 'ANDSTORY' }, body: '予算は3万円程度です', send_time: 1735689600 }
    ]
  });
  const env = { CHATWORK_API_TOKEN: 'dummy' };
  const staffMap = new Map();
  const result = await syncChatworkChannel(env, db, channelLink, staffMap, { fetchImpl });

  assert.equal(result.fetched, 1);
  assert.equal(result.stored, 1);
  assert.equal(db.messages[0].visibility, 'public');
  assert.equal(db.messages[0].sender_role, 'customer');
});

await test('syncChatworkChannel: internal_staff登録済みエンジニアの発言はengineer/internal', async () => {
  const db = createFakeD1();
  const channelLink = {
    id: 'chan_2', project_id: 'proj_1', external_conversation_id: 'corehei_dm',
    counterpart_role: 'engineer', sync_cursor: ''
  };
  const fetchImpl = createFetchImplFromFixture({
    roomInfo: { description: '' },
    roomMessages: [
      { message_id: '200', account: { account_id: 12345, name: 'corehei（ア）' }, body: '現時点では金額の算出が難しい', send_time: 1735689700 }
    ]
  });
  const env = { CHATWORK_API_TOKEN: 'dummy' };
  const staffMap = new Map([['chatwork:12345', { staff_role: 'engineer' }]]);
  const result = await syncChatworkChannel(env, db, channelLink, staffMap, { fetchImpl });

  assert.equal(result.stored, 1);
  assert.equal(db.messages[0].sender_role, 'engineer');
  assert.equal(db.messages[0].visibility, 'internal');
});

await test('syncChatworkChannel: 概要欄の秘密情報はマスクされて保存される', async () => {
  const db = createFakeD1();
  const channelLink = {
    id: 'chan_3', project_id: 'proj_1', external_conversation_id: 'soletta',
    counterpart_role: 'customer', sync_cursor: ''
  };
  const fetchImpl = createFetchImplFromFixture({
    roomInfo: { description: 'サイト①\nhttp://best-trust.biz/sys-admin/\nID\nbesttrust\nパスコード: secretvalue123' },
    roomMessages: []
  });
  const env = { CHATWORK_API_TOKEN: 'dummy' };
  await syncChatworkChannel(env, db, channelLink, new Map(), { fetchImpl });

  assert.equal(db.channelUpdates.length, 1);
  assert.ok(!db.channelUpdates[0].descriptionMasked.includes('secretvalue123'));
  assert.ok(db.channelUpdates[0].descriptionMasked.includes('パスコード: ***'));
});

await test('syncChatworkChannel: 同一message_idを2回同期しても重複挿入しない（冪等性）', async () => {
  const db = createFakeD1();
  const channelLink = {
    id: 'chan_4', project_id: 'proj_1', external_conversation_id: 'idempotent_room',
    counterpart_role: 'customer', sync_cursor: ''
  };
  const fetchImpl = createFetchImplFromFixture({
    roomInfo: { description: '' },
    roomMessages: [
      { message_id: '300', account: { account_id: 1, name: 'X' }, body: 'こんにちは', send_time: 1735689800 }
    ]
  });
  const env = { CHATWORK_API_TOKEN: 'dummy' };
  const r1 = await syncChatworkChannel(env, db, channelLink, new Map(), { fetchImpl });
  assert.equal(r1.stored, 1);

  // 2回目: sync_cursorが更新された状態を模してもう一度呼ぶ（cronの次回実行を想定）
  const channelLinkAfter = { ...channelLink, sync_cursor: '300' };
  const r2 = await syncChatworkChannel(env, db, channelLinkAfter, new Map(), { fetchImpl });
  assert.equal(r2.stored, 0); // カーソルより古いのでスキップ
  assert.equal(db.messages.length, 1); // 重複していない
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
