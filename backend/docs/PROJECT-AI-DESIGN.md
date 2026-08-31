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

## PoC実データ検証で発見した設計不備と修正（2026-08-31）

andstory.jp案件の実データ（Chatwork同期122件＋ココナラ手動投入）で`/projects/:id/assist`を実行し、以下を発見・修正した。詳細は[leak-guard.js](../src/projects/leak-guard.js)。

1. **プロンプト指示だけでは情報漏洩を防げなかった**: `reconcile`モードで、顧客向け返信案にエンジニアの内部見積もり金額（4万円）がそのまま混入する事故を実際に確認した。プロンプトのルール5（内部ログの内容を顧客向け返信案に含めない）はLLMに守られなかった。出力側の第3防御層として`guardCustomerReplySection`（内部ログ限定の金額表現を検出し混入していれば安全な警告文に差し替え）を追加し、再現テスト込みで解消した。
2. **`draft_reply`が顧客向けに固定されていた**: エンジニア向けの確認依頼を意図しても、常に「顧客向け返信案」ラベル・顧客向けトーンで出力されていた。`audience`パラメータ（`customer`/`engineer`）を追加し、宛先別に生成できるようにした。エンジニア向けは内部情報の共有を前提とするため`guardCustomerReplySection`の対象外。

修正後、PoC成功条件4点（状況把握・食い違い検出・顧客向け返信案・エンジニア向け返信案）を実データで確認済み。

## LPへの反映方針（Phase 2以降・現時点では反映しない）

マルチLLM会議（2026-08-31、4モデル中3モデルが「反映すべき」、lead役1モデルが「時期尚早」で意見が分かれた）を経て、**現時点（Phase 1・API経由のみ・管理UI未実装）ではLP（`henshin-hisho-lp-deploy`）に反映しない**と判断した。

反映しない理由（lead役の指摘、司令塔もこれを採用）:
- 現LPは「自分のメール受信箱1つを整理したい個人」向けの完成品訴求（月2,980円・即日使える）。新機能は「複数チャネルを跨ぐ案件を抱える人」向けで、API経由のみ・UIなしのPoCであり、同じ導線に並べると「UIないのに売るのか」という信頼毀損リスクがある。

Phase 2（管理UI完成）で反映する際は、以下を会議の合意事項として使う:
- **訴求の中心**: 「顧客とエンジニアの食い違いを検出する」（実例: 顧客3万円 vs エンジニア4万円）を主軸に、「情報漏洩を機械的に防ぐ」（実際に1件ブロックした実績）を信頼性の裏付けとして添える。「バラバラの会話を1案件に束ねる」は手段であって主訴求にしない。
- **キャラクター**: 新キャラは追加しない。**たぬ姉（慎重さ担当）の役割を「危ない返信を止める」から「会話の食い違い・情報漏洩を検知する」へ拡張**して位置づける（3モデルが合意）。
- **価格**: 据え置き（月2,980円、Founding Member価格のまま）。上位プラン化はPhase 3以降で検討。
- 会議の生ログ全文は司令塔のセッション記録を参照（LPリポジトリには保存していない）。
