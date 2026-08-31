#!/usr/bin/env node
// 移植元: partnership_program_website/scripts/lint-pre-submission.mjs
//   (リバースハック固有の Clerk / partner URL / client・server パスのハードコードを除去し、
//    app.config.json 駆動 + 環境変数オーバーライド + 「ファイルが無ければ skip」に一般化)。
//
// 審査前 lint — このキットで実証済みの Apple 却下ベクタを、ストア提出CIが
// Apple に送る前に検出する。`node scripts/lint-pre-submission.mjs` で手動実行、
// または CI(ios/android release の前段)で走らせる。
//
// 各チェックは独立。すべての失敗を集めて、blocking が1つでもあれば exit 1。
// warning(非 blocking)は表示するが exit は止めない。
//
// ガイドライン別の背景は _docs/apple-reject-knowledge-base.md を参照。
//
// 環境変数(アプリのレイアウトに合わせて上書き可能。未指定なら既定パスを探す):
//   APP_SIGNIN_GLOB        ログイン関連 source(既定: client/src/**, src/**)
//   APP_RELEASE_WORKFLOW   iOS release workflow(既定: .github/workflows/ios-appstore-release.yml)
//   APP_PLAY_WORKFLOW      Android release workflow(既定: .github/workflows/android-play-release.yml)
//   APP_PLATFORM_SCAN_DIRS 2.3.10 platform 参照を grep するディレクトリ(カンマ区切り、既定: store-assets,release-notes)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ANSI_RED = '\x1b[31m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_DIM = '\x1b[2m';
const ANSI_RESET = '\x1b[0m';

const failures = [];
const warnings = [];

function fail(name, guideline, message) {
  failures.push({ name, guideline, message });
}
function warn(name, guideline, message) {
  warnings.push({ name, guideline, message });
}
function ok(name, detail) {
  console.log(`${ANSI_GREEN}✓${ANSI_RESET} ${name}${detail ? `  ${ANSI_DIM}${detail}${ANSI_RESET}` : ''}`);
}
function skip(name, why) {
  console.log(`${ANSI_DIM}- ${name} (skip: ${why})${ANSI_RESET}`);
}

function readFile(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}
function readJson(rel) {
  const c = readFile(rel);
  return c ? JSON.parse(c) : null;
}
function* walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkDir(full);
    else yield full;
  }
}

const appConfig = readJson('app.config.json');
const pkg = readJson('package.json');
const cap = readJson('capacitor.config.json');

// ----------------------------------------------------------------------------
// CHECK 1 — version が semver X.Y.Z(meta)
// ----------------------------------------------------------------------------
const marketingVersion = appConfig?.stores?.marketingVersion || pkg?.version;
if (!marketingVersion) {
  warn('version-present', 'meta', 'app.config.json stores.marketingVersion も package.json version も無い');
} else if (!/^\d+\.\d+\.\d+$/.test(String(marketingVersion))) {
  fail('version-semver', 'meta', `version "${marketingVersion}" が semver X.Y.Z でない`);
} else {
  ok('version-semver', `version = ${marketingVersion}`);
}

// ----------------------------------------------------------------------------
// CHECK 2 — Bundle ID 整合(capacitor.config.json appId == app.config bundleId)
// ----------------------------------------------------------------------------
const bundleId = appConfig?.identity?.bundleId;
if (cap && bundleId && !String(bundleId).startsWith('<')) {
  if (cap.appId !== bundleId) {
    fail('bundle-id-consistency', 'meta', `capacitor.config.json appId="${cap.appId}" != app.config bundleId="${bundleId}"`);
  } else {
    ok('bundle-id-consistency', cap.appId);
  }
} else if (cap) {
  skip('bundle-id-consistency', 'app.config bundleId が未設定 or capacitor.config 無し');
}

// ----------------------------------------------------------------------------
// CHECK 3 — 2.3.10 他プラットフォーム参照(Apple に送るメタデータに混入させない)
// ----------------------------------------------------------------------------
const banned = ['Android', 'Google Play', 'Play Store', 'Galaxy Store', 'Amazon Appstore', 'Material Design'];
const scanDirs = (process.env.APP_PLATFORM_SCAN_DIRS || 'store-assets/appstore,release-notes')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
let scannedAny = false;
let platformHit = false;
for (const dir of scanDirs) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  scannedAny = true;
  for (const f of walkDir(abs)) {
    if (!/\.(txt|md|json)$/i.test(f)) continue;
    const c = fs.readFileSync(f, 'utf8');
    const hits = banned.filter((w) => c.toLowerCase().includes(w.toLowerCase()));
    if (hits.length > 0) {
      platformHit = true;
      fail('platform-references', '2.3.10', `${path.relative(ROOT, f)}: ${hits.join(', ')}`);
    }
  }
}
if (!scannedAny) {
  skip('platform-references', `スキャン対象ディレクトリが無い (${scanDirs.join(', ')})`);
} else if (!platformHit) {
  ok('platform-references', `iOS メタデータに Android/Play 等の混入なし`);
}

// ----------------------------------------------------------------------------
// CHECK 4 — App Review 用 URL(app.config.json contact.*)
// ----------------------------------------------------------------------------
if (appConfig) {
  const urls = [
    ['supportUrl', appConfig.contact?.supportUrl],
    ['privacyUrl', appConfig.contact?.privacyUrl],
    ['marketingUrl', appConfig.contact?.marketingUrl],
  ];
  // dataDeletionUrl は「アカウント作成があるアプリ」のみ必須。businessModel から推定できないので warn。
  const dataDeletion = appConfig.contact?.dataDeletionUrl;
  const missing = urls.filter(([, v]) => !v || String(v).startsWith('<') || !/^https:\/\//.test(String(v)));
  if (missing.length > 0) {
    fail('app-config-review-urls', 'privacy/5.1.1(v)', `contact URL が未設定 or 非https: ${missing.map(([k]) => k).join(', ')}`);
  } else {
    ok('app-config-review-urls', 'support / privacy / marketing URL あり');
  }
  if (!dataDeletion || String(dataDeletion).startsWith('<')) {
    warn('account-deletion-url', '5.1.1(v)', 'contact.dataDeletionUrl 未設定。アカウント作成があるアプリは削除導線が必須(iOS16+)');
  } else if (/^https:\/\//.test(String(dataDeletion))) {
    ok('account-deletion-url', 'dataDeletionUrl あり');
  }
} else {
  skip('app-config-review-urls', 'app.config.json が無い');
}

// ----------------------------------------------------------------------------
// CHECK 5 — 2.3.3 スクショ capture は「ログイン後」を撮る(ログイン認証アプリのみ)
// v1.0.7: capture が未認証 /sign-in を撮り 2.3.3 却下。fail-closed を固定する。
// ログイン不要アプリは IOS_REVIEW_DEMO_* を使わないので skip 扱い。
// ----------------------------------------------------------------------------
const captureScript = readFile('scripts/capture-appstore-screenshots.mjs');
if (!captureScript) {
  warn('screenshot-capture-script', '2.3.3', 'scripts/capture-appstore-screenshots.mjs が無い(committed スクショ運用なら可)');
} else {
  // 認証方式は2通り: Clerk等の直接ログイン(IOS_REVIEW_DEMO_USERNAME/_PASSWORD)、
  // またはCI直接ログインがbot検知で弾かれるアプリ向けの storageState 再利用
  // (IOS_REVIEW_STORAGE_STATE_JSON_BASE64。名前はIOS_だがAndroid captureとも共用可)。
  const usesDemo = captureScript.includes('IOS_REVIEW_DEMO_USERNAME') && captureScript.includes('IOS_REVIEW_DEMO_PASSWORD');
  const usesStorageState = captureScript.includes('IOS_REVIEW_STORAGE_STATE_JSON_BASE64');
  const usesAuth = usesDemo || usesStorageState;
  const failsClosed = /process\.exit\(1\)/.test(captureScript);
  if (!usesAuth) {
    // ログイン不要アプリ(public 画面のみで価値が伝わる)では正当。warn に留める。
    warn(
      'screenshot-capture-auth',
      '2.3.3',
      'capture が IOS_REVIEW_DEMO_USERNAME/_PASSWORD も IOS_REVIEW_STORAGE_STATE_JSON_BASE64 も ' +
        '読まない。ログイン認証アプリならログイン後画面を撮らないと v1.0.7 と同じ 2.3.3 却下になる。' +
        'ログイン不要アプリなら無視可。',
    );
  } else if (!failsClosed) {
    fail('screenshot-capture-failclosed', '2.3.3', 'creds 欠落時に process.exit(1) しない。silent fallback は 2.3.3 を再発させる');
  } else {
    ok('screenshot-capture-auth', 'capture はログインして fail-closed');
  }

  // CHECK 5b — 2.3.3 マーケ訴求カバーが App Store スクショ枠を占有しないか
  // Submission 0830fcff(2026-07-08)で却下: capture が store-assets/covers/ の
  // 表紙(iphone-*-0{a,b,c}.png)を OUT_DIR にコピーし、"0x" が実タブ(-1,-2)より前に
  // ソートされてスクショ先頭を占有 → 「大半が実アプリUIでない」と 2.3.3 却下。
  // capture が covers を出力へ混ぜるコードを持つなら fail。
  const mergesCovers =
    /store-assets\/covers|COVERS_DIR/.test(captureScript) &&
    /copyFileSync|cp\(|fs\.copy/.test(captureScript) &&
    !/カバー.*混ぜない|do not (merge|mix) cover|no cover merge/i.test(captureScript);
  if (mergesCovers) {
    fail(
      'screenshot-no-marketing-cover',
      '2.3.3',
      'capture が store-assets/covers/ の訴求カバーをスクショ出力に混ぜている。' +
        'カバーは実アプリUIでなく先頭枠を占有し 2.3.3 却下の原因(Submission 0830fcff)。' +
        'カバーmergeを削除し、スクショは実アプリUI(受信箱/返信下書き/設定)のみにすること。',
    );
  } else {
    ok('screenshot-no-marketing-cover', 'スクショにマーケ訴求カバーの混入なし');
  }
}

// ----------------------------------------------------------------------------
// CHECK 6 — 2.3.3 スクショ upload は delete-then-reupload(slot 内の stale を残さない)
// v1.0.8: filename 一致で skip した結果、slot1 に旧ログイン画面が残り再却下。
// ----------------------------------------------------------------------------
const ssUpload = readFile('scripts/lib/asc-screenshot-upload.mjs');
if (!ssUpload) {
  skip('screenshot-upload-delete-then-reupload', 'scripts/lib/asc-screenshot-upload.mjs が無い');
} else {
  const callsDelete = /deleteAllScreenshots\s*\(/.test(ssUpload);
  const hasDeleteApi = /['"]DELETE['"]/.test(ssUpload) && /appScreenshots\//.test(ssUpload);
  const hasFilenameSkip = /already uploaded; skipping/.test(ssUpload);
  if (!callsDelete || !hasDeleteApi) {
    fail(
      'screenshot-upload-delete-then-reupload',
      '2.3.3',
      `asc-screenshot-upload.mjs は再upload前に deleteAllScreenshots + DELETE /v1/appScreenshots/{id} を ` +
        `呼ぶこと(callsDelete=${callsDelete} hasDeleteApi=${hasDeleteApi})。ASC slot は versionString を跨いで persist する。`,
    );
  } else if (hasFilenameSkip) {
    warn('screenshot-upload-stale-skip', '2.3.3', '"already uploaded; skipping" の legacy dedup 文字列が残っている。到達不能か確認');
    ok('screenshot-upload-delete-then-reupload', 'delete-then-reupload あり(warn: legacy 文字列残存)');
  } else {
    ok('screenshot-upload-delete-then-reupload', 'delete-then-reupload あり');
  }
}

// ----------------------------------------------------------------------------
// CHECK 7 — release workflow の path filter が提出スクリプトを全て含む
// v1.0.8 retry#1: capture script が on.push.paths に無く、修正 push が silent no-op。
// ----------------------------------------------------------------------------
function checkWorkflowPaths(rel, requiredScripts, label) {
  const wf = readFile(rel);
  if (!wf) {
    skip(`${label}-workflow-paths`, `${rel} が無い`);
    return;
  }
  const m = wf.match(/\n {4}paths:\n([\s\S]*?)(?=\n[a-z][a-zA-Z_-]*:)/);
  const block = m ? m[1] : '';
  if (!block) {
    // path filter 無し = 全 push でトリガ(または別 on トリガ)。warn に留める。
    warn(`${label}-workflow-paths`, 'process', `${rel} に on.push.paths が無い。提出スクリプト修正が再ビルドをトリガするか確認`);
    return;
  }
  // workflow が実際に実行している script のみ必須化(invoke していないものは false flag しない)。
  const required = requiredScripts.filter((s) => wf.includes(`scripts/${s}`));
  const missing = required.filter((s) => !block.includes(`scripts/${s}`));
  if (missing.length > 0) {
    fail(`${label}-workflow-paths`, 'process', `${rel} の on.push.paths に提出スクリプトが欠落: ${missing.join(', ')}(修正 push が再トリガしない)`);
  } else if (required.length > 0) {
    ok(`${label}-workflow-paths`, `${required.length} scripts が path filter に存在`);
  } else {
    skip(`${label}-workflow-paths`, 'workflow が該当スクリプトを invoke していない');
  }
}
checkWorkflowPaths(
  process.env.APP_RELEASE_WORKFLOW || '.github/workflows/ios-appstore-release.yml',
  ['appstore-submit.mjs', 'capture-appstore-screenshots.mjs', 'frame-appstore-screenshots.mjs', 'lib/asc-api.mjs', 'lib/asc-screenshot-upload.mjs'],
  'ios',
);
checkWorkflowPaths(
  process.env.APP_PLAY_WORKFLOW || '.github/workflows/android-play-release.yml',
  ['play-publish.mjs', 'play-fill-listing.mjs', 'play-fill-data-safety.mjs', 'capture-play-screenshots.mjs', 'lib/play-api.mjs'],
  'android',
);

// ----------------------------------------------------------------------------
// CHECK 8 — Play スクショ capture も fail-closed(CHECK 5 の Play 版)
// ----------------------------------------------------------------------------
const playCapture = readFile('scripts/capture-play-screenshots.mjs');
if (!playCapture) {
  skip('play-capture-auth', 'scripts/capture-play-screenshots.mjs が無い');
} else {
  const usesDemo = playCapture.includes('IOS_REVIEW_DEMO_USERNAME') && playCapture.includes('IOS_REVIEW_DEMO_PASSWORD');
  const usesStorageState = playCapture.includes('IOS_REVIEW_STORAGE_STATE_JSON_BASE64');
  const usesAuth = usesDemo || usesStorageState;
  const failsClosed = /process\.exit\(1\)/.test(playCapture);
  if (!usesAuth) {
    warn(
      'play-capture-auth',
      '2.3.3',
      'Play capture が demo creds も IOS_REVIEW_STORAGE_STATE_JSON_BASE64 も読まない。' +
        'ログイン認証アプリならログイン後を撮ること。',
    );
  } else if (!failsClosed) {
    fail('play-capture-failclosed', '2.3.3', 'Play capture も creds 欠落時 exit 1 すること');
  } else {
    ok('play-capture-auth', 'Play capture はログインして fail-closed');
  }
}

// ----------------------------------------------------------------------------
// CHECK 9 — Capacitor WebView 黒画面/ATS の静的チェック
//   _docs/CAPACITOR-GOLDEN-RULES.md をコード化。server.url が cleartext(http)だと
//   ATS にブロックされ黒画面になる。NSAllowsArbitraryLoads の乱用も審査で指摘される。
//   このキットの真実の源は capacitor.config.ts(原則2)。.ts をテキスト走査し、
//   無ければ .json に fallback。{{...}} プレースホルダ(未コピーのテンプレ)は skip。
// ----------------------------------------------------------------------------
{
  const capTs = readFile('capacitor.config.ts');
  const capJson = capTs != null ? null : readJson('capacitor.config.json');
  const capSource = capTs != null ? capTs : (readFile('capacitor.config.json') || null);
  const sourceName = capTs != null ? 'capacitor.config.ts' : 'capacitor.config.json';
  // server.url は「server ブロック内の url」に限定する。プラグイン等の別の url: を誤読すると
  // false fail/false ok になる(レビュー指摘 HIGH)。
  //   - .json: JSON.parse して server.url を直読み(最も確実)。
  //   - .ts  : `server: { ... }` ブロックを切り出してから、その中の url: だけ拾う。
  let serverUrl = null;
  if (capJson) {
    serverUrl = capJson.server?.url ?? null;
  } else if (capSource) {
    const serverBlock = capSource.match(/\bserver\s*:\s*\{([\s\S]*?)\}/);
    const scope = serverBlock ? serverBlock[1] : '';
    const urlMatch = scope.match(/\burl\s*:\s*['"]([^'"]+)['"]/);
    serverUrl = urlMatch ? urlMatch[1] : null;
  }
  const isPlaceholderUrl = serverUrl ? /\{\{|<\.\.\.>|example\.com/.test(serverUrl) : false;
  // cleartext:true は server ブロック内に限定して判定(別ブロックの同名キー誤読を避ける)。
  const serverScope = capJson
    ? JSON.stringify(capJson.server || {})
    : (capSource?.match(/\bserver\s*:\s*\{([\s\S]*?)\}/)?.[1] || '');

  if (!capSource) {
    skip('capacitor-server-cleartext', 'capacitor.config.(ts|json) が無い(server.url 連動型でなければ可)');
  } else if (!serverUrl) {
    // バンドル型(server.url 無し)は正当。原則1では連動型が標準だが、ここでは fail にしない。
    skip('capacitor-server-cleartext', `${sourceName} に server.url が無い(バンドル型なら可)`);
  } else if (isPlaceholderUrl) {
    skip('capacitor-server-cleartext', `${sourceName} の server.url が未コピーのプレースホルダ`);
  } else if (/^http:\/\//i.test(serverUrl)) {
    fail('capacitor-server-cleartext', 'ATS', `${sourceName} server.url が http:// (cleartext)。ATS にブロックされ黒画面の原因になる: ${serverUrl}`);
  } else if (!/^https:\/\//i.test(serverUrl)) {
    warn('capacitor-server-scheme', 'ATS', `${sourceName} server.url が https:// でない: ${serverUrl}`);
  } else {
    // cleartext:true が明示されていれば http 読込を許してしまうので警告(server ブロック内のみ)。
    // .ts の `cleartext: true` と .json の `"cleartext":true` 両対応。
    if (/["']?cleartext["']?\s*:\s*true\b/.test(serverScope)) {
      warn('capacitor-cleartext-flag', 'ATS', `${sourceName} server に cleartext: true。https 運用では不要。意図しない http 読込を許す`);
    }
    ok('capacitor-server-cleartext', `server.url = ${serverUrl} (https)`);
  }

  // Info.plist の NSAllowsArbitraryLoads=true は ATS を全面無効化する。審査指摘リスク。
  const infoPlist = readFile('ios/App/App/Info.plist');
  if (infoPlist == null) {
    skip('ats-arbitrary-loads', 'ios/App/App/Info.plist が無い(CI で cap copy 後に生成)');
    // <true/>(短縮形, Xcode/plutil の既定)と <true></true>(手書き長形式)の両方を拾う。
  } else if (/<key>\s*NSAllowsArbitraryLoads\s*<\/key>\s*<true\s*\/?>(<\/true>)?/.test(infoPlist)) {
    warn('ats-arbitrary-loads', 'ATS', 'Info.plist NSAllowsArbitraryLoads=true。ATS 全面無効化は審査で指摘されうる。必要な例外ドメインだけ許可に絞る');
  } else {
    ok('ats-arbitrary-loads', 'NSAllowsArbitraryLoads の乱用なし');
  }
}

// ----------------------------------------------------------------------------
// CHECK 10〜13 — ASC の Read-Only 検証(contentRightsDeclaration / App プライバシー公開 /
//   配信地域 / reviewer デモ値の stale)。creds + bundleId があるときだけ有効化。
//   _docs/FIRST-SUBMISSION-blockers.md B7/B8 を「症状が出てから直す」から
//   「submit 前に API で読み取って止める」ゲートに昇格する。
//   API 呼び出しはこの区画のみ。ローカルで creds が無ければ skip し高速フィードバックを壊さない。
// ----------------------------------------------------------------------------
{
  const { hasAscCreds, runAscReadonlyChecks } = await import('./lib/asc-readonly-checks.mjs');
  const ascBundleId = appConfig?.identity?.bundleId;
  if (!ascBundleId || String(ascBundleId).startsWith('<')) {
    skip('asc-readonly-manual-items', 'app.config identity.bundleId が未設定');
  } else if (!hasAscCreds()) {
    skip('asc-readonly-manual-items', 'APPSTORE_CONNECT_* creds が無い(ローカル実行)');
  } else {
    const results = await runAscReadonlyChecks(ascBundleId);
    for (const { name, guideline, result } of results) {
      if (result.status === 'fail') fail(name, guideline, result.detail);
      else if (result.status === 'warn') warn(name, guideline, result.detail);
      else ok(name, result.detail);
    }
  }
}

// ----------------------------------------------------------------------------
// CHECK 14 — 直近 bump で SW キャッシュ版数の更新がスキップされていないか
//   release-bump.mjs が release-history/<version>.json に立てる sw_cache_bump_skipped を拾う。
//   bump 時の warn は埋もれやすいので、提出前 lint で2段目のセーフティネットにする。
// ----------------------------------------------------------------------------
if (marketingVersion && /^\d+\.\d+\.\d+$/.test(String(marketingVersion))) {
  const history = readJson(`release-history/${marketingVersion}.json`);
  if (!history) {
    skip('sw-cache-bump', `release-history/${marketingVersion}.json が無い(release-bump 未実行 or 別運用)`);
  } else if (history.sw_cache_bump_skipped === true) {
    warn('sw-cache-bump', 'process', `直近 bump(${marketingVersion})で SW キャッシュ版数の更新がスキップされた。古い Service Worker が残る恐れ。sw.js の CACHE_NAME パターンか SW_CACHE_PREFIX を確認`);
  } else {
    ok('sw-cache-bump', `release-history/${marketingVersion}.json: SW キャッシュ bump スキップなし`);
  }
} else {
  skip('sw-cache-bump', 'marketingVersion が semver でないため履歴照合をスキップ');
}

// ----------------------------------------------------------------------------
// CHECK 15 — iOS プライバシーマニフェスト(PrivacyInfo.xcprivacy)
//   _docs/pre-submission-compliance-checklist.md (A) 表「iOS プライバシーマニフェスト宣言」のコード化。
//   裏取り済みの実態(2026-07-04, ionic-team/capacitor main):
//     - `cap add ios` のアプリテンプレ(ios-pods-template / ios-spm-template)は
//       app-level PrivacyInfo.xcprivacy を生成しない。
//     - SDK 側(Capacitor.framework / CapacitorCordova)はマニフェストを同梱
//       (commit #7321, 2024-03-11 → Capacitor 6.0.0 以降に同梱)。
//   よって「ファイルが無ければ fail」は CI 生成プロジェクトで必ず false-fail する。
//   検査は次の3点に落とす:
//     1. @capacitor/ios < 6 → SDK 自体がマニフェスト無し = ITMS-91053 リスク → fail
//     2. ios/ をコミットしていて app-level マニフェストを置いた場合、
//        pbxproj から参照されていなければバンドルされない(置いた意図が実装されていない) → fail
//     3. ios/ コミット + マニフェスト無しは、自前 native code が Required Reason API を
//        使う場合のみ必要 → warn(Xcode の Privacy Report で確認を促す)
//   ⚠ バージョン閾値・必須SDKリストは更新されうる。一次ソース:
//     https://developer.apple.com/support/third-party-SDK-requirements/
// ----------------------------------------------------------------------------
{
  const capIosVer =
    pkg?.dependencies?.['@capacitor/ios'] || pkg?.devDependencies?.['@capacitor/ios'] || null;
  const iosAppDir = path.join(ROOT, 'ios', 'App');
  const hasIosDir = fs.existsSync(iosAppDir);
  const majorMatch = capIosVer ? String(capIosVer).match(/\d+/) : null;
  const capIosMajor = majorMatch ? Number(majorMatch[0]) : null;

  if (!capIosVer && !hasIosDir) {
    skip('privacy-manifest', '@capacitor/ios 依存も ios/App も無い(iOS 配布しないなら可)');
  } else if (capIosVer && capIosMajor == null) {
    warn('privacy-manifest', '必須SDK要件(2024-05)', `@capacitor/ios のバージョン "${capIosVer}" を解釈できない。6 以上(SDK 同梱マニフェストあり)か確認すること`);
  } else if (capIosMajor != null && capIosMajor < 6) {
    fail(
      'privacy-manifest',
      '必須SDK要件(2024-05)',
      `@capacitor/ios ${capIosVer} (<6) は PrivacyInfo.xcprivacy を同梱しない。ITMS-91053 / 提出却下リスク。` +
        'Capacitor 6+ へ更新するか、app-level の PrivacyInfo.xcprivacy を ios/App/App に追加して pbxproj に登録すること',
    );
  } else if (hasIosDir) {
    const manifest = readFile('ios/App/App/PrivacyInfo.xcprivacy');
    const pbx = readFile('ios/App/App.xcodeproj/project.pbxproj');
    if (manifest == null) {
      warn(
        'privacy-manifest',
        '必須SDK要件(2024-05)',
        'ios/ をコミットしているが app-level PrivacyInfo.xcprivacy が無い。薄殻(自前 native code 無し)なら ' +
          'SDK 同梱マニフェストで足りるが、自前コードが Required Reason API(UserDefaults 等)を使うなら必須。' +
          'Xcode の Privacy Report(Product > Archive > Generate Privacy Report)で最終バンドルを確認すること',
      );
    } else if (!/NSPrivacyAccessedAPITypes|NSPrivacyCollectedDataTypes|NSPrivacyTracking/.test(manifest)) {
      warn('privacy-manifest', '必須SDK要件(2024-05)', 'PrivacyInfo.xcprivacy はあるが宣言キーが1つも無い(空マニフェスト)。宣言内容を確認すること');
    } else if (pbx != null && !pbx.includes('PrivacyInfo.xcprivacy')) {
      fail(
        'privacy-manifest',
        '必須SDK要件(2024-05)',
        'ios/App/App/PrivacyInfo.xcprivacy はあるが project.pbxproj から参照されていない = ビルドにバンドルされない。' +
          'Xcode でターゲット App の Copy Bundle Resources に追加すること',
      );
    } else {
      ok('privacy-manifest', 'app-level PrivacyInfo.xcprivacy あり(バンドル参照 OK)');
    }
  } else {
    // ios/ は CI の `npx cap add ios` で生成される運用(ios-appstore-release.yml)。
    // Capacitor >=6 なら SDK 側マニフェストが同梱され、テンプレが app-level を生成しないのは正常。
    ok('privacy-manifest', `@capacitor/ios ${capIosVer} (>=6): SDK 同梱マニフェストあり。ios/ は CI 生成(app-level 非生成が正常)`);
  }
}

// ----------------------------------------------------------------------------
// CHECK 16 — UIWebView 残存(2.5.1 / ITMS-90809 hard reject)
//   _docs/pre-submission-compliance-checklist.md (A) 表のコード化。薄殻での当てはまり度は
//   「中(古いプラグイン由来の混入)」。ios/ をコミットしている場合のみ検査可能
//   (CI 生成運用では Apple 側の ITMS-90809 が最終ゲート)。
//   自前ソース(ios/App/App)でのヒットは fail、Pods 等プラグイン領域はコメント誤検知が
//   ありうるため warn(要調査)に留める。
// ----------------------------------------------------------------------------
{
  const iosRoot = path.join(ROOT, 'ios');
  if (!fs.existsSync(iosRoot)) {
    skip('uiwebview-scan', 'ios/ が無い(CI 生成運用。最終ゲートは Apple の ITMS-90809)');
  } else {
    const textExt = /\.(swift|m|h|mm|pbxproj|storyboard|xib|plist|podspec)$/i;
    const ownHits = [];
    const vendorHits = [];
    const ownPrefix = path.join(iosRoot, 'App', 'App') + path.sep;
    for (const f of walkDir(iosRoot)) {
      const base = path.basename(f);
      if (!textExt.test(f) && base !== 'Podfile' && base !== 'Podfile.lock') continue;
      const c = fs.readFileSync(f, 'utf8');
      if (!c.includes('UIWebView')) continue;
      (f.startsWith(ownPrefix) ? ownHits : vendorHits).push(path.relative(ROOT, f));
    }
    if (ownHits.length > 0) {
      fail('uiwebview-scan', '2.5.1', `自前 iOS ソースに UIWebView 参照(削除済み API・ITMS-90809 で hard reject): ${ownHits.slice(0, 5).join(', ')}`);
    } else if (vendorHits.length > 0) {
      warn('uiwebview-scan', '2.5.1', `プラグイン/Pods 領域に UIWebView 文字列(コメントの可能性あり、要調査): ${vendorHits.slice(0, 5).join(', ')}`);
    } else {
      ok('uiwebview-scan', 'ios/ に UIWebView 参照なし');
    }
  }
}

// ----------------------------------------------------------------------------
// CHECK 17 — Android Data Safety の配線(申告パイプラインが繋がっているか)
//   Data Safety 自体は play-generate-data-safety-csv.mjs(CSV 生成・orphan key 0 で fail-closed)
//   + play-fill-data-safety.mjs(API 送信)で実装済み。ここでは「release workflow が
//   送信スクリプトを実行しているか」の配線を検査する。CHECK 7 は path filter の整合しか
//   見ておらず、workflow が invoke 自体をやめても素通りするのが穴だった。
// ----------------------------------------------------------------------------
{
  const playWfRel = process.env.APP_PLAY_WORKFLOW || '.github/workflows/android-play-release.yml';
  const playWf = readFile(playWfRel);
  if (playWf == null) {
    skip('data-safety-wiring', `${playWfRel} が無い(Android 配布しないなら可)`);
  } else if (!playWf.includes('play-fill-data-safety.mjs')) {
    fail(
      'data-safety-wiring',
      'Play Data Safety',
      `${playWfRel} が play-fill-data-safety.mjs を実行していない。Data Safety 未申告(または stale)のまま公開されると Play ポリシー違反。` +
        'templates/workflows/android-play-release.yml の該当 step を復元すること',
    );
  } else if (!fs.existsSync(path.join(ROOT, 'scripts', 'play-fill-data-safety.mjs'))) {
    fail('data-safety-wiring', 'Play Data Safety', 'workflow は play-fill-data-safety.mjs を参照するが scripts/ に実体が無い');
  } else {
    const hasGenerator = fs.existsSync(path.join(ROOT, 'scripts', 'play-generate-data-safety-csv.mjs'));
    const hasTemplate = fs.existsSync(path.join(ROOT, 'scripts', 'lib', 'play-data-safety-template.json'));
    if (hasGenerator && !hasTemplate) {
      warn('data-safety-wiring', 'Play Data Safety', 'play-generate-data-safety-csv.mjs はあるが scripts/lib/play-data-safety-template.json が無い(生成スクリプトが実行時に必ず落ちる)。キットの templates/scripts/lib/ からコピーすること');
    } else {
      ok('data-safety-wiring', 'workflow → play-fill-data-safety.mjs の配線あり');
    }
  }
}

// ----------------------------------------------------------------------------
// PR-8 custom checks — AI返信秘書 iOS companion invariants
// ----------------------------------------------------------------------------
{
  const iosConfig = appConfig?.ios || {};
  const nativeFeatures = appConfig?.nativeFeatures || [];
  const wwwFiles = [...walkDir(path.join(ROOT, 'www'))].filter((f) => /\.(html|js|css|json|webmanifest)$/i.test(f));
  const wwwText = wwwFiles.map((f) => `${path.relative(ROOT, f)}\n${fs.readFileSync(f, 'utf8')}`).join('\n');
  const appJs = readFile('www/app.js') || '';
  const indexHtml = readFile('www/index.html') || '';
  const capJson = readJson('capacitor.config.json');
  const reviewNotes = readFile('review-notes/CURRENT-en.txt') || '';
  const screenshotPlan = readJson('store-assets/screenshot-plan.json');
  const submitScript = readFile('scripts/appstore-submit.mjs') || '';
  const captureScript = readFile('scripts/capture-appstore-screenshots.mjs') || '';
  const verifyScript = readFile('scripts/verify-reviewer-account.mjs') || '';

  const buildTracePatterns = [
    ['billing', /\bbilling\b/i],
    ['stripe', /\bstripe\b/i],
    ['upgrade', /\bupgrade\b|アップグレード/i],
    ['iap', /\bIAP\b|in-app purchase/i],
    ['purchase-copy', /購入|有料|支払い|決済|料金|課金|paywall|paid unlock/i],
    ['trial-copy', /トライアル|\btrial\b/i],
  ];
  const buildHits = [];
  for (const [name, pattern] of buildTracePatterns) {
    if (pattern.test(wwwText)) buildHits.push(name);
  }
  if (buildHits.length > 0) {
    fail('ios-build-billing-trace-zero', '3.1.3(f)', `www/ に課金痕跡: ${buildHits.join(', ')}`);
  } else {
    ok('ios-build-billing-trace-zero', 'www/ に billing/IAP/upgrade/purchase/paywall/trial 痕跡なし');
  }

  if (/Google|OAuth|social login|Sign in with Apple/i.test(wwwText)) {
    fail('ios-own-login-only', '4.8', 'www/ に third-party/social login の表示痕跡がある');
  } else {
    ok('ios-own-login-only', 'www/ は email/password のみ');
  }

  const allowNavigation = capJson?.server?.allowNavigation || [];
  for (const domain of ['henshin-hisho.link', 'henshin-hisho-app.info-a40.workers.dev', 'appleid.apple.com']) {
    if (allowNavigation.includes(domain)) ok(`allow-navigation:${domain}`);
    else fail(`allow-navigation:${domain}`, '4 Design', `capacitor.config.json server.allowNavigation に ${domain} が無い`);
  }

  const allowlist = iosConfig.nativeAuthAllowlist || [];
  for (const route of ['/sign-in', '/privacy', '/terms', '/support', '/account/delete']) {
    if (allowlist.includes(route)) ok(`native-auth-allowlist:${route}`);
    else fail(`native-auth-allowlist:${route}`, '2.1(a)', `app.config ios.nativeAuthAllowlist に ${route} が無い`);
  }
  if (
    appJs.includes('NATIVE_AUTH_ALLOWLIST') &&
    appJs.includes('function nativeAuthGate') &&
    appJs.includes("setRoute('/sign-in'")
  ) {
    ok('native-auth-gate', 'unauthenticated native users are routed to /sign-in before app content');
  } else {
    fail('native-auth-gate', '2.1(a)', 'www/app.js に NativeAuthGate 実装が見つからない');
  }

  if (indexHtml.includes('#/account/delete') && appJs.includes("api('/account/delete'")) {
    ok('account-deletion-in-app', 'settings route + POST /account/delete');
  } else {
    fail('account-deletion-in-app', '5.1.1(v)', 'アプリ内削除導線または POST /account/delete が無い');
  }

  for (const feature of ['ios_push_notifications', 'ios_app_badge', 'native_share']) {
    if (nativeFeatures.includes(feature)) ok(`native-feature:${feature}`);
    else fail(`native-feature:${feature}`, '4.2', `nativeFeatures に ${feature} が無い`);
  }
  const nativeCodeChecks = [
    ['push-code', 'PushNotifications'],
    ['badge-code', 'Badge'],
    ['share-code', 'Share'],
  ];
  for (const [name, token] of nativeCodeChecks) {
    if (appJs.includes(token)) ok(name, token);
    else fail(name, '4.2', `www/app.js に ${token} 実装が無い`);
  }

  if (screenshotPlan?.authTabs?.length > 0 && Number(screenshotPlan.authTabs[0].slot) === 1) {
    ok('appstore-screenshot-auth-plan', 'authenticated slot1 configured');
  } else {
    fail('appstore-screenshot-auth-plan', '2.3.3', 'store-assets/screenshot-plan.json は authTabs の slot1 を持つこと');
  }
  if (
    captureScript.includes('IOS_REVIEW_DEMO_USERNAME') &&
    captureScript.includes('IOS_REVIEW_DEMO_PASSWORD') &&
    captureScript.includes('process.exit(1)')
  ) {
    ok('capture-fail-closed', 'reviewer creds required for auth screenshots');
  } else {
    fail('capture-fail-closed', '2.3.3', 'capture script が reviewer creds 欠落時に fail-closed しない');
  }

  if (
    submitScript.includes("_DEMO_USER || pick('demoAccountName')") &&
    submitScript.includes("_DEMO_PASS || pick('demoAccountPassword')") &&
    submitScript.includes('readCurrentReviewNotes()') &&
    submitScript.includes('notes: REVIEW_CONTACT_DEFAULTS.notes')
  ) {
    ok('appstore-submit-env-first', 'demo creds env-first and current notes always pushed');
  } else {
    fail('appstore-submit-env-first', '2.1(a)', 'appstore-submit.mjs の demo creds / notes stale 対策が不十分');
  }

  if (
    verifyScript.includes('/auth/signup') &&
    verifyScript.includes('/auth/login') &&
    verifyScript.includes('verify_password')
  ) {
    ok('reviewer-account-self-check', 'provision + verify_password step present');
  } else {
    fail('reviewer-account-self-check', '2.1(a)', 'scripts/verify-reviewer-account.mjs に provision/verify 手順が無い');
  }

  const requiredNoteSnippets = [
    'Free apps acting as a stand-alone companion to a paid web based tool',
    "Your app exclusively uses your company's own account setup and sign-in systems",
    'Business model answers:',
    'Gmail connection is completed on the web service',
    'Settings -> Account -> Delete account',
  ];
  const missingNoteSnippets = requiredNoteSnippets.filter((snippet) => !reviewNotes.includes(snippet));
  if (missingNoteSnippets.length === 0 && /Email:\s*[^\s@]+@[^\s@]+\.[^\s@]+/.test(reviewNotes)) {
    ok('reviewer-notes-pr8-required-content', '3.1.3(f), 4.8, 7 answers, Gmail OAuth, deletion, full demo email');
  } else {
    fail(
      'reviewer-notes-pr8-required-content',
      '3.1.3(f)/4.8/5.1.1(v)',
      `review-notes/CURRENT-en.txt に不足: ${missingNoteSnippets.join(', ') || 'full demo email'}`,
    );
  }

  if (appConfig?.review?.doesNotSendAutomatically === true && appConfig?.review?.gmailOAuthInIosApp === false) {
    ok('constitutional-invariants', 'no auto-send / no Gmail OAuth in iOS app');
  } else {
    fail('constitutional-invariants', 'policy', 'review invariants must state no auto-send and no Gmail OAuth in iOS app');
  }
}

// ----------------------------------------------------------------------------
// Output
// ----------------------------------------------------------------------------
console.log('');
if (warnings.length > 0) {
  console.log(`${ANSI_YELLOW}--- Warnings (${warnings.length}) ---${ANSI_RESET}`);
  for (const w of warnings) console.log(`${ANSI_YELLOW}!${ANSI_RESET} ${w.name} [${w.guideline}]: ${w.message}`);
  console.log('');
}
if (failures.length > 0) {
  console.log(`${ANSI_RED}--- Failures (${failures.length}) ---${ANSI_RESET}`);
  for (const f of failures) console.log(`${ANSI_RED}✗${ANSI_RESET} ${f.name} [${f.guideline}]: ${f.message}`);
  console.log('');
  console.log(`${ANSI_RED}Pre-submission lint failed.${ANSI_RESET}`);
  console.log('修正レシピは _docs/apple-reject-knowledge-base.md を参照。');
  process.exit(1);
}
console.log(`${ANSI_GREEN}All pre-submission lint checks passed.${ANSI_RESET}`);
console.log('ストア提出に進んで安全。');
