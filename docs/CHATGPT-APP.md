# ChatGPTアプリ（返信候補）

`chatgpt-app/` は、ChatGPT の中で動く返信秘書です。相手の連絡を貼ると、危険度、相手が受け取りそうな気持ち、返信候補、しおりを同じフォームで扱います。メール、LINE、Chatwork への送信はしません。人が確認した文面をコピーするまでです。

料金のページは `/price/` です。`index.html` や `www` は使いません。公開ホストの http は https へ転送します。

## 構成

```
ChatGPT（MCP Apps）
  └─ POST /mcp
       ├─ open_reply_desk / propose_replies / confirm_candidate
       ├─ save_shiori / list_shiori
       └─ start_trial / billing_status
  UI  ui://henshin-hisho/reply-form.html
  ページ  /price/  /preview/reply-form/  /billing/trial  /billing/checkout  /billing/webhook
  KV  CHATGPT_KV（お試し、回数、しおり、コピー直前のスナップショット）
```

候補の文面と気持ちの予測は `chatgpt-app/src/reply.js` の規則です。OpenRouter は呼びません。

対応する特許の項は [PATENT-MAPPING.md](PATENT-MAPPING.md) です。

## ローカルで動かす

```bash
cd chatgpt-app
npm test
npx wrangler dev
```

テストは Worker の `fetch` を直接呼びます。Wrangler が無くても `npm test` は通ります。

ブラウザで見るときは、開発サーバーの次のパスです。

- `http://127.0.0.1:8787/price/`
- `http://127.0.0.1:8787/preview/reply-form/`

`/price` と `/preview/reply-form` は末尾のスラッシュへ転送します。localhost の http はそのままです。

## ChatGPT の開発者モードへ接続する

1. Worker を https で公開する。
2. ChatGPT のアプリ（Plugins）でカスタム MCP を追加する。メニュー名は製品側で変わることがあります。
3. 接続先は `https://<ホスト>/mcp` です。パスの `/mcp` を省かないでください。
4. `MCP_ACCESS_TOKEN` を設定している場合は、Bearer トークンを接続の認証に入れます。未設定ならトークンは不要です。公開前にトークンを置く方が安全です。
5. インストールしたあと、新しいチャットでアプリを選び、「このメールの返信候補を作って」のように頼む。
6. ツール定義を変えたあとは、ChatGPT 側で接続を読み込み直します。

フォームは、モデルがツールを呼んだときと、画面のボタンの両方から動きます。`confirm_candidate` は画面からの確認用です。

## デプロイ

```bash
cd chatgpt-app
npx wrangler deploy
```

`wrangler.toml` の KV id がゼロのままでは、本番の保存は使えません。下の手順で差し替えてからデプロイします。

## オーナーが手で行うこと

### KV

```bash
npx wrangler kv namespace create CHATGPT_KV
```

出た id を `chatgpt-app/wrangler.toml` の `[[kv_namespaces]]` に書きます。プレビュー用も同様です。

KV が無いと、しおり、「さっきの人」の解決、お試しの記録、コピー直前の状態の取り直しができません。候補の定型文だけは、その場の応答としては作れます。

### Stripe

料金は月額 2,980円、年額でまとめる案内は 29,800円、お試しは14日です。決済そのものは Stripe の価格オブジェクトに従います。

```bash
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_PRICE_ID
```

3つが揃うまで、`/price/` の支払いボタンは決済へ飛ばず、料金と「接続を準備している」旨だけを出します。

Webhook の URL は `https://<ホスト>/billing/webhook` です。購読の `checkout.session.completed` と `customer.subscription.updated` / `deleted` を受けます。署名が合わないイベントではプランを変えません。

### OpenAI へのアプリ提出

開発者モードで一通り使ったあと、公開用の提出は OpenAI のアプリ審査に出します。提出前に確認すること:

- 接続先が https の `/mcp` である
- 送信ボタンが無く、コピーまでである
- 高リスクは確認チェックまでコピーできない
- 料金とお試しの説明が `/price/` と一致している
- 秘密情報（Stripe、MCP トークン）をリポジトリに置いていない

審査用の説明では、相手の本文は候補作成に使い、しおりには抜粋だけを KV へ残す、と書いてください。

### アクセストークン

```bash
npx wrangler secret put MCP_ACCESS_TOKEN
```

置くと `/mcp` は `Authorization: Bearer` が必要です。

## 回数制限と backend の原価ガード

ChatGPT 側の回数は `chatgpt-app/src/billing.js` の `consumeGeneration` です。

- メールなし: 1つの `deskId` につき1日3件。全体でも1日500件
- お試し: 14日、60件
- 有料: 月1500件

backend の `cost-guard.js` には載せていません。理由は `QUOTA_SEPARATION_REASON` に書いてあります。

- このアプリの候補は定型文で、OpenRouter を呼ばない
- `cost-guard` はログイン利用者、D1、LLM の原価予約が前提で、どれかが欠けると LLM を呼ばない
- ChatGPT の利用者は backend のユーザーと同じ人とは限らない。ここに通すと、保存が無いだけで全部止まるか、別人の LLM 予算を使う

LLM の下書きを足す場合は、ChatGPT から backend の下書き API を呼び、その API の中にある `costGuard` だけを通します。ChatGPT 側に二つ目の原価カウンタは作りません。
