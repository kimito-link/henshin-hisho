# chatgpt-app の API デプロイ

このディレクトリは、Cloudflare へ送らずに作った Workers スクリプトです。アップロードは手元のトークンで行います。この環境には Cloudflare トークンが無く、本番へは出していません。

作ったコマンド（`chatgpt-app/` で実行）:

```bash
CI=true WRANGLER_SEND_METRICS=false npx --yes wrangler@4 deploy --dry-run --outdir dist-deploy
```

Wrangler 4.151.3。`--dry-run` はパッケージしただけで終了し、アカウントには繋がりません。成果の `index.js` だけをここへ移し、`index.js.map` と `//# sourceMappingURL` は外しました。`dist-deploy/` はコミットしません。

- Worker 名: `henshin-hisho-chatgpt`
- エントリ: `index.js`（ESM、`export default` に `fetch` / `email` / `scheduled`）
- サイズ: 約 330 KiB（dry-run の表示は gzip 前 329.65 KiB）
- `cloudflare:sockets` は `import("cloudflare:sockets")` のまま残しています。SMTP の 587（STARTTLS）と 465（即 TLS）はこれで話します。
- `email()` は例外を外に出さず、受信失敗でもバウンスしません。
- `send_email` バインディングは付けません。

アップロード例（`namespace_id` を実 ID に替えてから）:

```bash
curl -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/henshin-hisho-chatgpt" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F "metadata=@chatgpt-app/deploy/metadata.json;type=application/json" \
  -F "index.js=@chatgpt-app/deploy/index.js;type=application/javascript+module"
```

metadata の形は [Multipart upload metadata](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/) と [Workers Script Upload API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/) に合わせています。`bindings` はアップロードのたびに、その配列の内容へ置き換わります。2 回目以降は、既に入れたシークレットを消さないよう、送る JSON に次を足します。

```json
"keep_bindings": ["secret_text"]
```

初回はシークレットがまだ無いので、リポジトリの `metadata.json` のままで足ります。シークレットの値はこのファイルに書きません。

## D1

この Worker は D1 を使いません。保存先は KV（`CHATGPT_KV`）だけです。`chatgpt-app/migrations` は無く、作っていません。backend の costGuard が使う D1 は別 Worker で、このアップロードには含めません。

`MAIL_TOKEN_ENCRYPTION_KEY` を linebot の鍵と揃える必要はありません。この Worker は linebot の D1 を読まず、自分の KV に入れた暗号文だけを解きます。linebot の `password_enc` をこの KV へコピーするときだけ、同じ 64 桁 hex にします。通常は `openssl rand -hex 32` で新しい鍵を作ります。

## バインディング

| 名前 | metadata の type | 値 | アップロード前 |
| --- | --- | --- | --- |
| `CHATGPT_KV` | `kv_namespace` | `namespace_id` はプレースホルダ `00000000000000000000000000000000` | 実在の namespace ID に替える。`npx wrangler kv namespace create CHATGPT_KV` の id。ゼロのままではしおり、受信、送信前の状態、Gmail のトークン、メールの接続情報を保存できない |
| `GOOGLE_CLIENT_ID` | `plain_text` | `899798982543-2jk3d2fp97c02js71opg7l1j9fa7oh5a.apps.googleusercontent.com` | linebot と同じ公開クライアント ID。変えない |
| `GOOGLE_REDIRECT_URI` | `plain_text` | `https://reply.kimitotalk.link/oauth/google/callback` | 下記の Google リダイレクトと一致させる |
| `WORKER_PUBLIC_URL` | `plain_text` | `https://reply.kimitotalk.link` | カスタムドメインと一致させる。Microsoft のコールバックもこのオリジン |

D1 バインディングはありません。プレビュー用の `preview_id`（`…0001`）は API アップロードには不要です。

## 互換性

`compatibility_date` は `2026-10-22` です。`compatibility_flags` は入れていません。2026-08-04 以降の互換日付は `nodejs_compat` と `nodejs_compat_v2` を既定で有効にし、同じフラグを新設定へ重ねる必要はありません（[2026-08-04 の変更](https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/)）。バンドルに `node:` の import はありません。`postal-mime` はバンドル済みです。

## プレーンテキスト（metadata にはまだ無い）

必要になったときだけ `plain_text` を足します。空のままならコードは無視します。

| 名前 | いつ使うか |
| --- | --- |
| `ALLOWED_GMAIL` | 接続してよい Gmail を 1 アドレスに固定するとき。小文字のメールアドレス |
| `MS_OAUTH_ENABLED` | `"1"` のときだけ Microsoft の送信（XOAUTH2）を有効にする。同時に `MS_CLIENT_ID` と `MS_CLIENT_SECRET` が必要 |
| `MCP_AUTH_REQUIRED` | `"1"` で、Bearer の無い `/mcp` を 401 にする。本番はこれを付ける |
| `BACKEND_URL` | LLM 下書き。例: backend のオリジン。`INTERNAL_DRAFT_TOKEN` と `DRAFT_SERVICE_USER_ID` と揃ったときだけ `/internal/reply-drafts` を呼ぶ。どれかが無いときは定型文 |
| `DRAFT_SERVICE_USER_ID` | backend の costGuard が予約する利用者 ID。このアプリの回数カウンタとは別人 |

## シークレット

`wrangler secret put` か、アップロード metadata の `secret_text` で入れます。値はリポジトリに置きません。`secret_text` をコミットした metadata には書きません。

| 名前 | 何と同じか |
| --- | --- |
| `GOOGLE_CLIENT_SECRET` | linebot の Google クライアント秘密と**同じ**。プロジェクト `kimito-talk-oauth` の同じ OAuth クライアント |
| `MAIL_TOKEN_ENCRYPTION_KEY` | この Worker **専用**の新しい 64 桁 hex。linebot とは揃えない（上の D1 の節）。コピーした暗号文を読むときだけ linebot と同じ |
| `OAUTH_ADMIN_KEY` | この Worker 専用。Gmail 開始 `/oauth/google/start`、メール接続の発行、Microsoft 開始の `key` |
| `INCOMING_FORWARD_TOKEN` | この Worker 専用。`POST /incoming/forward` の `x-incoming-token` |
| `MCP_OAUTH_CONSENT_KEY` | この Worker 専用。MCP OAuth の同意画面 |
| `MCP_ACCESS_TOKEN` | この Worker 専用の固定 Bearer。本番は `MCP_AUTH_REQUIRED=1` と併用するか、このサーバーが発行する OAuth だけにする |
| `INTERNAL_DRAFT_TOKEN` | LLM を使うとき、backend Worker の同じトークンと**一致**させる。使わないなら空のままで定型文 |
| `STRIPE_SECRET_KEY` | このアプリの Checkout 用。`STRIPE_PRICE_ID` と両方あるときだけ決済 URL を作る。linebot の鍵と自動では共有しない |
| `STRIPE_WEBHOOK_SECRET` | Stripe がそのエンドポイントに出す `whsec_…`。署名は HMAC SHA-256、許容は 300 秒。エンドポイントは `https://reply.kimitotalk.link/billing/webhook` |
| `STRIPE_PRICE_ID` | 月額 2,980 円（年額 29,800 円の表示は料金ページ）の Price ID。Checkout の `line_items[0][price]` |
| `MS_CLIENT_ID` | Microsoft 送信を有効にするときだけ。Entra のアプリ ID。無効のままなら Microsoft は受信だけ |
| `MS_CLIENT_SECRET` | 上と同じアプリの秘密。無効のままなら不要 |

## カスタムドメイン

`reply.kimitotalk.link` を Worker `henshin-hisho-chatgpt` に付けます。ゾーン `kimitotalk.link` が同じアカウントにある必要があります。カスタムドメインはスクリプト metadata の外です（Workers の Domains API、またはダッシュボード）。

`GOOGLE_REDIRECT_URI` と `WORKER_PUBLIC_URL` は、このホストが付いてから一致します。付くまでは OAuth の戻り先になりません。

## Email Routing

`notify@kimitotalk.link` をこの Worker に付け替えないでください。その宛先は linebot のままにします。付け替えると linebot の受信が止まります。

安全な宛先は、新しいアドレス `reply@kimitotalk.link` だけをこの Worker の `email()` に渡すルールです。

1. Email Routing の宛先に Worker `henshin-hisho-chatgpt` を足す（カスタムアドレス `reply@kimitotalk.link`）。
2. ルーティングルールは `reply@kimitotalk.link` → この Worker。`notify@` の既存ルールは触らない。
3. 利用者の自動転送先は `reply@kimitotalk.link`。
4. 転送元が `X-Forwarded-For` に入るようにする。それが `email_threads.owner` になる。
5. 封筒の From が `reply@kimitotalk.link` または `notify@kimitotalk.link` だけのときは、そのアドレスを本人としては保存しない。

`send_email` は使いません。送信は Gmail API か `cloudflare:sockets` の SMTP です。

## Google のリダイレクト URI

同じ OAuth クライアント（公開 ID は上の `GOOGLE_CLIENT_ID`）に、次を**追加**します。既存の linebot の URI は残します。

- 追加: `https://reply.kimitotalk.link/oauth/google/callback`
- 残す: `https://kimitotalk.link/auth/google/callback`

スコープは `openid`、`email`、`https://www.googleapis.com/auth/gmail.send` だけです。`gmail.readonly` / `gmail.compose` / `gmail.modify` は足しません。接続開始は `https://reply.kimitotalk.link/oauth/google/start?key=<OAUTH_ADMIN_KEY>` です。

## Stripe

1. 秘密三つを上の表のとおり入れる。
2. Webhook のエンドポイントを `https://reply.kimitotalk.link/billing/webhook` にする。
3. 署名秘密を `STRIPE_WEBHOOK_SECRET` にする。
4. Checkout は `STRIPE_SECRET_KEY` と `STRIPE_PRICE_ID` が両方あるときだけ動きます。無いときは料金ページは出て、決済 URL は作りません。

## Microsoft（送るときだけ）

リダイレクト URI に `https://reply.kimitotalk.link/auth/ms/callback` を足します。委任は `offline_access`、`https://outlook.office.com/IMAP.AccessAsUser.All`、`https://outlook.office.com/SMTP.Send`。`MS_OAUTH_ENABLED=1` と二つの秘密が揃うまで、Microsoft は受信だけです。

## cron とログ

`scheduled()` はバンドルにあります。cron は付けていません。`wrangler.toml` の `*/15 * * * *` はコメントのままです。スクリプト metadata に schedules は無く、空の cron を送ると既存のスケジュールを消す恐れがあるので、metadata には書いていません。返信検出を動かすときは、アップロードとは別に次のスケジュールを足します。

```json
[{ "cron": "*/15 * * * *" }]
```

`PUT /accounts/$ACCOUNT_ID/workers/scripts/henshin-hisho-chatgpt/schedules`

`wrangler.toml` は observability の logs と traces を有効にしています。この項目はスクリプト metadata の属性ではないので、`metadata.json` には入れていません。アップロード後にダッシュボードの Observability、または Workers の script settings で logs と traces を有効にすると、toml と同じになります。

## まだ実機で見ていないもの

iCloud からの実際の送信と、Microsoft OAuth の同意から送信までは、このバンドルでも未確認です。各社の SMTP へはこの環境から繋いでいません。
