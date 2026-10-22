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

受信は、どのプロバイダも同じです。利用者が自分のメールを `reply@kimitotalk.link` へ自動転送し、Cloudflare Email Routing がこの Worker の `email()` に渡します。`notify@kimitotalk.link` は linebot の宛先のままにし、この Worker には向けません。`handleIncomingEmail` が PostalMime で解析し、`x-forwarded-for` のアドレスを転送した本人として `email_threads` に残します。封筒の From が `reply@` または `notify@` だけのときは、その転送先を本人としては保存しません。保存するのは message-id、宛先、件名、短い引用だけです。本文は保存しません。`email()` は例外を外に出さないので、失敗してもバウンスしません。

送信は二つだけです。

1. Gmail と Google Workspace は Gmail API の `users.messages.send` です。スコープは `https://www.googleapis.com/auth/gmail.send`、`openid`、`email` です。送る直前に userinfo で差出人を取り直し、接続したアドレスと違うときは送りません。
2. それ以外は、Workers の `cloudflare:sockets` で話す自前の SMTP です。587 は STARTTLS、465 は最初から TLS です。パスワードが `oauth2:` で始まるときは AUTH XOAUTH2、そうでなければ AUTH PLAIN です。送れたあとに IMAP で利用者の送信済みへ APPEND し、Message-ID を `sent_ids` に足します。DATA のあとで接続が切れたときは、届いたか分からないので再送しません。カードにもその旨を出し、再送ボタンは出しません。

使わないもの: Cloudflare の `send_email` バインディング（確認済み宛先にしか送れない）、`message.reply()`、Resend、MailChannels、Microsoft Graph の sendMail。

差出人は利用者が選びません。アドレスのドメインで決め、決まらないときだけ Cloudflare DoH の MX を見ます。結果は `mail_app_links.provider` に保存します。カードの差出人行は「プロバイダ名 · アドレス」です。未接続なら「未連携」と接続リンクです。

| プロバイダ | 送信 | サーバ |
| --- | --- | --- |
| Gmail | Gmail API | アプリパスワードは使わない |
| Google Workspace | Gmail API（MX が `aspmx.l.google.com`） | 同上 |
| iCloud | SMTP | `smtp.mail.me.com:587` STARTTLS / `imap.mail.me.com:993`。アプリパスワード |
| Microsoft | OAuth が有効なときだけ SMTP XOAUTH2。無効なら受信だけ | `smtp.office365.com:587` STARTTLS / `outlook.office365.com:993` |
| Yahoo!メール | SMTP | `smtp.mail.yahoo.co.jp:465` / `imap.mail.yahoo.co.jp:993` |
| Yahoo | SMTP | `smtp.mail.yahoo.com:465` / `imap.mail.yahoo.com:993` |
| ドコモメール | SMTP | `smtp.spmode.ne.jp:465` / `imap.spmode.ne.jp:993`。ログイン名はメールアドレスではなく dアカウント ID |
| ソフトバンク（@softbank.ne.jp） | SMTP | `smtp.softbank.ne.jp:465` / `imap.softbank.ne.jp:993`（[持ち運び設定](https://www.softbank.jp/mobile/service/mail-address-portability/mms/)） |
| Eメール(i)（@i.softbank.jp） | SMTP | `smtp.softbank.jp:465` / `imap.softbank.jp:993`（[持ち運び設定](https://www.softbank.jp/mobile/service/mail-address-portability/email-i/)） |
| OCN | SMTP | `smtp.ocn.ne.jp:465` / `imap.ocn.ne.jp:993`（[OCN の設定](https://support.ocn.ne.jp/personal/purpose/detail/pid2990021006/)） |
| BIGLOBE | SMTP | `mail.biglobe.ne.jp` の SMTP 465 / IMAP 993（[BIGLOBE](https://support.biglobe.ne.jp/settei/mailer/imap.html)） |
| So-net | SMTP | `mail.so-net.ne.jp:587` STARTTLS / `imap.so-net.ne.jp:993`（[So-net](https://support.so-net.ne.jp/fa/faq/web/knowledge1687.html)）。IMAP は申し込みが必要 |
| @nifty | SMTP | `smtp.nifty.com:465` / `imap.nifty.com:993`（[@nifty](https://mail.nifty.com/cs/mail-faq/detail/200326000044/)）。送信済みは `Sent`。新規 IMAP は[接続許可](https://mail.nifty.com/cs/mail-info/detail/sg-2nwnbi/)が必要 |
| Zoho | SMTP | `smtp.zoho.com:465` / `imap.zoho.com:993` |
| au、その他 | 入力されたサーバだけ | ポートは 465 か 587。IP アドレスは拒否する |

宛先は、保存したスレッドの Reply-To か From だけを使います。カードやプロンプトに書かれた宛先では送りません。送信の直前に、その宛先のハッシュと件名、本文を取り直します。違えば一度止め、もう一度「送信」を押したときは、取り直したスレッドの宛先へ送ります。

まだ実機で確認していないもの: iCloud からの実際の送信、Microsoft OAuth の同意から送信まで。上のホストは公式ページと仕様に合わせたもので、この環境から各社のサーバへは繋いでいません。テストは偽の SMTP / IMAP です。

`gmail.readonly`、`gmail.compose`、`gmail.modify` は同意画面に出しません。下書き保存はアプリの KV だけで、Gmail の下書きにはしません。

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
3. スコープは `openid`、`email`、`https://www.googleapis.com/auth/gmail.send` だけにする。`gmail.readonly` / `gmail.compose` / `gmail.modify` は追加しない。
4. Verification Center で `gmail.send` の審査状態を確認する。linebot の文書では、完了した証拠はまだ無い、とオーナーから聞いています。この環境からはその文書を読めなかったので、コンソールで再確認してください。
5. 秘密はリポジトリに置かず、linebot と同じクライアント秘密をこの Worker に入れます。

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put OAUTH_ADMIN_KEY
npx wrangler secret put INCOMING_FORWARD_TOKEN
npx wrangler secret put MCP_OAUTH_CONSENT_KEY
npx wrangler secret put MAIL_TOKEN_ENCRYPTION_KEY
```

`MAIL_TOKEN_ENCRYPTION_KEY` は、この Worker 用に新しく作る 64 桁の hex です。アプリパスワードと Microsoft のリフレッシュトークンを AES-256-GCM（`v1:<iv hex>:<cipher hex>`）で包み、この Worker の KV にだけ置きます。linebot の D1 は読まないので、linebot の鍵と揃える必要はありません。linebot の暗号文をこの KV へコピーするときだけ、同じ鍵にします。値はリポジトリに置きません。

任意で、接続してよい Gmail を固定するときは `ALLOWED_GMAIL` を vars に書きます。

Gmail の接続開始は、ブラウザで次を開きます。

`https://reply.kimitotalk.link/oauth/google/start?key=<OAUTH_ADMIN_KEY>`

### Email Routing

1. Cloudflare の Email Routing で、新しい宛先 `reply@kimitotalk.link` だけをこの Worker の `email()` に渡す。`notify@kimitotalk.link` は linebot のルールのままにする。付け替えると linebot の受信が止まります。`send_email` バインディングは足さない。
2. 利用者のメールボックスで、届いたメールを `reply@kimitotalk.link` へ自動転送する。
3. 転送元のアドレスが `X-Forwarded-For` に入るようにする。これが `email_threads.owner` になる。

JSON で試験する口も残しています。ヘッダは `x-incoming-token`、宛先は `https://reply.kimitotalk.link/incoming/forward` です。本文は引用として最大 280 字だけ残し、全文は保存しません。

### アプリパスワード（Gmail 以外）

1. `https://reply.kimitotalk.link/auth/mail-app/issue?key=<OAUTH_ADMIN_KEY>&address=<アドレス>` を開く。プロバイダはアドレスから決まります。
2. 返った URL（`/auth/mail-app/setup?c=<code>`）を 10 分以内に開く。試行は 5 回までです。
3. 各社のアプリパスワードを入れる。ドコモは dアカウント ID、au とその他は SMTP/IMAP のホストも入れる。
4. 保存前に IMAP と SMTP のログインだけを確認します。この確認では MAIL FROM を送らないので、メールは出ません。

### Microsoft（Entra）

送信に使うときだけ、アプリ登録を足します。無効のままなら Microsoft は受信だけです。

1. Entra でアプリを登録し、リダイレクト URI に `https://reply.kimitotalk.link/auth/ms/callback` を追加する。
2. 委任された権限に `offline_access`、`https://outlook.office.com/IMAP.AccessAsUser.All`、`https://outlook.office.com/SMTP.Send` を付ける。
3. 次を置く。`MS_OAUTH_ENABLED` は `1` のときだけ送信する。

```bash
npx wrangler secret put MS_CLIENT_ID
npx wrangler secret put MS_CLIENT_SECRET
```

`wrangler.toml` の vars に `MS_OAUTH_ENABLED = "1"` を足す。接続開始は `/auth/ms/start?key=<OAUTH_ADMIN_KEY>&login_hint=<アドレス>` です。同意は `prompt=select_account` です。リフレッシュトークンは `msrt:` を付けてから暗号化します。

### 返信の検出（任意）

`scheduled` が、接続済みメールの送信済みを IMAP でヘッダだけ読み、In-Reply-To が保存した message-id と一致したら、そのスレッドを返信済みにします。有効にするときは `wrangler.toml` に cron を足します。既定では動かしていません。

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
