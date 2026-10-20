-- 原価ガード（src/cost-guard.js）のカウンタ。設計: docs/COST-GUARD.md。
-- 1行 = 1つの上限（利用者ごとの回数 / 全体の日次予算ミリドル）。
-- ★積むのは1文の UPSERT … RETURNING（原子的）。KV は読んでから書くので同時2件が両方通るため使わない。
-- ★このテーブルが無いと costGuard は fail-closed で AI を全停止する（デプロイ前に適用すること）。
--   key 例: 'budget:llm:trial:2026-10-19' / 'budget:llm:paid:2026-10-19' / 'user:<id>:trial' / 'user:<id>:active:2026-10'
CREATE TABLE cost_counters (
  key        TEXT PRIMARY KEY,
  value      INTEGER NOT NULL,
  expires_at INTEGER NOT NULL            -- unix秒。期限切れ行は参照されない（キーに日付・月を含むため）。掃除は任意
);
