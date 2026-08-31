-- 案件統合AI秘書機能: Project中心スキーマ。
-- 設計: docs/PROJECT-AI-IMPLEMENTATION-HANDOFF.md B節。
-- 既存のKVベース(users/session/inbox等)とは完全独立。ここに書くテーブルだけがD1に住む。

CREATE TABLE projects (
  id         TEXT PRIMARY KEY,              -- 'proj_' + 16hex
  user_id    TEXT NOT NULL,                 -- KV users:{id} のid（D1側にusersは持たない）
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active',-- active | closed
  summary    TEXT NOT NULL DEFAULT '',      -- 案件カルテ（マスク済みテキスト、手動編集可。同期では上書きしない）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_projects_user ON projects(user_id, status);

CREATE TABLE project_channel_links (
  id                       TEXT PRIMARY KEY,   -- 'chan_' + 16hex
  project_id               TEXT NOT NULL REFERENCES projects(id),
  source                   TEXT NOT NULL,      -- chatwork | coconala | lancers | line | manual
  external_conversation_id TEXT NOT NULL,      -- chatwork room_id 等。手動チャネルは 'manual:{source}:{連番}'
  label                    TEXT NOT NULL DEFAULT '',
  counterpart_role         TEXT NOT NULL,      -- customer | engineer | mixed
  default_visibility       TEXT NOT NULL,      -- public | internal（counterpart_roleから導出して保存）
  description_masked       TEXT NOT NULL DEFAULT '', -- Chatwork概要欄（マスク済み。再同期のたび上書きされる）
  sync_cursor              TEXT NOT NULL DEFAULT '', -- 最後に処理したChatwork message_id
  created_at               INTEGER NOT NULL,
  UNIQUE(source, external_conversation_id)
);
CREATE INDEX idx_channel_links_project ON project_channel_links(project_id);

CREATE TABLE internal_staff (
  id                TEXT PRIMARY KEY,          -- 'staff_' + 16hex
  user_id           TEXT NOT NULL,             -- 登録した運営者
  source            TEXT NOT NULL,             -- chatwork | coconala | lancers | line
  source_account_id TEXT NOT NULL,             -- 例: Chatworkのaccount_idを文字列で
  staff_role        TEXT NOT NULL DEFAULT 'operator', -- operator | engineer
  display_name      TEXT NOT NULL DEFAULT '',  -- 参考表示用。判定には使わない
  created_at        INTEGER NOT NULL,
  UNIQUE(source, source_account_id)
);

CREATE TABLE messages (
  id                  TEXT PRIMARY KEY,        -- 'msg_' + 16hex
  project_id          TEXT NOT NULL REFERENCES projects(id),
  channel_link_id     TEXT NOT NULL REFERENCES project_channel_links(id),
  source              TEXT NOT NULL,
  external_message_id TEXT NOT NULL,           -- 手動貼り付けは 'manual_{ts}_{8hex}' を生成
  sender_role         TEXT NOT NULL,           -- internal | engineer | customer | unknown
  sender_account_id   TEXT NOT NULL DEFAULT '',
  sender_display_name TEXT NOT NULL DEFAULT '',
  visibility          TEXT NOT NULL,           -- public | internal
  visibility_source   TEXT NOT NULL DEFAULT 'auto', -- auto | manual（manualは同期で上書きしない）
  body                TEXT NOT NULL,           -- マスク済み本文のみ保存。原文は保存しない
  masked              INTEGER NOT NULL DEFAULT 0,   -- マスクが1箇所でも発動したら1
  sent_at             INTEGER NOT NULL,        -- epoch ms
  created_at          INTEGER NOT NULL,
  UNIQUE(source, external_message_id)
);
CREATE INDEX idx_messages_project_time ON messages(project_id, sent_at);
CREATE INDEX idx_messages_visibility   ON messages(project_id, visibility, sent_at);
