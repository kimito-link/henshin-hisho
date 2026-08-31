# 案件統合AI秘書機能 設計書

設計=Fable（`model:"fable"`サブエージェント、実ファイル裏取り込み） / 素材=マルチLLM会議（4/6成功）＋実演調査（Chatwork/ココナラ/ランサーズ実画面） / 統合=司令塔 / 2026-08-31
council-fableスキルの3段構え（素材集め→Fable設計→実装引き継ぎ）の産物。

## お題
複数チャットサービス（Chatwork・ココナラ・ランサーズ・LINE公式アカウント）の会話を「案件（Project）」単位で統合し、AIが状況把握・発言照合・返信案生成を行う機能を`henshin-hisho/backend`に追加する。PoC対象は`andstory.jp`案件。

## 実装先の判断（確定）
`reply-copilot-openrouter-v2`（Chrome拡張、DBなし）ではなく`henshin-hisho/backend`（Cloudflare Workers、既存の認証・KV inbox・LINE連携あり）に実装する。既存機能（`auth.js`/`kv.js`/`schema.js`/`llm.js`/`connectors/line.js`/`inbox.js`/`http.js`）は一切変更しない。

## 実演で確定した重要事実
1. Chatworkは「1案件=1グループ」だけでなく個人チャットも併用。1案件に複数の会話が紐づく。
2. 同一Chatworkルーム内に顧客予算とエンジニア原価が混在する実例あり（ルーム単位でvisibility一律決め打ち不可）。
3. Chatworkは「顧客直接窓口」にも「内部窓口」にもなる。同じsource='chatwork'でも相手次第でvisibilityが変わる。
4. Chatwork概要欄に認証情報（ID・パスコード）が直書きされている実例あり（マスキング必須）。
5. サービスごとに送信者表示名が異なる。senderRole判定は表示名の文字列一致に頼れない。
6. ランサーズで数ヶ月単位の未対応相談が滞留する実害を確認（案件横断AIの必要性の実証）。
7. AIの発言照合は「事実と推測の分離」「作業範囲変更時の金額前提再確認」「顧客提示より内部確認優先」という具体的な振る舞いが求められる。

## 決定事項（詳細はFable設計本文を参照）

1. **DB**: D1を新規導入（`henshin-hisho-projects`）。既存KVとは完全分離、KVはSecrets/将来のキャッシュに限定。
2. **visibility**: 二段階防御（取り込み時決定＋取得時SQLフィルタ）。ルーム単位の`counterpart_role`（customer/engineer/mixed）で既定visibilityを決め、mixedはfail-closedで`internal`、例外はメッセージ単位で事後修正APIにより`public`へ昇格。
3. **senderRole**: `internal_staff`テーブル（source+source_account_idの完全一致）→なければ`counterpart_role`、の順で判定。表示名不使用。
4. **発言照合プロンプト**: 事実/推測/内部情報を明示タグで分離。few-shot 2例込みで確定（設計書E節に全文）。
5. **マスキング**: 取り込み時（メッセージ本文・概要欄）＋LLM出力後（保険）の二重。原文はD1に保存しない。
6. **API**: `POST /projects`等9エンドポイント、`index.js`への変更はimport1行+委譲2行+scheduled内try/catch1行のみ。

却下案: Durable Objects中心構成／visibilityのAI都度判定／表示名によるsenderRole判定／正規表現マスクを主防御にする／Phase1でのトークンAES-GCM保存／KVキャッシュ層／Chatwork Webhook受信／手動貼り付けAPI廃止／messagesテーブルへの原文保存。

## 実装ハンドオフ
詳細な設計（D1スキーマ全文・visibility関数群・プロンプト全文・API仕様・Chatworkコネクタ・地雷10件）は同ディレクトリの[PROJECT-AI-IMPLEMENTATION-HANDOFF.md](PROJECT-AI-IMPLEMENTATION-HANDOFF.md)参照。
