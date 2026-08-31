# 実装ハンドオフ — アカウント方針エンジン(MVP)

> **この1枚だけで着手できる。** 設計の背景・議論は [ACCOUNT-POLICY-ENGINE-DESIGN.md](ACCOUNT-POLICY-ENGINE-DESIGN.md) 参照。
> 実装は次チャット/別モデルで。バックエンドは `henshin-hisho/backend`(git管理外・単体npmプロジェクト)。

## スコープ(MVPのみ・これ以上広げない)

「アカウント方針を1回設定→その方針が下書きに必ず効く」の一気通貫。**Web版のみ**。iOS/Androidの
`www/`には一切触れない。権限分離(管理者限定)は実装しない(理由: 設計書の「重要な訂正」参照)。

## 着手手順(ブランチ+TDD)

```bash
cd "C:/Users/info/OneDrive/デスクトップ/Resilio/github/henshin-hisho/backend"
git status   # 既存の変更が残っていないか確認(このリポはgit管理外なので念のためファイル差分で確認)
```

このリポはgit管理外なので、着手前に `src/` を丸ごとバックアップ(例: `src.bak-<日付>`)してから進める
(CORS-FIX-HANDOFF.mdの前例と同じ運用)。

### 1. `backend/src/account-policy.js` を新規作成

`backend/src/digest.js`(全39行)を下敷きにする。以下をそのまま作る:

```js
import { nowSeconds } from './crypto.js';
import { putUser } from './kv.js';
import { normalizeText } from './schema.js';
import { pickTone } from './draft-gen.js'; // ★2で export化が必要

export const DEFAULT_ACCOUNT_POLICY = Object.freeze({
  version: 0,
  industryTemplate: '',
  defaultTone: 'polite',
  discountCeilingPercent: null,
  minOrderValueYen: null,
  bundlePolicy: 'none',
  freeformNote: ''
});

const BUNDLE_POLICIES = new Set(['none', 'encourage', 'case_by_case']);

function normalizeAccountPolicy(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const discount = Number(source.discountCeilingPercent);
  const minOrder = Number(source.minOrderValueYen);
  return {
    version: Number.isInteger(source.version) ? source.version : 0,
    industryTemplate: normalizeText(source.industryTemplate, 40),
    defaultTone: pickTone(source.defaultTone),
    discountCeilingPercent: Number.isFinite(discount) ? Math.min(100, Math.max(0, discount)) : null,
    minOrderValueYen: Number.isFinite(minOrder) && minOrder >= 0 ? Math.floor(minOrder) : null,
    bundlePolicy: BUNDLE_POLICIES.has(source.bundlePolicy) ? source.bundlePolicy : DEFAULT_ACCOUNT_POLICY.bundlePolicy,
    freeformNote: normalizeText(source.freeformNote, 1000)
  };
}

export function accountPolicyForUser(user = {}) {
  return normalizeAccountPolicy(user.accountPolicy);
}

export async function updateAccountPolicy(env, user, patch = {}) {
  const currentVersion = accountPolicyForUser(user).version;
  const merged = normalizeAccountPolicy({ ...accountPolicyForUser(user), ...patch, version: currentVersion });
  const updated = {
    ...user,
    accountPolicy: { ...merged, version: currentVersion + 1 },
    updatedAt: nowSeconds()
  };
  await putUser(env, updated);
  return updated.accountPolicy;
}
```

### 2. `backend/src/draft-gen.js` を編集(2箇所)

**2a. `pickTone`をexportする**(現在1行目、非export):
```diff
- function pickTone(value) {
+ export function pickTone(value) {
```

**2b. `buildDraftPrompt`のトーン行の直後(現行51行目 `` `トーン: ${DRAFT_TONE_INSTRUCTIONS[note.tone]}` `` の次)に追加**:
```js
const BUNDLE_POLICY_LABEL = {
  encourage: 'まとめ売りを積極的に提案してよい',
  case_by_case: 'まとめ売りは状況に応じて提案する'
};

// buildDraftPrompt内、lines配列の組み立て中(51行目の直後)に:
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

### 3. `backend/src/inbox.js` を編集(1箇所)

`handleDraft`関数(147行目〜)内、`generateDraftBody`呼び出しの直前に`accountPolicy`を`options`へ追加:

```diff
+ import { accountPolicyForUser } from './account-policy.js';
  ...
  const body = await generateDraftBody({ ...item, secretaryNote }, {
    callLLM: (args) => callOpenRouter(env, args, options),
+   accountPolicy: accountPolicyForUser(auth.user)
  });
```

(既存の`callLLM`と同じ`options`オブジェクトに`accountPolicy`キーを足すだけ。`generateDraftBody`→
`buildDraftPrompt`へは`options`がそのまま渡っているので、これで配線完了。)

### 4. `backend/src/index.js` を編集(2箇所)

**4a. import追加**(既存の`digestSettingsForUser`等のimportの並びに):
```js
import { accountPolicyForUser, updateAccountPolicy } from './account-policy.js';
```

**4b. `accountResponse`(43行目)の`settings`オブジェクトに1行追加**:
```diff
  settings: {
    digest: digestSettingsForUser(auth.user),
    weeklyReport: weeklyReportSettingsForUser(auth.user),
+   accountPolicy: accountPolicyForUser(auth.user),
    avgCaseValue: Number(auth.user.avgCaseValue || 0)
  },
```

**4c. `digestSettingsResponse`(88行目)を下敷きに新規関数を追加**:
```js
async function policySettingsResponse(request, env) {
  try {
    const auth = await requireAuth(request, env);
    if (!auth.ok) return jsonResponse(request, env, auth.body, auth.status);
    const payload = await readJson(request);
    if (!payload) return jsonResponse(request, env, { ok: false, reason: 'invalid_json' }, 400);
    const accountPolicy = await updateAccountPolicy(env, auth.user, payload);
    return jsonResponse(request, env, { ok: true, accountPolicy });
  } catch {
    return jsonResponse(request, env, { ok: false, reason: 'server_error' }, 500);
  }
}
```

**4d. ルート登録**(`/account/digest-settings`のルート判定の並びに追加。`index.js`内で
`url.pathname === '/account/digest-settings'`を検索し、その直後に):
```js
if (url.pathname === '/account/policy-settings' && request.method === 'POST') {
  return await policySettingsResponse(request, env);
}
```

### 5. テスト新規作成: `backend/test/account-policy.test.js`

`backend/test/digest.test.js`の構造(`createMemoryKv`のモック含む)を下敷きに、最低限これだけ:

```js
import assert from 'node:assert/strict';
import { accountPolicyForUser, updateAccountPolicy } from '../src/account-policy.js';

// 1. 未設定ユーザーは DEFAULT_ACCOUNT_POLICY を返す
// 2. updateAccountPolicy で保存した discountCeilingPercent が読み戻せる
// 3. version が保存のたびに +1 される
// 4. discountCeilingPercent に 150 を渡すと 100 にクランプされる(0-100範囲外の丸め込み確認)
// 5. buildDraftPrompt に accountPolicy を渡すと、プロンプト文字列に
//    「値引きは最大◯%まで」の一行が含まれる(draft-gen.jsのimportで直接呼んで文字列アサート)
```

`package.json`の`test`スクリプト(`node test/auth.test.js && ... && node test/cors.test.js`)の並びに
`node test/account-policy.test.js`を追加すること。

### 6. 動作確認(machine-checkable)

```bash
cd "C:/Users/info/OneDrive/デスクトップ/Resilio/github/henshin-hisho/backend"
npm test   # 新規テスト含め全緑を確認
```

さらにローカルでも良いので実際にAPIを叩いて確認:
```bash
# ログイン→policy-settings保存→下書き生成→プロンプトに反映を実地確認
# (verify-reviewer-account.mjs 相当の使い捨てスクリプトで可。既存の reviewer 資格情報を流用)
```

### 7. Web版UI(`web-app/`)

既存の設定画面(digest設定・weeklyReport設定が並ぶ画面。`web-app/app.js`の`renderSettings`相当を検索)
に、以下のフォームを1セクション追加:

- 業種テンプレのセレクトボックス(選ぶと下のフィールドに既定値を仮入力。テンプレ定義自体はこの
  ハンドオフのスコープ外でよい=空でもMVPは成立する。テンプレ機能は「あれば良い」レベル)
- 値引き上限(数値input, %)
- 最低受注額(数値input, 円)
- まとめ売り方針(セレクト: なし/積極的に提案/状況に応じて)
- 補足方針(textarea, 1000字)
- 保存ボタン → `POST /account/policy-settings`

**iOSの`www/`には絶対にこのフォームをコピーしない。** `ios-app/scripts/lint-pre-submission.mjs`の
文言チェックに引っかかる語("課金"等)は使っていないので言葉遣い自体はiOS的に問題ないが、方針として
Web限定に留める(将来の機能追従もこの1画面だけ触ればよいようにするため)。

## 完了判定(機械的)

- [ ] `npm test`が新規テスト込みで全緑
- [ ] `POST /account/policy-settings`にdiscountCeilingPercent=20を送り、`GET /account`の
      `settings.accountPolicy.discountCeilingPercent`が20で返る
- [ ] 上記の状態で下書き生成APIを叩き、レスポンスの`draft.body`(またはプロンプトの中間ログ)に
      「値引きは最大20%まで」の文言が含まれる
- [ ] `git diff`(または手動diff)で`ios-app/www/`・`android-app/www/`に一切変更が無いことを確認

## 地雷(再掲・実装時に踏みやすい順)

1. `putUser`は**丸ごと上書き**。`{ ...user, accountPolicy, updatedAt }`の形を厳守。部分マージ厳禁。
2. `pickTone`は現状non-export。忘れると`account-policy.js`のimportがエラーになる。
3. `buildDraftPrompt`のシグネチャは変えない(`item, options`のまま)。第3引数を足さない。
4. 権限分離は実装しない(role/isAdminフィールドが存在しないため、書こうとすると存在しないものを
   参照してバグる)。
5. iOSの`www/`・Androidの`www/`には一切手を触れない。

## 次にやること

このハンドオフを次のチャット(または別モデル)に渡し、「ブランチを切ってTDDで実装して」と指示する。
実装後は`reality-checker`エージェントで動作確認(自己採点しない)。
