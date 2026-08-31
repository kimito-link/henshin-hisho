# アカウント方針エンジン設計書 — 「君斗りんくのAI返信秘書」魅力最大化

> 設計=Fable(claude-fable-5)が途中クレジット切れのためOpusが代打・司令塔(Claude)が実コード裏取り。
> 2026-07-11。3段構えワークフロー(会議ハーネス→深い設計→実装引き継ぎ)の手順2の産物。
> 会議素材: `council-answers.json`(6体・design分類・critic2体)。地雷調査: Exploreエージェント実地調査。

## 差別化の核

単発の下書き生成ではなく、**「価格・値引き・セット売りの交渉方針を一度設定しておけば、以後すべての
下書きがその方針に必ず従う」アカウント方針レイヤー**。ChatGPTとの差はここに一本化する。

過剰設計を戒め、MVPは「①方針を1回設定する」「②その方針が下書きに必ず効く」の2点だけを完成させる。

## ★重要な訂正(Fable/Opus設計からの修正点)

Fable(→Opus代打)の設計案には「編集は管理者/オーナーに限定」という権限分離が書かれていたが、
**実コードには role/isAdmin/owner の概念が存在しない(1ユーザー=1アカウントのシンプルなモデル)**。
マルチユーザー権限は現状のデータモデルでは実装コストが高く、MVPスコープでは過剰(Critic指摘の
「複雑化による離脱」そのもの)。**MVPでは権限分離を作らない。ログイン済みユーザー本人が自分の
アカウント方針を編集する、既存のdigest/weeklyReport設定と全く同じ権限モデルに合わせる。**
複数担当者での共有が要る場合は別途「マルチユーザーアカウント」自体を設計してから乗せる話であり、
本設計のスコープ外。

## A. 理想の体験フロー

**ユーザー(現状は1アカウント1ユーザー)**
1. Web版の設定画面(既存の digest 設定・週次レポート設定と同じ並び)で `方針設定` を開く。
2. **業種テンプレを1つ選ぶ**(例: 「制作・受託」「物販・卸」「サービス業」)。テンプレが構造化フィールドを
   既定値で埋める。空欄から書かせない(離脱防止)。
3. 構造化フィールドを数個だけ確認・上書きする:
   - 値引き上限 `discountCeilingPercent`(例 20)
   - 最低受注額 `minOrderValueYen`
   - セット/まとめ売りの方針 `bundlePolicy`(選択肢)
   - 標準トーン `defaultTone`(既存 `draft-gen.js` の `DRAFT_TONE_INSTRUCTIONS` 語彙 `polite/firm/calm/casual` を流用。新語彙を作らない)
4. **例外ニュアンスだけ自由記述** `freeformNote`(上限1000字、既存 `normalizeText` で制限)。
5. 保存。保存のたびに `version` が+1、`updatedAt` を記録(既存 `nowSeconds()` パターン)。

**下書き生成時**
6. 受信箱で案件を開く。従来どおり `secretaryNote`(tone/intent/extraContext、item単位の一時指定)を
   任意で入れる。
7. 「下書きを作る」を押す。**アカウント方針が自動でプロンプトに追加される。**
8. 高リスク項目は従来どおり人間承認ゲート(`risk-gate.js`の`canGenerateDraft`)。方針エンジンは
   下書きの中身に影響するだけで、承認フローは一切変えない。

(下書き上部への「方針v○に基づく」表示はUIの任意改善であり、MVP必須ではない。Gに記載のMVP範囲外。)

## B. 統合アーキ(コンポーネント3+接続点)

```
[Web版 設定UI]                     [バックエンド]                        [下書き生成]
web-app/(settings)             backend/src/account-policy.js       backend/src/draft-gen.js
account-policy-settings.js  ──POST /account/policy-settings──▶  normalizeSecretaryNote/
  (既存settings.jsの並び)      normalizeAccountPolicy(patch)        buildDraftPrompt へ
                                accountPolicyForUser(user)           options.accountPolicy として注入
                                      │
                                 backend/src/kv.js
                                 putUser(env, updated)
                                 user.accountPolicy を保持
                                 (digest / weeklyReport と同じ階層)
```

1. **`backend/src/account-policy.js`(新規・唯一の正)** — `normalizeAccountPolicy(value)` /
   `accountPolicyForUser(user)` / `updateAccountPolicy(env, user, patch)` の3関数。
   `digest.js` の `normalizeDigestSettings` / `digestSettingsForUser` / `updateDigestSettings` と
   **完全に同じ関数構成**(実物: `digest.js:15-39`)。正規化ロジックはこの1ファイルのみに置く
   (CORS却下の教訓=ヘルパのコピー禁止)。
2. **`backend/src/draft-gen.js`(既存・最小拡張)** — `buildDraftPrompt(item, options)` の
   `options` に `accountPolicy` を含めて渡すだけ(現行シグネチャは `item, options` の2引数。
   3番目の引数を足すのではなく、既存の `options.tone`/`options.intent` と同じ経路で
   `options.accountPolicy` を渡す)。`lines.push` の並びに1ブロック差し込むだけで大改修なし。
3. **`web-app/`の設定画面(新規・Web版のみ)** — 既存のdigest設定・weeklyReport設定と同じ画面/フォームに
   セクション追加。**iOSの`www/`には絶対にコピーしない**。課金文言は一切置かない。

## C. 具体機構(ファイル・エンドポイント・スキーマ)

### データモデル(`user.accountPolicy`)

`auth.js`のuserオブジェクト直下に、`digest`/`weeklyReport`/`avgCaseValue`と並べて配置。
**保存は必ず `putUser(env, { ...user, accountPolicy: normalized, updatedAt: nowSeconds() })` の形**
(`digest.js:31-39`の`updateDigestSettings`と同一パターン)。部分マージ禁止。

```js
// backend/src/account-policy.js

export const DEFAULT_ACCOUNT_POLICY = Object.freeze({
  version: 0,
  industryTemplate: '',        // '' | 'seisaku' | 'butsuhan' | 'service' などテンプレID
  defaultTone: 'polite',       // draft-gen.js の DRAFT_TONE_INSTRUCTIONS のキーを流用
  discountCeilingPercent: null,// 0-100 または null(未設定)
  minOrderValueYen: null,      // 0以上の整数 または null(未設定)
  bundlePolicy: 'none',        // 'none' | 'encourage' | 'case_by_case'
  freeformNote: ''             // normalizeText で最大1000字
});

function normalizeAccountPolicy(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const discount = Number(source.discountCeilingPercent);
  const minOrder = Number(source.minOrderValueYen);
  const bundlePolicy = ['none', 'encourage', 'case_by_case'].includes(source.bundlePolicy)
    ? source.bundlePolicy : DEFAULT_ACCOUNT_POLICY.bundlePolicy;
  return {
    version: Number.isInteger(source.version) ? source.version : 0,
    industryTemplate: normalizeText(source.industryTemplate, 40),
    defaultTone: pickTone(source.defaultTone), // draft-gen.js の pickTone を import して再利用
    discountCeilingPercent: Number.isFinite(discount) ? Math.min(100, Math.max(0, discount)) : null,
    minOrderValueYen: Number.isFinite(minOrder) && minOrder >= 0 ? Math.floor(minOrder) : null,
    bundlePolicy,
    freeformNote: normalizeText(source.freeformNote, 1000)
  };
}

export function accountPolicyForUser(user = {}) {
  return normalizeAccountPolicy(user.accountPolicy);
}

export async function updateAccountPolicy(env, user, patch = {}) {
  const merged = normalizeAccountPolicy({ ...accountPolicyForUser(user), ...patch });
  const updated = {
    ...user,
    accountPolicy: { ...merged, version: accountPolicyForUser(user).version + 1 },
    updatedAt: nowSeconds()
  };
  await putUser(env, updated);
  return updated.accountPolicy;
}
```

`pickTone`は`draft-gen.js`からexportして再利用する(現状exportされていないため、
`draft-gen.js`側で`function pickTone`→`export function pickTone`に変更する1行修正が必要)。

### エンドポイント(`backend/src/index.js`に追加)

既存の`/account/digest-settings`・`/account/report-settings`(`index.js:182-187`)と同じ並びに追加:

```js
if (url.pathname === '/account/policy-settings' && request.method === 'POST') {
  return await policySettingsResponse(request, env);
}
```

`policySettingsResponse`は`digestSettingsResponse`と同型(`requireAuth`→`readJson`→
`updateAccountPolicy`→`jsonResponse`)。GETは`/account`の既存レスポンス(`accountResponse`)に
`accountPolicy: accountPolicyForUser(user)`を1行足すだけで十分(digest/weeklyReportと同じ扱い、
専用GETエンドポイントは不要)。

### `draft-gen.js`への注入

```js
// buildDraftPrompt 内、トーン行(現行51行目)の直後に追加
if (options.accountPolicy) {
  const p = options.accountPolicy;
  lines.push('', '【会社の方針(数値の制約は必ず守ること。言い回しは上記トーン指定を優先)】');
  if (p.discountCeilingPercent != null)
    lines.push(`- 値引きは最大${p.discountCeilingPercent}%まで。これを超える条件は提示せず、承認が必要な旨を添える。`);
  if (p.minOrderValueYen != null)
    lines.push(`- 最低受注額は${p.minOrderValueYen}円。`);
  if (p.bundlePolicy !== 'none')
    lines.push(`- まとめ売り方針: ${BUNDLE_POLICY_LABEL[p.bundlePolicy]}`);
  if (p.freeformNote)
    lines.push(`- 補足方針: ${p.freeformNote}`);
}
```

`inbox.js`の`handleDraft`(`inbox.js:147行〜`)で`generateDraftBody`を呼ぶ箇所に
`options.accountPolicy = accountPolicyForUser(auth.user)`を1行追加するだけで配線完了。

## D. Critic指摘への回答(過剰実装せず最小限で塞ぐ)

1. **ルールの動的適応性(値引き上限は顧客で変わるべき)** — MVPでは構造化フィールドは固定値のみ。
   顧客ごとの条件分岐エンジンは作らない(過剰)。`freeformNote`の一行で「長期客は緩めて可」とAIに
   委ねる。「固定の床(discountCeilingPercentは絶対に超えない安全弁)+自由記述の裁量」の二層で
   機敏性を最小コストで確保。
2. **既存トーン指定との競合(最重要・明記必須)** — 優先順位を1本に固定: 「言い回しはその場の
   `secretaryNote.tone`が優先。ただし`discountCeilingPercent`/`minOrderValueYen`の数値制約は、
   いかなるトーン指定でも上書きできない」。プロンプト内の固定文言(C参照)にこれを明記する。
3. **設定の複雑化による離脱** — 業種テンプレで既定値を埋め、構造化フィールドは4個+自由記述1個のみ。
   「空欄から書かせない」を徹底。
4. **バージョニング** — フル履歴は作らない(過剰)。`version`整数を1つ持つだけ。復元UIはMVP対象外。
5. **データ漏洩** — 既存KVの`putUser`保護と同格(auth.jsの既存認証で守られる)。新規暗号化層は
   追加しない(既存パターンとの不整合リスクの方が大きい)。
6. **権限分離** — ★上記「重要な訂正」のとおり、実データモデルにroleが無いためMVPでは実装しない。
   ログイン済み本人のみが編集できる(既存のdigest/weeklyReport設定と同じ権限)。

## E. LTV/価格設計

利用頻度×機能深度の3ティア。**課金導線はWeb版に完全集約、iOS/Androidは購入導線ゼロ**
(`ios-app/app.config.json`の`businessModel`・`ios-app/scripts/lint-pre-submission.mjs`の
文言チェックが機械的に強制)。

| ティア | 位置づけ | 含むもの |
|---|---|---|
| Free | ChatGPT同等 | トリアージ+単発トーン指定の下書き |
| **Standard(主力)** | 方針エンジン開放 | アカウント方針設定+方針準拠の下書き(本設計の核) |
| Premium | 将来 | 承認・エスカレーション自動化、顧客別条件分岐など |

課金導線は`web-app/billing/billing.js`の`portalUrl=''`(現状意図的に無効化中)をWeb版でのみ有効化。
iOSの`www/`には料金・課金関連の文言を一切入れない(既存の機械的lintゲートに従う)。

## F. LPリニューアル設計

新機能を**REASON 01・料金表・FAQ**の3点に集中配置(全セクションに散らさない)。

1. **ヒーロー**: 見出し「担当者が誰でも、会社の方針どおりに返信できる。」
2. **選ばれる3つの理由・REASON 01**: 「会社の方針を"裏プロンプト"として一度だけ設定」
   ── 設定画面スクショ。「値引き上限・最低受注額・まとめ売り方針を決めておけば、以後すべての
   下書きが自動で従う」。
3. **セキュリティ**: 「方針・価格情報は既存の認証で保護」「更新日時を記録」(実装Dの`updatedAt`が
   そのまま訴求点)。
4. **料金表**: Standardの説明を「担当者が誰でもブレない ── 方針エンジン開放」に。
5. **FAQ**: 「Q. ChatGPTと何が違う? → A. 会社の交渉・価格方針を一度設定すれば、以後の下書きが
   すべてその方針に従います」。

(他10セクションは既存のLP型を踏襲。詳細はIMPLEMENTATION-HANDOFFに転記しない=LPリニューアルは
別タスクとして切り出す。)

## G. MVP(最初の1つだけ作るなら)

**「アカウント方針を1回設定→その方針が下書きに必ず効く(Web版限定)」の一気通貫。**

具体的に作るのは4点:
1. `backend/src/account-policy.js` 新規(C節のコード)。
2. `backend/src/draft-gen.js`: `pickTone`をexport化+`buildDraftPrompt`に方針ブロック追加。
3. `backend/src/inbox.js`: `handleDraft`で`options.accountPolicy`を渡す1行。
4. `backend/src/index.js`: `/account/policy-settings`(POST)ルート追加、`/account`(GET)レスポンスに
   `accountPolicy`を1行追加。
5. Web版の設定画面に方針設定フォームを1つ追加(既存settings画面の並び)。

含めないもの: 権限分離、顧客別条件分岐、バージョン履歴の復元、新規暗号化層、承認フロー自動化、
iOS/Android対応、下書き画面への「方針v○表示」UI。これらは全部あとで足せる。

**「値引き上限を20%に設定→30%要求のメールに、20%までしか提示しない下書きが出る」が動けば
価値証明は完了。**

## H. 捨てた案と理由

- **顧客別・取引履歴別の動的ルールエンジン** — MVPには過剰。`freeformNote`の裁量委任で当面代替。
- **権限分離(管理者のみ編集)** — 実データモデルに存在しないマルチユーザー概念を前提としており、
  MVPスコープでは実装コストが見合わない。★上記「重要な訂正」参照。
- **フルなルールバージョン履歴/差分ビュー/ロールバック** — `version`整数1個で整合性担保は足りる。
- **独立した機密データ暗号化サービス** — 既存user同格の保護で必要十分。新層はCORS型の複製バグを招く。
- **iOS/Androidでの方針設定UI** — 3.1.3(f)カーブアウトとlint地雷。Web版に集約。
- **ヒューマンオンデマンド校正オプション**(会議のcriticからの逆張り案) — 別事業に近い。不採用。
- **下書き画面への「方針v◯に基づく」表示バッジ** — UI改善として良いが、MVPの価値証明には不要。
  MVPが動いてから追加を検討。

## I. 地雷と回避策

1. **KV丸ごと上書きのレース** — 保存は例外なく`putUser(env, { ...user, accountPolicy, updatedAt })`。
   `digest.js`/`weekly-report.js`と同じ保存経路を通し、独自ロジックを書かない。
2. **正規化ヘルパの複製(CORS 3連続却下の真因と同型のバグパターン)** — `normalizeAccountPolicy`は
   `account-policy.js`の1箇所のみ。`normalizeText`は`schema.js`の既存関数を`import`して使う
   (新規に同名関数を作らない)。
3. **iOS審査(3.1.3(f) + lint-pre-submission.mjs)** — 方針UI・料金文言をiOSの`www/`に一切入れない。
   `web-app/`にのみ実装。iOSは既に4回却下歴があり要注意。
4. **課金導線** — `billing.js`の`portalUrl=''`は意図的プレースホルダ。有効化はWeb版のみ。
5. **draft-gen.jsの改修範囲** — `buildDraftPrompt`のシグネチャ(`item, options`)は変えない。
   `options.accountPolicy`として渡す。既存の`lines.push`順次構造・item単位の`secretaryNote`は温存。
6. **トーン競合の未定義** — 優先順位「言い回しはsecretaryNote.tone優先/数値制約は方針が絶対」を
   プロンプトの固定文言として明記し、曖昧なまま出荷しない。
7. **権限分離の誤実装** — 実データモデルにrole/isAdminが無いことを忘れて権限チェックを書こうと
   すると、存在しないフィールドを参照してバグる。MVPでは権限分離自体を作らない(H参照)。

---

**設計上の要点(1行)**: 新規は`account-policy.js`1ファイル+エンドポイント1本+GET拡張1行+
`draft-gen.js`のoptions受け渡し+Web設定画面1枚。既存パターン(digest/weekly-reportの正規化・
丸ごと上書き・Web限定課金)を一切逸脱せず、方針の絶対制約(数値)とトーン裁量(言い回し)の優先順位
だけを明文で固定する。権限分離は実データモデルに合わせてMVPスコープ外とする。
