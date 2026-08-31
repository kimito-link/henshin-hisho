# 案件統合AI秘書機能 セットアップ手順

設計・実装済みの機能を実際に動かすための手順。実装内容は[PROJECT-AI-IMPLEMENTATION-HANDOFF.md](PROJECT-AI-IMPLEMENTATION-HANDOFF.md)参照。

## 1. D1データベースを作る

```bash
wrangler d1 create henshin-hisho-projects
```

出力される `database_id` を`wrangler.toml`に追記する:

```toml
[[d1_databases]]
binding = "PROJECT_DB"
database_name = "henshin-hisho-projects"
database_id = "<ここに発行されたID>"
```

## 2. マイグレーションを適用する

```bash
wrangler d1 migrations apply henshin-hisho-projects --remote
```

## 3. Secretsを設定する

```bash
wrangler secret put CHATWORK_API_TOKEN
```

Chatworkの「API Token発行」ページ（Chatwork管理画面の「サービス連携」→「API Token」）で発行したトークンを貼り付ける。

## 4. デプロイする

```bash
wrangler deploy
```

## 5. internal_staffを登録する（運営者本人・エンジニア）

Phase 1は管理UIを作っていないため、curlとAPIで直接登録する。

### 5-1. 運営者本人のChatwork account_idを調べる

```bash
curl -H "x-chatworktoken: $CHATWORK_API_TOKEN" https://api.chatwork.com/v2/me
```

レスポンスの`account_id`を控える。

### 5-2. エンジニア（例: corehei）のaccount_idを調べる

対象のChatworkルーム（グループまたは個別チャット）のroom_idを使う。room_idはChatworkのURL（`https://www.chatwork.com/#!rid44616...`の`rid`の後ろの数字）から分かる。

```bash
curl -H "x-chatworktoken: $CHATWORK_API_TOKEN" https://api.chatwork.com/v2/rooms/{room_id}/members
```

一覧から該当エンジニアの`account_id`を控える。

### 5-3. staff登録APIを呼ぶ

`{SESSION_TOKEN}`は`POST /auth/login`で取得したBearerトークン。

```bash
# 運営者本人
curl -X POST https://<worker-url>/projects/staff \
  -H "Authorization: Bearer {SESSION_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"source":"chatwork","sourceAccountId":"<運営者のaccount_id>","staffRole":"operator","displayName":"君斗りんく"}'

# エンジニア
curl -X POST https://<worker-url>/projects/staff \
  -H "Authorization: Bearer {SESSION_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"source":"chatwork","sourceAccountId":"<coreheiのaccount_id>","staffRole":"engineer","displayName":"corehei"}'
```

## 6. andstory.jp案件を作る（PoC）

```bash
# 案件作成
curl -X POST https://<worker-url>/projects \
  -H "Authorization: Bearer {SESSION_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"andstory.jp サイト切り替え","summary":"WordPressからJimdoへの移行"}'
# → project.id を控える（例: proj_xxxx）

# Chatworkグループ（andstory.jp、mixed=顧客予算とエンジニア原価が混在するため）
curl -X POST https://<worker-url>/projects/{project_id}/channels \
  -H "Authorization: Bearer {SESSION_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"source":"chatwork","externalConversationId":"<andstory.jpグループのroom_id>","counterpartRole":"mixed","label":"andstory.jp グループ"}'

# Chatwork corehei個別チャット（エンジニア窓口）
curl -X POST https://<worker-url>/projects/{project_id}/channels \
  -H "Authorization: Bearer {SESSION_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"source":"chatwork","externalConversationId":"<coreheiとの個別チャットのroom_id>","counterpartRole":"engineer","label":"corehei"}'

# ココナラ（顧客窓口、APIが無いので手動チャネルとして登録）
curl -X POST https://<worker-url>/projects/{project_id}/channels \
  -H "Authorization: Bearer {SESSION_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"source":"coconala","externalConversationId":"manual:coconala:1","counterpartRole":"customer","label":"ココナラ見積り相談"}'
```

## 7. Chatworkメッセージを同期する

```bash
curl -X POST https://<worker-url>/projects/{project_id}/sync \
  -H "Authorization: Bearer {SESSION_TOKEN}"
```

## 8. ココナラのやり取りを手動で貼り付ける

`channelLinkId`は手順6のレスポンスから取得したココナラチャネルのID。

```bash
curl -X POST https://<worker-url>/projects/{project_id}/messages/manual \
  -H "Authorization: Bearer {SESSION_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"channelLinkId":"<coconalaチャネルのid>","senderRole":"customer","senderDisplayName":"ANDSTORY","body":"予算は3万円程度です"}'
```

## 9. AIに聞いてみる

```bash
# 現状把握
curl -X POST https://<worker-url>/projects/{project_id}/assist \
  -H "Authorization: Bearer {SESSION_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"mode":"status"}'

# 発言照合（食い違い検出）
curl -X POST https://<worker-url>/projects/{project_id}/assist \
  -H "Authorization: Bearer {SESSION_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"mode":"reconcile"}'

# 顧客向け返信案
curl -X POST https://<worker-url>/projects/{project_id}/assist \
  -H "Authorization: Bearer {SESSION_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"mode":"draft_reply","intent":"見積り金額の調整について回答する"}'
```

`result.text`にエンジニア原価等のinternal情報が一切含まれていないことを必ず目視確認する（PoC成功条件の一部）。

## トラブルシューティング

- `{"ok":false,"reason":"d1_not_configured"}` → 手順1・2が未完了。
- `{"ok":false,"reason":"llm_not_configured"}` → `OPENROUTER_API_KEY`が未設定。
- Chatwork同期で`chatwork_status_401` → `CHATWORK_API_TOKEN`が無効・未設定。
