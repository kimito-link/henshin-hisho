# 案件統合AI秘書機能 実装ハンドオフ（Phase 1 / andstory.jp PoC）

**この1枚だけで着手できます。** 設計の要約は同ディレクトリの[PROJECT-AI-DESIGN.md](PROJECT-AI-DESIGN.md)を参照（Fable設計・司令塔統合済み、2026-08-31）。

実装先リポジトリの実ファイル（`index.js` / `schema.js` / `kv.js` / `connectors/line.js` / `llm.js` / `auth.js` / `wrangler.toml`）を読了した上での設計。裏取りで確定した前提を先に列挙する。

## コード裏取りで確定した前提（会議素材との差分）

- `wrangler.toml` に **D1バインディングはまだ無い**（KVのみ）。D1導入はバインディング追加＋マイグレーションから始まる。
- `llm.js` の `callOpenRouter` は **`messages: [{role:'user'}]` 単発のみ対応**（system role非対応）。プロンプトは1本のuserPrompt文字列に畳む設計にする（`llm.js` は改造しない）。
- `requireAuth(request, env)` は `{ ok, token, user }` を返す。`user.id` でスコープする。
- ルーティングは `index.js` のフラットなif連鎖＋`inboxRouteMatch` 方式。CORS/JSONは `http.js` の `jsonResponse`/`readJson` が正本（コピー禁止のコメントあり）。
- `scheduled()` は毎時cron（`0 * * * *`）で digest / weekly-report を回している。ここにChatwork同期を**try/catchで包んで**追加する。
- 既存KVキーは `users:` `email-index:` `session:` `magic:` `inbox:{userId}:` `line-user:` `diag:unmatched-origin:`。新機能はこれらに一切触れない。

---

## A. 理想の動作フロー

Chatworkは毎時cron（＋手動 `POST /projects/:id/sync`）で自動取り込み、ココナラ/ランサーズは手動貼り付けAPIで取り込み、全メッセージは取り込み時に senderRole / visibility / マスクを確定してD1に永続化される。ユーザーが `POST /projects/:id/assist` を叩くと、AIが案件の全時系列（内部/公開のタグ付き）を読んで「事実と推測を分離した状況照合」と「公開情報のみを引用した返信案」を返す。

---

## B. D1×KVハイブリッド構成

**線引きの原則**: 「多対多・visibility別フィルタ・案件横断検索が要る関係データ＝D1が唯一の正本」「秘密情報＝Cloudflare Secrets（Phase 1はDB/KVに一切置かない）」「KVは既存機能専用のまま新規キーを増やさない」。

### 結論

| データ | 置き場所 | 理由 |
|---|---|---|
| projects / project_channel_links / internal_staff / messages | **D1**（新規DB `henshin-hisho-projects`、binding `PROJECT_DB`） | WHERE句フィルタ・JOIN・横断検索が必須。KVはプレフィックス一致のみで不適 |
| Chatwork同期カーソル | **D1**（`project_channel_links.sync_cursor` 列） | チャネルに1:1で紐づく状態。KVに分離すると整合性管理が二重になる |
| Chatwork APIトークン | **Cloudflare Secrets**（`wrangler secret put CHATWORK_API_TOKEN`） | Phase 1は運営者1人のPoC。DBに置かなければ「平文でDBに保存しない」制約を最も安全に満たす。AES-GCM暗号化してKVに置く方式は**マルチユーザー化するPhase 2で導入**（鍵は `CONNECTOR_ENC_KEY` としてSecretsに別置き、暗号文はKV `connector-secret:{userId}:{source}`） |
| KVキャッシュ層（`project_members:{projectId}` 等） | **Phase 1では作らない** | 1案件・1ユーザーでD1直読みのレイテンシは問題にならない。計測前の最適化は過剰設計 |

### wrangler.toml 追記（既存記述は変更しない）

```toml
[[d1_databases]]
binding = "PROJECT_DB"
database_name = "henshin-hisho-projects"
database_id = "<wrangler d1 create henshin-hisho-projects で発行されるID>"
```

実際は `backend/migrations/0001_project_ai.sql` を置き `wrangler d1 migrations apply henshin-hisho-projects --remote` で適用（wranglerのデフォルト規約に従い、独自ディレクトリ設定はしない）。

### D1スキーマ（`backend/migrations/0001_project_ai.sql` 全文）

```sql
CREATE TABLE projects (
  id         TEXT PRIMARY KEY,              -- 'proj_' + 16hex
  user_id    TEXT NOT NULL,                 -- KV users:{id} のid（D1側にusersは持たない）
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active',-- active | closed
  summary    TEXT NOT NULL DEFAULT '',      -- 案件カルテ（マスク済みテキスト、手動編集可）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_projects_user ON projects(user_id, status);

CREATE TABLE project_channel_links (
  id                       TEXT PRIMARY KEY,   -- 'chan_' + 16hex
  project_id               TEXT NOT NULL REFERENCES projects(id),
  source                   TEXT NOT NULL,      -- chatwork | coconala | lancers | line | manual
  external_conversation_id TEXT NOT NULL,      -- chatwork room_id 等。手動チャネルは 'manual:{source}'
  label                    TEXT NOT NULL DEFAULT '',
  counterpart_role         TEXT NOT NULL,      -- customer | engineer | mixed
  default_visibility       TEXT NOT NULL,      -- public | internal（counterpart_roleから導出して保存）
  description_masked       TEXT NOT NULL DEFAULT '', -- Chatwork概要欄（マスク済み）
  sync_cursor              TEXT NOT NULL DEFAULT '', -- 最後に処理したmessage_id
  created_at               INTEGER NOT NULL,
  UNIQUE(source, external_conversation_id)
);

CREATE TABLE internal_staff (
  id                TEXT PRIMARY KEY,          -- 'staff_' + 16hex
  user_id           TEXT NOT NULL,             -- 登録した運営者
  source            TEXT NOT NULL,             -- chatwork | coconala | lancers | line
  source_account_id TEXT NOT NULL,             -- Chatworkのaccount_idを文字列で
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
  body                TEXT NOT NULL,           -- ★マスク済み本文のみ保存。原文は保存しない
  masked              INTEGER NOT NULL DEFAULT 0,   -- マスクが1箇所でも発動したら1
  sent_at             INTEGER NOT NULL,        -- epoch ms
  created_at          INTEGER NOT NULL,
  UNIQUE(source, external_message_id)
);
CREATE INDEX idx_messages_project_time ON messages(project_id, sent_at);
CREATE INDEX idx_messages_visibility   ON messages(project_id, visibility, sent_at);
```

**visibilityの意味論**: `public` = 「顧客が既に見ている/顧客に見せてよい会話に由来」、`internal` = 「エンジニア原価・内部相談・認証情報など顧客向け出力に出してはならない」。重複排除は `UNIQUE(source, external_message_id)` ＋ `INSERT ... ON CONFLICT DO NOTHING` で担保（同期の冪等性はカーソルではなくこのUNIQUEが正本。カーソルはAPI節約の最適化にすぎない）。

---

## C. visibility二段階防御の関数群

新規ファイル `backend/src/projects/visibility.js`。**第1段=取り込み時に確定して永続化、第2段=取得時にSQL WHEREで再フィルタ。AIプロンプトは防御に数えない**（出力後の正規表現マスクは万一の保険であり主防御にしない、という会議結論を採用）。

### 第1段: 取り込み時決定

```js
// senderRole判定（D節で詳述）。db参照はしない純関数にするため、staffは事前ロードして渡す
export function decideSenderRole({ source, senderAccountId, channelLink, staffMap }) {
  // staffMap: Map<`${source}:${accountId}`, {staff_role}>
  const staff = staffMap.get(`${source}:${String(senderAccountId)}`);
  if (staff) return staff.staff_role === 'engineer' ? 'engineer' : 'internal';
  if (channelLink.counterpart_role === 'customer') return 'customer';
  if (channelLink.counterpart_role === 'engineer') return 'engineer';
  return 'unknown'; // mixedルームの未登録者
}

export function decideVisibility({ senderRole, channelLink }) {
  // ルール1: 顧客窓口ルームは全発言public（顧客が既に見ている情報だから。
  //          自分の発言もエンジニアが顧客ルームに書いた発言もpublic）
  if (channelLink.counterpart_role === 'customer') return 'public';
  // ルール2: エンジニア窓口ルームは全発言internal（原価・内部相談の器）
  if (channelLink.counterpart_role === 'engineer') return 'internal';
  // ルール3: mixed（同一ルーム内混在の実演ケース）はfail-closedで全件internal。
  //          公開してよい発言だけ事後修正APIでpublicへ昇格する。
  //          誤りの向きが「漏らす」ではなく「引用を控える」側に倒れるのが要点。
  return 'internal';
}
```

**実演2ケースへの適合**: 「同じsource(chatwork)で相手が顧客/エンジニアと変わる」→ visibilityはsourceではなく `project_channel_links.counterpart_role`（ルーム単位の登録値）で決まるので破綻しない。「同一ルーム内に予算と原価が混在」→ そのルームは `counterpart_role='mixed'` で登録し、既定internal＋メッセージ単位の手動昇格で対応。ルーム単位の一律決め打ちをやめ、**既定はルーム、例外はメッセージ**の2層にするのが結論。

### 第2段: 取得時SQLフィルタ（`backend/src/projects/db.js`）

```js
// audience: 'owner'（運営者UI・AI状況把握用＝全件） | 'customer_facing'（顧客向け引用候補＝publicのみ）
export async function fetchProjectMessages(db, { projectId, audience, limit = 100 }) {
  const base = `SELECT m.*, c.label AS channel_label, c.source AS channel_source
                FROM messages m JOIN project_channel_links c ON m.channel_link_id = c.id
                WHERE m.project_id = ?1`;
  const sql = audience === 'customer_facing'
    ? `${base} AND m.visibility = 'public' ORDER BY m.sent_at DESC LIMIT ?2`
    : `${base} ORDER BY m.sent_at DESC LIMIT ?2`;
  const { results } = await db.prepare(sql).bind(projectId, limit).all();
  return results.reverse(); // 時系列昇順で返す
}
```

呼び出し規約: **顧客向け返信案の「引用可能な事実」は必ず `audience:'customer_facing'` の結果だけから組み立てる**（assist.js内で公開ログと内部ログを別の変数として持ち、プロンプト内でも別セクションに分ける。E節参照）。

### 事後修正API（誤判定の訂正手段）

```js
// PATCH /projects/:id/messages/:messageId/visibility  body: { visibility: 'public'|'internal' }
export async function patchMessageVisibility(db, { userId, projectId, messageId, visibility }) {
  // 所有権チェックをJOINで同時に行う。visibility_source='manual' を立て、
  // 以後の再同期(ON CONFLICT DO NOTHING)でも上書きされない
  const result = await db.prepare(
    `UPDATE messages SET visibility = ?1, visibility_source = 'manual'
     WHERE id = ?2 AND project_id = ?3
       AND EXISTS (SELECT 1 FROM projects p WHERE p.id = ?3 AND p.user_id = ?4)`
  ).bind(visibility, messageId, projectId, userId).run();
  return { ok: result.meta.changes === 1 };
}
```

### マスキング（取り込み時・`backend/src/projects/masker.js`）

実演事実4（概要欄にID/パスコード直書き）への対応。**保存前に必ず通す**（原文はD1に残さない）。

```js
const SECRET_PATTERNS = [
  // ラベル密着型: 「パスコード: xxxx」「ID=admin」「pw：xxxx」等（全角コロン対応）
  /((?:パスワード|パスコード|認証コード|pass(?:word|code)?|pw|pin|secret|token|api[-_ ]?key|ID|ｉｄ|ユーザー名|user(?:name)?)\s*[:：=＝]\s*)(\S+)/gi,
  // 長いランダム文字列型: 32文字以上の英数記号連続（APIキー・ハッシュ）。URLは除外
  /(?<!https?:\/\/[^\s]*)\b[A-Za-z0-9_\-]{32,}\b/g
];
export function maskSecrets(text) {
  let masked = false;
  let out = String(text || '');
  out = out.replace(SECRET_PATTERNS[0], (_, label) => { masked = true; return `${label}***`; });
  out = out.replace(SECRET_PATTERNS[1], () => { masked = true; return '***'; });
  return { text: out, masked };
}
```

用途は3箇所: ①メッセージ本文の取り込み時 ②Chatwork概要欄の取り込み時 ③LLM出力の最終サニタイズ（**保険**。会議Q3の結論どおり主防御にはしない）。

---

## D. senderRole判定と internal_staff 設計

判定順序は会議案を採用: **①`internal_staff` に `(source, source_account_id)` 完全一致があれば内部側（`staff_role` で internal/engineer を分岐）→ ②無ければ `project_channel_links.counterpart_role`**。表示名文字列は一切判定に使わない（実演事実5: 同一人物が「君斗りんく」「besttrust」と名乗り分ける）。

会議案からの改良1点: `staff_role` 列を追加した。会議案のまま「internal_staffヒット=internal」にすると、運営者本人とエンジニア（corehei）が同じroleに潰れ、「顧客への提示より先に内部の認識確認を優先」（実演事実7）の照合で誰の発言か区別できなくなるため。

**登録方法（誰が・どうやって）**:

1. 運営者本人のChatwork account_id: `curl -H "x-chatworktoken: $TOKEN" https://api.chatwork.com/v2/me` → `account_id`
2. エンジニア（corehei）のaccount_id: `curl -H "x-chatworktoken: $TOKEN" https://api.chatwork.com/v2/rooms/{room_id}/members` → 一覧から特定
3. 登録は認証付きAPI `POST /projects/staff`（F節参照）。Phase 1は管理UIを作らず、この2つのcurl＋API呼び出しをセットアップ手順としてREADME（`backend/docs/PROJECT-AI-SETUP.md`）に記載する。
4. ココナラ/ランサーズ（APIなし・手動貼り付け）は、貼り付けAPI側で `senderRole` を明示指定させるため internal_staff 登録は不要（Phase 1）。

---

## E. 発言照合プロンプト最終版

`backend/src/projects/assist.js` に定数として置く。`llm.js` の制約（user roleのみ）に合わせ、以下を連結した**1本の文字列**を `callOpenRouter(env, { userPrompt, mode: 'project-assist', maxTokensOverride: 1500, temperatureOverride: 0.3 })` に渡す。

### システム指示部（全文）

```
あなたは受託開発の運営者を支える「案件照合秘書」です。以下の会話ログを読み、依頼された作業を行ってください。

【絶対に守るルール】
1. 金額・納期・作業範囲を自分で確定しない。確定していない事項は「未確定」と明記する。
2. 事実と推測を必ず分ける。ログに書かれていることだけが【事実】。相手の意図の解釈は
   【推測】とし、「〜という受け取り方をしているように見えます」の形で書く。断定しない。
3. 作業範囲の変更・追加がログに現れたら、必ず「金額の前提を再確認すべき」と指摘する。
4. 顧客と内部（運営者・エンジニア）の認識に食い違いの可能性があるときは、
   顧客への提示文より先に「内部で認識を確認する」行動を提案する。
5. 【内部ログ】セクションの内容（原価・内部相談・***でマスクされた情報）は、
   顧客向け返信案の本文に一切含めない。引用してよいのは【公開ログ】の内容だけ。
6. *** はマスク済みの秘匿情報である。復元・推測をしない。

【出力形式】
■ 状況の整理
【事実】（ログの引用。発言者・日付つき）
【推測】（推測である旨を明記した解釈）
■ 食い違い・確認すべき点（金額・範囲・納期。なければ「なし」と書く）
■ 次の一手の提案（内部確認が先か、顧客返信が先かを明示）
■ 顧客向け返信案（依頼が返信案作成のときのみ。公開ログの情報だけで構成）
```

### few-shot部（全文・2例）

```
【例1: 金額の食い違い】
公開ログ: [ココナラ|顧客] 「予算15万円くらいでお願いしたいです」
内部ログ: [Chatwork|エンジニア] 「この内容だと原価で18万はかかります」
良い出力:
■ 食い違い・確認すべき点
【事実】顧客は「予算15万円くらい」と発言（ココナラ）。エンジニアは「原価で18万」と発言（Chatwork）。
【推測】このままでは3万円以上の逆ざやになるように見えます。ただし作業範囲の解釈が
双方で異なる可能性があります。
■ 次の一手の提案
顧客へ金額を提示する前に、エンジニアと作業範囲の内訳を確認することを勧めます。
（顧客向け返信案には18万円という原価情報を含めていない点に注意）

【例2: 作業範囲の変化】
公開ログ: [ココナラ|顧客] 「やっぱりデザインは5ページでなく8ページにしたいです」
良い出力:
■ 食い違い・確認すべき点
【事実】顧客がページ数を5→8に変更したいと発言。
【推測】顧客は現在の見積もり金額のまま8ページになると受け取っているように見えます。
■ 次の一手の提案
ページ数変更は作業範囲の変更です。金額の前提を再確認し、追加費用の要否を
内部で確認してから顧客に回答することを勧めます。
```

### コンテキスト部（`buildAssistPrompt` が生成）

```
【案件カルテ】
案件名: {project.name}
カルテ: {project.summary}
チャネル概要: {各channel_linkの label / description_masked}

【公開ログ】（顧客も見ている会話。返信案で引用してよいのはここだけ）
[{日時}][{source}|{sender_roleの和名}] {sender_display_name}: {body}
...

【内部ログ】（顧客には見せない。照合の材料にのみ使う）
[{日時}][{source}|{sender_roleの和名}] {sender_display_name}: {body}
...

【依頼】
{modeにより:
 status       → 「この案件の現状を出力形式に従って整理してください。」
 reconcile    → 「公開ログと内部ログを照合し、金額・範囲・納期の食い違いを出力形式に従って報告してください。」
 draft_reply  → 「次の意図で顧客向け返信案を作成してください。意図: {intent}。返信案は公開ログの情報だけで構成してください。」}
```

LLM出力は返却前に `maskSecrets()` を通す（保険）。

---

## F. Phase 1 API設計

新規ファイル `backend/src/projects/routes.js` に集約。`index.js` への変更は**importの追加1行＋委譲2行のみ**:

```js
// index.js に追加（既存ルートの後、404の前）
if (url.pathname === '/projects' || url.pathname.startsWith('/projects/')) {
  return await handleProjectsRoute(request, env);
}
```

`handleProjectsRoute` 内部で最初に `requireAuth` → 次に `env.PROJECT_DB` 未バインドなら `{ok:false, reason:'d1_not_configured'}` 503（fail-closed）。レスポンスは全て `http.js` の `jsonResponse(request, env, body, status)` を使う（コピーを作らない）。

| メソッド/パス | 用途 | リクエスト | レスポンス |
|---|---|---|---|
| POST `/projects` | 案件作成 | `{name, summary?}` | `{ok, project}` |
| GET `/projects` | 一覧 | — | `{ok, projects:[...]}` |
| GET `/projects/:id` | 詳細（owner視点・全visibility） | — | `{ok, project, channels:[...], messages:[...最新100件昇順]}` |
| POST `/projects/:id/channels` | チャネル紐付け | `{source, externalConversationId, counterpartRole:'customer'\|'engineer'\|'mixed', label?}` | `{ok, channel}`（default_visibilityはサーバ側で導出） |
| POST `/projects/:id/messages/manual` | ココナラ/ランサーズ貼り付け | `{channelLinkId, senderRole:'internal'\|'customer'\|'engineer', senderDisplayName?, body, sentAt?}` | `{ok, message}`（visibilityは`decideVisibility`で決定。external_message_idは`manual_{ts}_{8hex}`生成） |
| POST `/projects/:id/sync` | Chatwork即時同期 | — | `{ok, synced:[{channelLinkId, fetched, stored}]}` |
| PATCH `/projects/:id/messages/:messageId/visibility` | 事後修正 | `{visibility}` | `{ok}` |
| POST `/projects/:id/assist` | AI照合/返信案 | `{mode:'status'\|'reconcile'\|'draft_reply', intent?}` | `{ok, result:{text, masked:boolean}}` |
| POST `/projects/staff` | internal_staff登録 | `{source, sourceAccountId, staffRole:'operator'\|'engineer', displayName?}` | `{ok, staff}` |
| GET `/projects/staff` | staff一覧 | — | `{ok, staff:[...]}` |

パスマッチは `inboxRouteMatch` と同型の `projectsRouteMatch(pathname)` を routes.js 内に実装（正規表現: `^\/projects\/([^/]+)(?:\/(channels|messages|sync|assist)(?:\/(.+))?)?$` ベースで分岐）。

### Chatworkコネクタ（`backend/src/connectors/chatwork.js`）

```js
const CW_BASE = 'https://api.chatwork.com/v2';
export async function cwGet(env, path, options = {}) { /* x-chatworktoken: env.CHATWORK_API_TOKEN, 204は[]扱い */ }

export async function syncChatworkChannel(env, db, channelLink, staffMap) {
  // 1. GET /rooms/{room_id} → description を maskSecrets → description_masked 更新
  // 2. GET /rooms/{room_id}/messages?force=1 （最新100件）
  // 3. Number(message_id) > Number(sync_cursor) のみ処理（cursorはAPI節約。冪等性はUNIQUEが正本）
  // 4. 各message: maskSecrets(body) → decideSenderRole → decideVisibility →
  //    INSERT ... ON CONFLICT(source, external_message_id) DO NOTHING
  // 5. sync_cursor = 最大message_id で UPDATE
  // 戻り値 {fetched, stored}
}

export async function runChatworkSync(env) {
  // source='chatwork' の全channel_linkを列挙して syncChatworkChannel。
  // staffMapは1回だけロード: SELECT source, source_account_id, staff_role FROM internal_staff
}
```

`index.js` の `scheduled()` に追加（既存2行は触らない）:

```js
try { await runChatworkSync(env); } catch { /* digest/weekly-reportを道連れにしない */ }
```

---

## G. 捨てた案と理由

1. **Durable Objects中心構成**（会議少数意見）— 1MiBメモリ制約・案件横断検索の困難・visibilityフィルタをアプリコードで再実装する羽目になる。会議多数派＋本設計のSQL要件からD1一択。
2. **visibilityのAI都度判定** — プロンプト汚染・非決定的出力で防御にならない。取り込み時確定＋SQL再フィルタの決定論的二段階を採用。
3. **表示名文字列によるsenderRole判定** — 実演事実5で破綻確認済み。`(source, source_account_id)` ホワイトリストのみ。
4. **出力後正規表現マスクを主防御にする** — visibility設計が主防御。正規表現は誤検知・見逃し両方あるため「保険」に格下げ（会議Q3の結論どおり）。
5. **ChatworkトークンのAES-GCM暗号化KV保存（Phase 1で）** — 1ユーザーPoCではCloudflare Secrets直置きが最も安全かつ最小。暗号化保存はマルチユーザー化（Phase 2）まで先送り。
6. **KVキャッシュ層（`project_members:` 等）** — 1案件では計測前の最適化。Phase 2で必要になったら導入。
7. **Chatwork Webhook受信** — リアルタイム性はPoCに不要。署名検証実装が増えるだけ。毎時cron＋手動syncで足りる。Phase 2候補。
8. **手動貼り付けAPIの廃止** — ココナラ/ランサーズはAPIが無く、貼り付け以外に取り込み手段がないため残す。
9. **`messages` に原文列を持つ案** — 認証情報が実際に流れてくる実例（事実4）がある以上、原文保存はD1自体を漏洩点にする。マスク済みのみ保存。

---

## H. 地雷と回避策

1. **D1バインディング忘れ**: マイグレーション未適用/バインド無しでも既存機能は無傷（新ルートだけが503 `d1_not_configured` を返すfail-closed）。デプロイ手順は「`wrangler d1 create` → toml追記 → `migrations apply --remote` → deploy」の順を厳守。
2. **Chatwork `force=0` の罠**: 「未取得分だけ返す」は同一トークンの他クライアント利用で欠落する。必ず `force=1`＋自前カーソル＋UNIQUE重複排除。
3. **Chatworkレート制限（300req/5min）**: 毎時cronで全チャネル同期なら余裕だが、手動syncの連打に備えハンドラ内で1リクエスト=チャネル数+ルーム数×2程度に収まることを確認済みの構成にする（ページングしない・最新100件のみ）。
4. **`llm.js` はsystem role非対応**: 改造せず単一userPromptに畳む（本設計は畳み済み）。改造すると既存inbox/draft機能に波及する。
5. **mixedルームの過剰internal化**: fail-closedの代償として返信案の引用材料が痩せる。これは仕様（漏らすより控える）。運用でカバー: assist結果に「引用可能な公開ログが少ない」旨が出たら `PATCH .../visibility` で昇格。
6. **`deleteUserData`（kv.js）はD1を消さない**: 既存関数は変更しない制約を守るため、Phase 1ではアカウント削除時にD1の案件データが残る。PoCは運営者本人のみなので許容し、Phase 2でD1カスケード削除を**別関数として追加**（kv.jsは触らない）してindex.jsの`deleteAccount`から呼ぶ。
7. **概要欄の再同期で手動編集が消える**: `description_masked` は同期のたび上書きされる。案件カルテとして手で育てるテキストは `projects.summary`（同期が触らない列）に分離済み。混同しない。
8. **マスク正規表現の過剰マッチ**: 32文字連続英数はURL断片に誤爆しうるため負の先読みでURL除外済み。それでも誤爆したら「保存済み本文は復元不能」— 取り込み前にパターン変更をテストで検証する（`masker.test.js` を最初に書く）。
9. **手動貼り付けの重複**: external_message_idを毎回生成するため同文を2回貼ると2件入る。Phase 1は許容（削除は `PATCH` 追加より、D1コンソールで直接消す運用でよい）。
10. **`scheduled()` の例外伝播**: Chatwork API障害で digest / weekly-report を止めない。try/catch必須（F節のコード形を厳守）。

---

## Phase 2（簡潔に、今回は実装しない）

マルチユーザー化（トークンAES-GCM+KV保存）、Chatwork Webhookでリアルタイム化、案件横断AI（`SELECT project_id, MAX(sent_at) FROM messages GROUP BY project_id` で3日以上停滞案件を毎時検出→既存digestに合流。ランサーズ滞留の実害=実演事実6への本命機能）、KVキャッシュ層、ココナラ/ランサーズのメール通知経由半自動取り込み。

## 実装ファイル一覧（新規/変更）

- 新規: `backend/migrations/0001_project_ai.sql` / `backend/src/projects/routes.js` / `backend/src/projects/db.js` / `backend/src/projects/visibility.js` / `backend/src/projects/masker.js` / `backend/src/projects/assist.js` / `backend/src/connectors/chatwork.js` / `backend/docs/PROJECT-AI-SETUP.md`
- 変更（最小差分）: `backend/wrangler.toml`（D1ブロック追加）/ `backend/src/index.js`（import 1行＋/projects委譲＋scheduledにtry/catch 1行）
- 変更禁止: `auth.js` / `kv.js` / `schema.js` / `llm.js` / `connectors/line.js` / `inbox.js` / `http.js`

## 機械的な完了判定

- [ ] `wrangler d1 create henshin-hisho-projects` 実行、`database_id`取得
- [ ] `wrangler.toml`にD1ブロック追記
- [ ] `migrations/0001_project_ai.sql`作成、`wrangler d1 migrations apply henshin-hisho-projects --remote`実行
- [ ] `masker.test.js`を先に書き、SECRET_PATTERNSの過剰マッチ・見逃しを実データ（実演で見た概要欄の文言）で検証
- [ ] `visibility.js`の`decideSenderRole`/`decideVisibility`を上記3ルール（customer/engineer/mixed）で単体テスト
- [ ] `POST /projects/staff`でoperator（運営者本人）とengineer（corehei）のaccount_idを登録
- [ ] `POST /projects`でandstory.jp案件を作成
- [ ] `POST /projects/:id/channels`でChatworkグループ・corehei個別チャット・ココナラ（source='coconala', external_conversation_id='manual:coconala'）を登録
- [ ] `POST /projects/:id/sync`でChatwork実データを取り込み、`messages`テーブルにvisibility正しく入っているか確認
- [ ] `POST /projects/:id/messages/manual`でココナラの実際のやり取りを貼り付け
- [ ] `POST /projects/:id/assist`（mode: status/reconcile/draft_reply）を実行し、PoC成功条件（現状把握・次のアクション・顧客向け返信案・エンジニア向け返信案）を満たすか確認
- [ ] 顧客向け返信案（`draft_reply`）にエンジニア原価等のinternal情報が一切含まれないことを目視確認

## 次のアクション
このハンドオフを次チャット（または本チャット継続）で読み、機械的な完了判定の順に実装する。
