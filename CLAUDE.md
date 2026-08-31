# AI返信秘書 (Henshin Hisho) プロジェクト構造

このディレクトリ（`henshin-hisho`）は、「君斗りんくのAI返信秘書」アプリ専用のリポジトリです。
元の `reply-copilot-openrouter-v2` から抽出・整理されました。

## ディレクトリ構成
- `backend/`: ログイン認証や処理を行うバックエンドAPI（Cloudflare Workers）。元のパスは `workers/henshin-hisho-app`。
- `ios-app/`: Capacitorを使用したiOSシェルアプリ本体。
- `web-app/`: ユーザーに提供されるWebフロントエンドUI。元のパスは `app`。

## AIへの指示事項
1. **責務の遵守**: このディレクトリ内でも、各コンポーネント固有の設計ルールが最優先されます。
2. **連携**: アプリケーション（iOS/Web）とバックエンド（Worker）を修正する際は、両者のAPIや型が一致するように注意してください。
3. **歴史的背景**: Chrome拡張機能関連のコードは元の `reply-copilot-openrouter-v2` ディレクトリにあります。ここにはありません。
