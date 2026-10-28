# 一つの契約で、カード・Web・iOS・Android を開く

返信秘書の加入は一つです。カード（ChatGPT、Claude、Grok）、Web、iOS、Android のどれかで加入すると、同じメールアドレスの全部が開きます。運営者は株式会社ベストトラストです。

金額の正本は `web-app/billing/plans.js` です。

| プラン | 円 | Stripe の環境変数 | App Store の product ID | Play の基本プラン |
| --- | --- | --- | --- | --- |
| 月額 | 2,980 | `STRIPE_PRICE_ID` | `jp.besttrust.henshinhisho.monthly` | `henshin_hisho` / `monthly`（P1M） |
| 年額 | 29,800 | `STRIPE_ANNUAL_PRICE_ID` | `jp.besttrust.henshinhisho.annual` | `henshin_hisho` / `annual`（P1Y） |

バンドル ID とパッケージ名はどちらも `jp.besttrust.henshinhisho` です。

契約の記録は chatgpt-app の `CHATGPT_KV`、キーは `entitlement:<正規化したメール>` です。中に `sources.stripe`、`sources.apple`、`sources.google`、`sources.license` があり、どれか一つでも期間内なら加入中です。Stripe をやめても、App Store か Play が残っていれば加入は続きます。backend の利用者レコードにも同じ形を写し、`INTERNAL_ENTITLEMENT_TOKEN` で二つの Worker を揃えます。

ストアに渡すのはメールではありません。メールから作った UUID（UUID v5、URL 名前空間）です。iOS は `appAccountToken`、Android は `obfuscatedExternalAccountId` です。KV の `store-account:<uuid>` がそのメールを指します。

この文書のコマンドは、手元で商品定義を表示するだけです。ストアへは送りません。提出もしません。

```bash
cd ios-app
npm run subscriptions:dry-run
```

`--apply` を付けても、`APPLY_STORE_CHANGES=1` が無い限り送信しません。その変数は置かないでください。

## 画面ごとの買い方

- カードの料金ページと Web は Stripe Checkout です。Web は backend の `POST /billing/checkout` を通り、中で chatgpt-app と同じ Checkout を作ります。プランは `monthly` か `annual` です。
- iOS は StoreKit の自動更新サブスクリプションです。プラグインは `@capgo/native-purchases` です。購入と「購入を復元」は、署名済みトランザクションを backend の `POST /billing/apple/transaction` に送り、サーバが JWS を確かめてから契約を更新します。
- Android は同じ Capacitor アプリの Google Play Billing です。購入と復元は backend の `POST /billing/play/purchase` に送り、サーバが Play の subscriptionsv2 を取り直してから契約を更新します。
- プランと状態は、各アプリの「プラン」画面です。iOS と Android の画面に Stripe のリンクは出しません。日本の外部購入リンクは、下のフラグが両方オンのときだけ出します。既定はオフです。

## chatgpt-app Worker（henshin-hisho-chatgpt）

値は書きません。名前だけです。

| 名前 | 置き方 | 役割 |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | secret | Checkout |
| `STRIPE_WEBHOOK_SECRET` | secret | `POST /billing/webhook` の署名。この Worker だけ |
| `STRIPE_PRICE_ID` | secret | 月額 Price |
| `STRIPE_ANNUAL_PRICE_ID` | secret | 年額 Price |
| `STORE_WEBHOOK_TOKEN` | secret | App Store と Play の通知 URL に付けるトークン。空だと通知は 401 |
| `INTERNAL_ENTITLEMENT_TOKEN` | secret | backend と契約を写す共有トークン |
| `BACKEND_URL` | plain | 契約を backend の `POST /internal/entitlement` へ写す先。LLM 下書きと同じオリジンでよい |
| `PLAY_PACKAGE_NAME` | plain、任意 | 既定 `jp.besttrust.henshinhisho` |
| `PLAY_ACCESS_TOKEN` | secret、任意 | Play 確認用の短いトークン。あるときはこちらを使う |
| `GOOGLE_PLAY_SA_JSON` | secret、任意 | Play のサービスアカウント JSON。`PLAY_ACCESS_TOKEN` が無いときに、ここから確認用トークンを作る |
| `APPLE_IAP_TRUST_JWK` | secret、任意 | 試験用の公開鍵。本番は JWS の x5c と、コードに入っている Apple Root CA G3 の SHA-256 で確かめる。本番では空のままでよい |

入口:

- `POST https://reply.kimitotalk.link/billing/webhook`（Stripe。署名）
- `POST https://reply.kimitotalk.link/billing/apple/notifications?token=<STORE_WEBHOOK_TOKEN>`（App Store Server Notifications v2）
- `POST https://reply.kimitotalk.link/billing/google/notifications?token=<STORE_WEBHOOK_TOKEN>`（Play の Real-time developer notifications。Pub/Sub の push）
- `GET` と `POST` の `/internal/entitlement`（`Authorization: Bearer <INTERNAL_ENTITLEMENT_TOKEN>`）

Apple の通知は外側の `signedPayload` と、中の `signedTransactionInfo` を ES256 で確かめます。本番は証明書チェーンの根が Apple Root CA G3 であることまで見ます。Play の通知は種類だけでは契約を変えず、必ず subscriptionsv2 を取り直します。`SUBSCRIPTION_STATE_ACTIVE`、`IN_GRACE_PERIOD`、期間が残っている `CANCELED` を加入中にします。アカウントがまだ紐づいていない購入は `apple-pending:` / `play-pending:` に置き、アプリの復元でメールと結びます。

## backend Worker（henshin-hisho-app）

Web とアプリはこの Worker にログインします。Checkout とストア確認に、次を置きます。

| 名前 | 置き方 | 役割 |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | secret | Web の Checkout。chatgpt-app と同じ鍵でよい |
| `STRIPE_PRICE_ID` | secret | 月額 Price。chatgpt-app と同じ |
| `STRIPE_ANNUAL_PRICE_ID` | secret | 年額 Price。chatgpt-app と同じ |
| `INTERNAL_ENTITLEMENT_TOKEN` | secret | chatgpt-app と**同じ**値 |
| `CHATGPT_APP_URL` | plain | `https://reply.kimitotalk.link` |
| `APPLE_IAP_TRUST_JWK` | secret、任意 | 試験用。本番は空 |
| `PLAY_ACCESS_TOKEN` | secret、任意 | chatgpt-app と同じ役割 |
| `GOOGLE_PLAY_SA_JSON` | secret、任意 | chatgpt-app と同じ JSON |
| `PLAY_PACKAGE_NAME` | plain、任意 | 既定 `jp.besttrust.henshinhisho` |
| `APPLE_EXTERNAL_PURCHASE_LINK` | plain | 未設定のままがオフ。`"1"` のときだけ、アプリの機能フラグがオンになる |

`STRIPE_WEBHOOK_SECRET` は backend には置きません。Webhook は chatgpt-app の一つです。

アプリが使う入口:

- `POST /billing/checkout`（Web。セッショントークン）
- `POST /billing/refresh`（プラン状態を更新）
- `POST /billing/store-account`（この端末用の UUID）
- `POST /billing/apple/transaction`
- `POST /billing/play/purchase`
- `POST /internal/entitlement`（chatgpt-app から。Bearer）

## Stripe でやること

1. 月額 2,980 円の Price を作り、その ID を chatgpt-app と backend の `STRIPE_PRICE_ID` に入れる。
2. 年額 29,800 円の Price を作り、その ID を両方の `STRIPE_ANNUAL_PRICE_ID` に入れる。
3. Webhook のエンドポイントは `https://reply.kimitotalk.link/billing/webhook` のままにする。署名秘密は chatgpt-app の `STRIPE_WEBHOOK_SECRET`。
4. Checkout に渡すメールは、ログインと同じメールにする。このメールが契約の鍵です。
5. `STRIPE_SECRET_KEY` と、選んだプランの Price が両方あるときだけ決済 URL を作ります。無いときは料金は見えて、決済には進みません。

## App Store Connect でやること

提出はしません。商品と通知の準備だけです。

1. アプリ `jp.besttrust.henshinhisho` を、このアプリと同じ Apple Developer アカウントで開く。
2. サブスクリプショングループ「返信秘書」を作る。
3. 自動更新サブスクリプションを二つ作る。
   - `jp.besttrust.henshinhisho.monthly`。期間 1 か月。日本で 2,980 円。
   - `jp.besttrust.henshinhisho.annual`。期間 1 年。日本で 29,800 円。
4. App Store Server Notifications を Version 2 にする。本番と Sandbox の URL はどちらも次です。`STORE_WEBHOOK_TOKEN` は chatgpt-app に入れた値です。

   `https://reply.kimitotalk.link/billing/apple/notifications?token=<STORE_WEBHOOK_TOKEN>`

5. iOS の Xcode プロジェクト（`npx cap sync ios` で生成）に、In-App Purchase の capability を付ける。`ios/` はリポジトリに入れていません。
6. アプリの「プラン」から、月額・年額・購入を復元・ストアの定期購入を開けることを確認する。このビルドに Stripe のアドレスは入っていません。

商品定義の表示は `ios-app/scripts/asc-subscriptions.mjs` です。既定は画面に JSON を出すだけで、App Store Connect API には繋ぎません。

## 日本の外部購入リンク（スマホ新法）

既定はオフです。オフのまま出荷します。

オンになる条件は二つで、片方だけでは出ません。

1. `ios-app/www/external-purchase.js` の `EXTERNAL_PURCHASE_LINK_ENABLED` が `true` のビルド。今は `false` です。変えたら、そのビルドを審査に出す必要があります。
2. backend の `APPLE_EXTERNAL_PURCHASE_LINK` が `"1"`。未設定なら、アプリはリンクを作りません。

リンク先は `https://henshin-hisho.link/app/#/plan` です。Stripe の URL はアプリに入れません。

Apple が求める手続きは次です。料率はこのリポジトリに書きません。その時点の Apple Developer Program License Agreement（日本）を読んでください。

1. Apple Developer で、日本向けの StoreKit External Purchase Link entitlement を申請する。
2. App Store Connect に、アプリ外で開くリンク先 URL を登録する。登録する URL は上のプラン画面です。
3. アプリを離れる前に、StoreKit の External Purchase Link（開示シート）を出す。
4. 対象は日本のストアフロントだけです。
5. StoreKit の自動更新は残します。外部リンクは追加で、アプリ内課金を外しません。
6. リンクはアプリの外、端末のブラウザで開きます。アプリ内の隠した WebView では開きません。
7. 上の 1 と 2 が揃い、審査を通ったビルドだけがリンクを出します。

## Google Play Console でやること

提出はしません。

1. パッケージ `jp.besttrust.henshinhisho` のアプリを開く。土台は `ios-app/android`（Capacitor）です。
2. Play Billing を有効にする。
3. 定期購入の商品 `henshin_hisho` を作る。基本プランは二つです。
   - `monthly`。期間 P1M。日本で 2,980 円。
   - `annual`。期間 P1Y。日本で 29,800 円。
4. Google Cloud でサービスアカウントを作り、Android Publisher API を有効にし、Play Console でそのアカウントにアプリの権限を付ける。JSON を chatgpt-app と backend の `GOOGLE_PLAY_SA_JSON` に入れる。短いトークンで試すときは、代わりに `PLAY_ACCESS_TOKEN` を入れる。
5. Real-time developer notifications を有効にする。Pub/Sub の push 先は次です。

   `https://reply.kimitotalk.link/billing/google/notifications?token=<STORE_WEBHOOK_TOKEN>`

6. ライセンステスターを足し、テスト購入で「購入を復元」とプラン表示を見る。
7. サーバは通知を受けたあと、`purchases.subscriptionsv2` を取り直します。通知の番号だけでは加入にしません。

商品定義の表示は `ios-app/scripts/play-subscriptions.mjs` です。既定は JSON を出すだけで、Play Developer API には繋ぎません。
