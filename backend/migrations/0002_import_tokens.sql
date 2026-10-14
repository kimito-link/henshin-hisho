-- 外部連携（Chrome拡張「りんくのAI返信秘書」等）からのメッセージ取り込み用トークン。
-- 設計: docs/PROJECT-AI-IMPLEMENTATION-HANDOFF.md 継続。ランサーズ等API無しサービスの
-- 手動貼り付けを、拡張側で既に抽出済みのデータの一括送信に置き換えるための入口。
--
-- requireAuth（セッション認証）とは別軸。プロジェクトの持ち主だけが発行・失効でき、
-- トークン自体はプロジェクトIDに紐づく（ユーザーIDには紐づけない＝プロジェクト単位で
-- 個別に無効化できる）。有効期限は持たない（Phase1）。

CREATE TABLE project_import_tokens (
  token      TEXT PRIMARY KEY,           -- 'impt_' + 32hex
  project_id TEXT NOT NULL REFERENCES projects(id),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER                      -- NULL=有効。失効はUPDATEで打つ（行を消さない＝監査用）
);
CREATE INDEX idx_import_tokens_project ON project_import_tokens(project_id);
