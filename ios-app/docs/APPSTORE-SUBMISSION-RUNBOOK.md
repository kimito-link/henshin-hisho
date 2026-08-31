# iOS App Store Submission Runbook

## Operator checklist

- Apple Developer Program に登録し、Team ID を控える。
- App Store Connect で Bundle ID `jp.besttrust.henshinhisho` のアプリを作成する。
- App Privacy を ASC Web UI で手動公開する。
- App Store 配布証明書と App Store provisioning profile を作成する。
- GitHub Actions secrets またはローカル環境に ASC API key と署名素材を登録する。
- `IOS_REVIEW_DEMO_USERNAME=apple-reviewer@henshin-hisho.link` と `IOS_REVIEW_DEMO_PASSWORD` を設定する。
- `npm run reviewer:provision` でデモ垢を作成または存在確認する。
- `npm run reviewer:verify` で submit 24時間以内にログイン検証する。
- `npm run appstore:screenshots` でログイン後スクショを撮る。
- `npm run lint:pre-submission` が全 CHECK green であることを確認する。
- `review-notes/CURRENT-en.txt` を ASC Sign-In Information と Review Notes に反映する。
- `npm run appstore:submit` は運営者が提出タイミングで実行する。

## Rejection response flow

1. Apple の Guideline 番号を確認する。
2. `docs/REJECTION-REPLY-TEMPLATES.md` の該当テンプレを、実際の build 番号と審査指摘に合わせて短く編集する。
3. Resolution Center に英語で返信する。
4. 2.1(a) の資格情報問題なら、同じ build のまま `npm run reviewer:verify` 結果を添えて返信する。
5. 2.3.3 のスクショ問題なら、スクショを delete-then-reupload するため `npm run appstore:screenshots` と `npm run appstore:submit` を再実行する。
6. 同じテンプレ却下が繰り返される場合は、前回返信の日付と該当画面の確認依頼を添える。
