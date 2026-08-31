// 移植元: partnership_program_website/scripts/lib/app-config.mjs
//        (Exosome/scripts/lib/app-config.mjs と同一内容)
//
// app.config.json を SSOT(Single Source of Truth)として一度だけ読み、
// 型付きっぽいアクセサを公開する。spawn-new-app / asc・play 提出スクリプト /
// secret bootstrap など、アプリ固有 ID を使う全スクリプトがここを通る。
//
// このキットの app.config.json は <...> プレースホルダ方式。値はリポジトリ側で
// 埋める。スクリプトはここから読むだけで、固有値をハードコードしない。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// scripts/lib/ から見て 2 つ上がリポジトリ root(= app.config.json のある場所)。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG_PATH = path.join(ROOT, 'app.config.json');

let _cache = null;

/**
 * app.config.json の代表的な形。アプリにより一部キーが無い場合がある
 * (このキットの config は auth セクションを持たず、chrome セクションを持つ)。
 * アクセサはあくまでベストエフォートの型注釈で、実体は JSON.parse の生オブジェクト。
 * @typedef {{
 *   identity: {
 *     displayName: string,
 *     displayNameEn: string,
 *     shortName: string,
 *     bundleId: string,
 *     iosScheme: string,
 *     productionDomain: string,
 *     stagingDomain: string | null,
 *   },
 *   stores: {
 *     ascAppId: string | null,
 *     playAppId: string | null,
 *     playPackageName: string,
 *     appleTeamId: string | null,
 *     playDeveloperId: string | null,
 *     primaryCategory: string,
 *     ageRating: string,
 *     contentRights: string,
 *     marketingVersion: string,
 *     buildNumberOffset: number,
 *   },
 *   brand: {
 *     primaryColor: string,
 *     accentColor: string,
 *     iconSource: string,
 *     featureGraphicSource: string | null,
 *   },
 *   contact: {
 *     email: string,
 *     phoneE164: string,
 *     firstName: string,
 *     lastName: string,
 *     supportUrl: string,
 *     privacyUrl: string,
 *     termsUrl: string | null,
 *     marketingUrl: string,
 *     dataDeletionUrl: string | null,
 *   },
 *   businessModel: {
 *     hasInAppPurchase: boolean,
 *     hasSubscription: boolean,
 *     hasPaidContent: boolean,
 *     summaryEn: string,
 *     summaryJa: string,
 *   },
 *   ownership: {
 *     organization: string,
 *     country: string,
 *     githubOrg: string,
 *     githubRepo: string,
 *     vercelTeamSlug: string | null,
 *     vercelProjectName: string | null,
 *   },
 * }} AppConfig
 */

/** @returns {AppConfig} */
export function loadAppConfig() {
  if (_cache) return _cache;
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `app.config.json not found at ${CONFIG_PATH}. ` +
        'このキットでは app.config.json が SSOT。リポジトリ root に置いて <...> を埋めること。',
    );
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  _cache = parsed;
  return parsed;
}

/** app.config.json を含むプロジェクト root を返す。 */
export function getProjectRoot() {
  return ROOT;
}

/**
 * 未編集の "<...>" プレースホルダや空文字を「未設定」と見なす。
 * @param {*} v
 */
export function isPlaceholder(v) {
  if (v == null) return true;
  const s = String(v).trim();
  return s === '' || (s.startsWith('<') && s.endsWith('>'));
}

/**
 * ドット記法で値を取り出す。app.config.json が無い/未編集なら fallback。
 * 例: cfg('identity.displayName', 'My App')
 * @param {string} keyPath
 * @param {*} [fallback]
 */
export function cfg(keyPath, fallback = undefined) {
  let c;
  try {
    c = loadAppConfig();
  } catch {
    return fallback;
  }
  const val = keyPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), c);
  return isPlaceholder(val) ? fallback : val;
}

/**
 * スクショ/検証で使う本番URL。優先順:
 *   1. env SCREENSHOT_URL(CI/ローカルの明示指定)
 *   2. app.config.json identity.productionDomain
 *   3. fallback
 * @param {string} [fallback]
 */
export function productionUrl(fallback = 'http://localhost:3000') {
  if (process.env.SCREENSHOT_URL) return process.env.SCREENSHOT_URL.replace(/\/$/, '');
  const appUrl = cfg('identity.appUrl');
  if (appUrl) return String(appUrl).replace(/\/$/, '');
  const domain = cfg('identity.productionDomain');
  if (domain) {
    return `https://${String(domain).replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  }
  return fallback.replace(/\/$/, '');
}

/** @internal キャッシュをリセット(テスト用)。 */
export function _resetAppConfigCache() {
  _cache = null;
}
