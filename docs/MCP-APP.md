# 返信の作成カード（MCP Apps）

`chatgpt-app/` は、会話の中にメールの作成カードを出す MCP サーバーです。ChatGPT、Claude、Grok など、MCP Apps を描画するホストでは同じカードを出します。描画しないホストには、宛先・件名・本文・候補のテキストを返します。

カードは、件名を見出しにし、右上にコピー、外部で開く、青い「送信」を置きます。その下に差出人、宛先、件名、本文があります。本文の上に、相手の気持ち（分類と点数）付きの候補があります。候補を押すと本文が入れ替わります。欄はカードの中で編集できます。送信は「送信」を押したときだけです。押すまでは「このメールは未送信です。」です。

料金ページは `/price/` です。`www` は付けません。公開ホストの http は https へ転送します。

特許の対応は [PATENT-MAPPING.md](PATENT-MAPPING.md) です。出願番号は `chatgpt-app/src/reply.js` の `PATENT_APPLICATIONS` です。

## 調査したクライアント

2026-10-22 に公開文書を確認しました。

| クライアント | カード | 接続 |
| --- | --- | --- |
| ChatGPT | MCP Apps を実装済み。`_meta.ui.resourceUri` と `ui/*`。互換として `_meta["openai/outputTemplate"]` と `window.openai` も付ける | 開発者モードのカスタム MCP、またはアプリ提出 |
| Claude（claude.ai のウェブとデスクトップ） | MCP Apps を実装済み。`ui://` と `text/html;profile=mcp-app` | リモートコネクタ。OAuth は 401 と protected resource metadata、S256 の PKCE、動的クライアント登録 |
| Claude Code | テキストだけ。カードは出ない | 同じ `/mcp`。ツール結果の本文を使う |
| Grok | カスタム MCP コネクタは公開手順がある（grok.com/connectors → Custom）。コネクタ付属のカードは Grok Bot の一部コネクタで出る、と変更履歴にある。xAI の文書は、このサーバーの `ui://` を Grok が描画するとまでは書いていない | カスタムコネクタに `/mcp` を入れる。カードが出ない場合も、テキストの宛先・件名・本文は返る |
| Goose、VS Code | MCP の公開記事が MCP Apps 対応としている | リモート MCP として `/mcp` |

MIME は、安定版の MCP Apps（2026-01-26、`io.modelcontextprotocol/ui`）が必須とする `text/html;profile=mcp-app` です。古い呼び方の `text/html+mcp` は使いません。

## プロバイダ

`kimito-link/linebot` はこの環境の GitHub トークンから読めませんでした（リポジトリは非公開で 404）。公開プロフィールにはリポジトリ名 `linebot` があります。ソースを見ずに設定名を作っていないので、オーナーが確定した経路だけを接続しています。

| 経路 | linebot での根拠 | このアプリ |
| --- | --- | --- |
| Gmail 送信 | オーナー指定。プロジェクト `kimito-talk-oauth`、クライアント ID `899798982543-2jk3d2fp97c02js71opg7l1j9fa7oh5a.apps.googleusercontent.com`、スコープは `gmail.send` + `openid` + `userinfo.email` だけ | 接続済み。差出人に「Gmail」とアドレスを出す。送信は `users/messages/send` |
| Cloudflare Email Routing への転送（受信） | オーナー指定。受信は Gmail API では読まず、自動転送で届く（linebot の `packages/db/src/email-threads.ts`） | 接続済み。`POST /incoming/forward` で取り込み、`list_incoming` / `get_incoming` に出す |
| 貼り付け | このアプリの既存の入力 | 接続済み。`propose_replies` |
| Outlook / Microsoft Graph、SMTP、IMAP、Resend、Cloudflare `send_email` での送信 | ソースが読めず、設定名を確認できなかった | 未接続。確認できてから、同じ設定名でプロバイダを足す |

`gmail.readonly`、`gmail.compose`、`gmail.modify` は同意画面に出しません。下書き保存はアプリの KV だけで、Gmail の下書きにはしません。

送信の直前には、保存した宛先・件名と、受信レコードのハッシュを取り直します。違えば送らず、もう一度「送信」を求めます。受信箱を Gmail API で読み直すことはしません。

## 候補の本文

アプリ側の無料枠・お試し・有料回数（`consumeGeneration`）を先に見ます。通ったときだけ、backend の `POST /internal/reply-drafts` を呼びます。その中で `costGuard` が通り、`generateDraftBody` が本文を作ります。回数切れ、原価切れ、LLM 失敗、未設定のときは、いまの定型文に戻します。気持ちの分類は定型の規則のままです。

## ローカル

```bash
cd chatgpt-app
npm test
npx wrangler dev
```

- `http://127.0.0.1:8787/price/`
- `http://127.0.0.1:8787/preview/reply-form/`

## ホストへの接続

どのホストでも、登録する URL はリダイレクト後の `https://<ホスト>/mcp` です。`www` や別ホストへの 308 は、Authorization が落ちることがあります。

### ChatGPT

1. Worker を https で公開する。
2. 開発者モードでカスタム MCP を追加する。メニュー名は製品側で変わることがあります。
3. 接続先は `https://<ホスト>/mcp`。
4. `MCP_ACCESS_TOKEN` を置いた場合は Bearer に入れる。本番で OAuth にする場合は `MCP_AUTH_REQUIRED=1`。
5. 新しいチャットで、「このメールに返信して」と頼む。
6. ツールを変えたあとは接続を読み込み直す。

### Claude

1. 設定のコネクタで、リモート MCP として `https://<ホスト>/mcp` を追加する。
2. 未認証の呼び出しは 401 で、`WWW-Authenticate` が `/.well-known/oauth-protected-resource/mcp` を指します。
3. 認可サーバーのメタデータは `/.well-known/oauth-authorization-server` です。`code_challenge_methods_supported` は `S256`、登録は `POST /oauth/register` です。
4. 同意画面で `MCP_OAUTH_CONSENT_KEY` を入れます。許可しても、メールはカードの「送信」まで送られません。
5. Claude Code はカードを描画しません。ツール結果の「宛先」「件名」「本文」を使います。

### Grok

1. grok.com/connectors で New Connector → Custom。
2. URL は `https://<ホスト>/mcp`。認証を求められたら、上の OAuth か Bearer を使う。
3. カードが出るかどうかは、Grok 側の MCP Apps 対応に依存します。出ないときもテキストの宛先・件名・本文は返します。

### その他

Goose や VS Code のように MCP Apps を話すホストは、同じ `/mcp` と `ui://henshin-hisho/reply-form.html` を使います。

## オーナーが Google Cloud で行うこと

既存のクライアントは linebot のものです。新しいクライアントは作りません。

同意画面のプロジェクトは `kimito-talk-oauth` です。クライアント ID は次です。

`899798982543-2jk3d2fp97c02js71opg7l1j9fa7oh5a.apps.googleusercontent.com`

すでに許可されているドメインは `kimitotalk.link` です。リダイレクト URI は、いま linebot が使っている `https://kimitotalk.link/auth/google/callback` です。この Worker が認可コードを受け取るには、次を追加します。

1. 承認済みのリダイレクト URI に `https://reply.kimitotalk.link/oauth/google/callback` を追加する。
2. `reply.kimitotalk.link` の DNS を、この Worker に向ける。
3. スコープは増やさない。`openid`、`https://www.googleapis.com/auth/userinfo.email`、`https://www.googleapis.com/auth/gmail.send` のままにする。`gmail.readonly` / `gmail.compose` / `gmail.modify` は追加しない。
4. Verification Center で `gmail.send` の審査状態を確認する。linebot の文書では、完了した証拠はまだ無い、とオーナーから聞いています。この環境からはその文書を読めなかったので、コンソールで再確認してください。
5. 秘密はリポジトリに置かず、linebot と同じクライアント秘密をこの Worker に入れます。

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put OAUTH_ADMIN_KEY
npx wrangler secret put INCOMING_FORWARD_TOKEN
npx wrangler secret put MCP_OAUTH_CONSENT_KEY
```

任意で、接続してよい Gmail を固定するときは `ALLOWED_GMAIL` を vars に書きます。

接続の開始は、ブラウザで次を開きます。

`https://reply.kimitotalk.link/oauth/google/start?key=<OAUTH_ADMIN_KEY>`

転送メールを取り込む Worker は、届いた JSON を次へ POST します。ヘッダは `x-incoming-token` です。

`https://reply.kimitotalk.link/incoming/forward`

本文は `from`、`subject`、`body` です。プロバイダは `email_routing` として保存します。

### LLM

backend に、原価ガード用の利用者と共有鍵を置きます。

```bash
npx wrangler secret put INTERNAL_DRAFT_TOKEN
```

このアプリ側には `BACKEND_URL`、`INTERNAL_DRAFT_TOKEN`、`DRAFT_SERVICE_USER_ID` を置きます。どれかが無いときは定型文のまま動きます。

### KV、Stripe、本番の認証

KV の id、Stripe、`MCP_ACCESS_TOKEN` は従来どおりです。本番では `MCP_AUTH_REQUIRED=1` にすると、Bearer（固定トークンか、このサーバーが発行した OAuth アクセストークン）が無い `/mcp` は 401 になります。

```bash
npx wrangler kv namespace create CHATGPT_KV
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_PRICE_ID
npx wrangler secret put MCP_ACCESS_TOKEN
```

`wrangler.toml` の KV id がゼロのままでは、しおり、受信、送信前の状態、Gmail のリフレッシュトークンを保存できません。
