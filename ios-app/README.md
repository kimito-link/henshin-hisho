# AI返信秘書 iOS Shell

PR-8 は App Store 審査向けの iOS コンパニオンです。Capacitor のローカル `www` を使い、アプリ内に購入導線を含めない構成にしています。

## 設計

- `www/`: iOS バイナリに入るローカルシェル。ログイン、受信箱確認、通知登録、バッジ、共有、アカウント削除だけを持ちます。
- `app.config.json`: Bundle ID、連絡先、事業者、審査方針の単一真実源です。
- `capacitor.config.json`: `allowNavigation` に `henshin-hisho.link`、Worker、`appleid.apple.com` を明示しています。
- `scripts/`: `web-ios-android/templates/scripts` からコピーした App Store 提出キットと、このアプリ用 lint / デモ垢検証です。
- `review-notes/CURRENT-en.txt`: App Review Information に入れる最新 reviewer notes です。

## 主要コマンド

```powershell
npm run node:check
npm run lint:pre-submission
npm run reviewer:provision
npm run reviewer:verify
npm run appstore:screenshots
npm run appstore:submit
```

実際の `cap sync ios`、証明書、Provisioning Profile、ASC 提出は Apple Developer 登録後に運営者が実行します。
