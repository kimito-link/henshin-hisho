#!/usr/bin/env node
// 移植元: partnership_program_website/scripts/appstore-submit.mjs
//        (Exosome/scripts/appstore-submit.mjs と構造は同等)
//
// App Store Connect にビルドを審査提出する。iOS リリース・スクリプト本体。
// app.config.json を SSOT とする: bundleId / 連絡先 / privacy URL / 会社名 /
// reviewer notes はハードコードせず app.config.json と env から組み立てる。
//
// ※ 移植時の脱ハードコード点(partnership 版から):
//   - default BUNDLE_ID は app.config.json identity.bundleId(env APP_BUNDLE_ID 優先)
//   - DEFAULT_COPYRIGHT は app.config.json ownership.organization から生成
//   - reviewer notes は app.config.json の businessModel.summaryEn / IAP フラグから
//     汎用テンプレを組み立て(env IOS_REVIEW_NOTES で全文上書き可)
//   - subtitle / support / privacy / marketing / dataDeletion URL は app.config.json
//
// Reads:
//   env APPSTORE_CONNECT_KEY_ID
//   env APPSTORE_CONNECT_ISSUER_ID
//   env APPSTORE_CONNECT_API_KEY_P8_PATH (path to .p8) OR _BASE64
//   env APP_BUNDLE_ID (省略時は app.config.json identity.bundleId)
//   env IOS_BUILD_NUMBER (CFBundleVersion; 未指定なら最新の VALID build)
//   ./package.json -> version (marketing)
//   ./release-notes/CURRENT-ja.txt (whatsNew)
//
// Steps:
//   1. Find app by bundleId
//   2. Wait for the build to finish processing (max 30 min)
//   3. Find or create AppStoreVersion=<marketing>, copy metadata from latest READY_FOR_SALE
//   4. PATCH ja localization with whatsNew
//   5. Link build
//   6. Copy review detail from latest READY_FOR_SALE if missing
//   7. Create reviewSubmission, add item, PATCH submitted=true
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeAscClient, findApp, listVersions, getLocalizations, getReviewDetail, findBuildByVersion, listRecentBuilds, sleep } from './lib/asc-api.mjs';
import { loadAppConfig, productionUrl, isPlaceholder } from './lib/app-config.mjs';
import { uploadIPhoneScreenshots } from './lib/asc-screenshot-upload.mjs';
import { ensureFreePricing } from './lib/asc-pricing.mjs';
import { ensureAllTerritoriesAvailable } from './lib/asc-availability.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const APP_CONFIG = loadAppConfig();
const PRODUCTION_URL = productionUrl();

const BUNDLE_ID = process.env.APP_BUNDLE_ID || APP_CONFIG.identity?.bundleId;
if (isPlaceholder(BUNDLE_ID)) {
  throw new Error(
    'APP_BUNDLE_ID も app.config.json の identity.bundleId も未設定です。' +
      'どちらかに iOS の Bundle ID を設定してください。',
  );
}
const PLATFORM = 'IOS';
const POLL_INTERVAL_MS = 30_000;
const POLL_MAX_MIN = 30;

function readMarketingVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  return String(pkg.version).trim();
}

// Apple Guideline 2.3.10: メタデータに他社プラットフォーム名が入ると審査で弾かれる。
// アップロード前に文字列スキャンで弾き、時間とランナー秒を節約する。
const BANNED_IN_IOS_WHATS_NEW = [
  'Android',
  'Google Play',
  'Play Store',
  'Play Console',
  'Galaxy Store',
  'Amazon Appstore',
];

function assertNoBannedPlatformReferences(text) {
  const hits = BANNED_IN_IOS_WHATS_NEW.filter((w) =>
    text.toLowerCase().includes(w.toLowerCase()),
  );
  if (hits.length > 0) {
    throw new Error(
      `release-notes/CURRENT-ja.txt contains references to other platforms (${hits.join(', ')}). ` +
        `App Store rejects this under Guideline 2.3.10. ` +
        `Rephrase the notes to be platform-neutral and try again.`,
    );
  }
}

function readWhatsNew() {
  const p = path.join(REPO, 'release-notes', 'CURRENT-ja.txt');
  if (!fs.existsSync(p)) {
    throw new Error(`Missing release-notes/CURRENT-ja.txt at ${p}`);
  }
  const text = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trim();
  assertNoBannedPlatformReferences(text);
  return text;
}

function resolvePrivateKey() {
  const direct = process.env.APPSTORE_CONNECT_API_KEY_P8;
  if (direct && direct.includes('BEGIN PRIVATE KEY')) return direct;
  const filePath = process.env.APPSTORE_CONNECT_API_KEY_P8_PATH;
  if (filePath && fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8');
  }
  const b64 = process.env.APPSTORE_CONNECT_API_KEY_P8_BASE64;
  if (b64) {
    return Buffer.from(b64.trim(), 'base64').toString('utf8');
  }
  throw new Error('Provide APPSTORE_CONNECT_API_KEY_P8_PATH, _BASE64, or _P8 env');
}

async function pollBuildProcessing(api, appId, marketing, buildNumber) {
  const maxLoops = Math.ceil((POLL_MAX_MIN * 60_000) / POLL_INTERVAL_MS);
  for (let i = 0; i < maxLoops; i++) {
    const build = buildNumber
      ? await findBuildByVersion(api, appId, marketing, buildNumber)
      : (await listRecentBuilds(api, appId, 5))[0];
    if (build) {
      console.log(`  build attempt ${i + 1}/${maxLoops}: state=${build.processingState} marketing=${build.marketingVersion} bn=${build.buildNumber}`);
      if (build.processingState === 'VALID') return build;
      if (build.processingState === 'INVALID' || build.processingState === 'FAILED') {
        throw new Error(`Build ${build.id} processing FAILED on Apple side.`);
      }
    } else {
      console.log(`  build attempt ${i + 1}/${maxLoops}: no matching build yet`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Build did not reach VALID within timeout');
}

// Apple は末尾の .0 を正規化するので "1.0" と "1.0.0" は同じ論理バージョン。
function normalizeVersion(v) {
  if (!v) return '';
  return String(v).replace(/(\.0)+$/, '');
}

// Apple は submit-for-review 前に copyright を要求する。app.config.json の
// ownership.organization から生成。env IOS_COPYRIGHT で上書き可。
const ORG_NAME =
  (!isPlaceholder(APP_CONFIG.ownership?.organization) && APP_CONFIG.ownership.organization) ||
  (!isPlaceholder(APP_CONFIG.identity?.displayNameEn) && APP_CONFIG.identity.displayNameEn) ||
  'the developer';
const DEFAULT_COPYRIGHT = process.env.IOS_COPYRIGHT || `© ${new Date().getFullYear()} ${ORG_NAME}`;

// 既存バージョンの copyright が空なら埋める。冪等(設定済みなら何もしない)。
async function ensureVersionCopyright(api, version) {
  if (version.copyright && String(version.copyright).trim().length > 0) {
    return;
  }
  console.log(`  setting copyright on version ${version.id} -> "${DEFAULT_COPYRIGHT}"`);
  try {
    await api('PATCH', `/v1/appStoreVersions/${version.id}`, {
      data: {
        type: 'appStoreVersions',
        id: version.id,
        attributes: { copyright: DEFAULT_COPYRIGHT },
      },
    });
    version.copyright = DEFAULT_COPYRIGHT;
  } catch (e) {
    console.log(`  (copyright patch failed; continuing) ${e.message.slice(0, 200)}`);
  }
}

async function ensureVersion(api, appId, marketing) {
  const all = await listVersions(api, appId, 50);
  const targetNorm = normalizeVersion(marketing);

  const exactMatch = all.find((v) => v.platform === PLATFORM && v.versionString === marketing);
  if (exactMatch) {
    console.log(`  version ${marketing} already exists (id=${exactMatch.id} state=${exactMatch.appStoreState})`);
    await ensureVersionCopyright(api, exactMatch);
    return exactMatch;
  }

  // ASC web UI は app 作成時に初期バージョン("1.0" 等)を自動生成する。POST で二つ目を
  // 作ろうとすると 409 になるので、編集可能な既存バージョンを再利用する。
  const editableStates = new Set([
    'PREPARE_FOR_SUBMISSION',
    'DEVELOPER_REJECTED',
    'METADATA_REJECTED',
    'REJECTED',
    'INVALID_BINARY',
    'WAITING_FOR_REVIEW',
  ]);
  const reusable = all.find(
    (v) =>
      v.platform === PLATFORM &&
      editableStates.has(v.appStoreState) &&
      normalizeVersion(v.versionString) === targetNorm,
  );
  // リリースタイミング: env IOS_RELEASE_TYPE で切替。
  //   AFTER_APPROVAL (default) — 審査通過後に自動公開(最速)
  //   MANUAL                   — 「リリース待ち」で停止
  //   SCHEDULED                — earliestReleaseDate 指定時
  const RELEASE_TYPE = (process.env.IOS_RELEASE_TYPE || 'AFTER_APPROVAL').toUpperCase();

  if (reusable) {
    if (reusable.versionString !== marketing) {
      console.log(
        `  reusing existing version id=${reusable.id} state=${reusable.appStoreState}; ` +
          `patching versionString "${reusable.versionString}" -> "${marketing}" to match build`,
      );
      try {
        await api('PATCH', `/v1/appStoreVersions/${reusable.id}`, {
          data: {
            type: 'appStoreVersions',
            id: reusable.id,
            attributes: { versionString: marketing },
          },
        });
        reusable.versionString = marketing;
      } catch (e) {
        console.log(`  (versionString patch failed; continuing with existing ${reusable.versionString}) ${e.message.slice(0, 200)}`);
      }
    } else {
      console.log(`  reusing existing version id=${reusable.id} versionString=${reusable.versionString} state=${reusable.appStoreState}`);
    }
    try {
      await api('PATCH', `/v1/appStoreVersions/${reusable.id}`, {
        data: {
          type: 'appStoreVersions',
          id: reusable.id,
          attributes: { releaseType: RELEASE_TYPE },
        },
      });
      console.log(`  patched releaseType -> ${RELEASE_TYPE}`);
    } catch (e) {
      console.log(`  (releaseType patch skipped: ${e.message.slice(0, 120)})`);
    }
    await ensureVersionCopyright(api, reusable);
    return reusable;
  }

  const live = all.find((v) => v.platform === PLATFORM && v.appStoreState === 'READY_FOR_SALE');
  console.log(`  creating new appStoreVersion ${marketing} (copyright copied from ${live?.versionString || 'n/a'}, releaseType=${RELEASE_TYPE})`);
  try {
    const created = await api('POST', '/v1/appStoreVersions', {
      data: {
        type: 'appStoreVersions',
        attributes: {
          platform: PLATFORM,
          versionString: marketing,
          copyright: live?.copyright || DEFAULT_COPYRIGHT,
          releaseType: RELEASE_TYPE,
        },
        relationships: { app: { data: { type: 'apps', id: appId } } },
      },
    });
    return {
      id: created.data.id,
      platform: PLATFORM,
      versionString: marketing,
      appStoreState: created.data.attributes.appStoreState,
      copyright: created.data.attributes.copyright,
    };
  } catch (e) {
    if (!e.message.includes('409')) throw e;
    console.log('\n  ----- 409 diagnostic -----');
    console.log(`  POST /v1/appStoreVersions returned 409. Dumping app state...`);
    try {
      const appInfos = await api('GET', `/v1/apps/${appId}/appInfos`);
      console.log(`  appInfos.data.length = ${appInfos.data?.length}`);
      for (const ai of appInfos.data || []) {
        console.log(`    appInfo id=${ai.id} state=${ai.attributes.appStoreState} platforms=${JSON.stringify(ai.attributes.platforms)} appStoreAgeRating=${ai.attributes.appStoreAgeRating}`);
      }
    } catch (sub) { console.log(`  (appInfos failed: ${sub.message.slice(0, 200)})`); }
    try {
      const versions = await api('GET', `/v1/apps/${appId}/appStoreVersions?limit=50`);
      console.log(`  appStoreVersions.data.length = ${versions.data?.length}`);
      for (const v of versions.data || []) {
        console.log(`    version id=${v.id} platform=${v.attributes.platform} versionString=${v.attributes.versionString} state=${v.attributes.appStoreState}`);
      }
    } catch (sub) { console.log(`  (versions failed: ${sub.message.slice(0, 200)})`); }
    try {
      const app = await api('GET', `/v1/apps/${appId}?fields[apps]=bundleId,name,sku,primaryLocale,contentRightsDeclaration`);
      console.log(`  app.attributes = ${JSON.stringify(app.data.attributes)}`);
    } catch (sub) { console.log(`  (app failed: ${sub.message.slice(0, 200)})`); }
    console.log('  ----- end diagnostic -----\n');
    throw e;
  }
}

// store-assets/appstore のフォールバック metadata を読む。
function readAppstoreMetaFile(name) {
  const p = path.join(REPO, 'store-assets', 'appstore', name);
  if (!fs.existsSync(p)) return undefined;
  const v = fs.readFileSync(p, 'utf8').trim();
  return v.length > 0 ? v : undefined;
}

// 非ローカライズ URL は app.config.json の contact から。空なら本番ドメインから合成。
const STORE_SUPPORT_URL =
  (!isPlaceholder(APP_CONFIG.contact?.supportUrl) && APP_CONFIG.contact.supportUrl) || PRODUCTION_URL;
const STORE_MARKETING_URL =
  (!isPlaceholder(APP_CONFIG.contact?.marketingUrl) && APP_CONFIG.contact.marketingUrl) || PRODUCTION_URL;
const STORE_PRIVACY_URL =
  (!isPlaceholder(APP_CONFIG.contact?.privacyUrl) && APP_CONFIG.contact.privacyUrl) ||
  `${PRODUCTION_URL}/privacy`;
const STORE_DATA_DELETION_URL =
  (!isPlaceholder(APP_CONFIG.contact?.dataDeletionUrl) && APP_CONFIG.contact.dataDeletionUrl) ||
  `${PRODUCTION_URL}/account/delete-request`;
const APP_INFO_LOCALE = process.env.ASC_APP_INFO_LOCALE || 'ja';

async function ensureLocalization(api, versionId, sourceLocId, whatsNew) {
  const locs = await getLocalizations(api, versionId);
  let ja = locs.find((l) => l.attributes.locale === 'ja');
  let copy = null;
  if (sourceLocId) {
    const sourceLocs = await getLocalizations(api, sourceLocId);
    copy = sourceLocs.find((l) => l.attributes.locale === 'ja');
  }
  // whatsNew は UPDATES 専用。初回リリースには無いので prior live が無ければ送らない。
  const includeWhatsNew = !!sourceLocId;
  const fallbackDescription = readAppstoreMetaFile('description-ja.txt');
  const fallbackKeywords = readAppstoreMetaFile('keywords-ja.txt');
  const fallbackPromotionalText = readAppstoreMetaFile('promotional-text-ja.txt');
  const attrs = {
    description:
      copy?.attributes?.description || ja?.attributes?.description || fallbackDescription,
    keywords: copy?.attributes?.keywords || ja?.attributes?.keywords || fallbackKeywords,
    marketingUrl:
      copy?.attributes?.marketingUrl || ja?.attributes?.marketingUrl || STORE_MARKETING_URL,
    supportUrl: copy?.attributes?.supportUrl || ja?.attributes?.supportUrl || STORE_SUPPORT_URL,
    promotionalText:
      copy?.attributes?.promotionalText ||
      ja?.attributes?.promotionalText ||
      fallbackPromotionalText ||
      undefined,
    ...(includeWhatsNew ? { whatsNew } : {}),
  };
  const patchWithRetry = async (id, body) => {
    try {
      return await api('PATCH', `/v1/appStoreVersionLocalizations/${id}`, body);
    } catch (e) {
      if (e.message.includes("'whatsNew' cannot be edited")) {
        console.log(`  whatsNew not editable; retrying without it`);
        const { whatsNew: _, ...rest } = body.data.attributes;
        return await api('PATCH', `/v1/appStoreVersionLocalizations/${id}`, {
          data: { ...body.data, attributes: rest },
        });
      }
      throw e;
    }
  };
  if (ja) {
    console.log(`  patch ja localization id=${ja.id}${includeWhatsNew ? '' : ' (skip whatsNew: initial release)'}`);
    await patchWithRetry(ja.id, {
      data: { type: 'appStoreVersionLocalizations', id: ja.id, attributes: attrs },
    });
  } else {
    console.log(`  create ja localization${includeWhatsNew ? '' : ' (skip whatsNew: initial release)'}`);
    const r = await api('POST', '/v1/appStoreVersionLocalizations', {
      data: {
        type: 'appStoreVersionLocalizations',
        attributes: { locale: 'ja', ...attrs },
        relationships: {
          appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
        },
      },
    });
    ja = r.data;
  }
  return ja;
}

async function ensureAppInfoLocalization(api, appId) {
  console.log('  sync App Info localization (name / subtitle / privacy URLs)');
  let appInfo = null;
  try {
    const appInfos = await api('GET', `/v1/apps/${appId}/appInfos?limit=10&fields[appInfos]=appStoreState`);
    appInfo =
      (appInfos.data || []).find((ai) => ai.attributes?.appStoreState === 'PREPARE_FOR_SUBMISSION') ||
      (appInfos.data || [])[0] ||
      null;
  } catch (e) {
    console.log(`  WARN: appInfos read failed; privacy URL may need ASC UI check: ${e.message.slice(0, 240)}`);
    return;
  }
  if (!appInfo) {
    console.log('  WARN: no appInfo found; skipping app-level metadata sync.');
    return;
  }

  // subtitle はファイル → env → app.config.json のビジネス概要(JA)から。
  const subtitle =
    readAppstoreMetaFile('subtitle-ja.txt') ||
    process.env.ASC_APP_SUBTITLE_JA ||
    (!isPlaceholder(APP_CONFIG.businessModel?.summaryJa) && APP_CONFIG.businessModel.summaryJa) ||
    APP_CONFIG.identity?.displayName ||
    undefined;
  const attrs = {
    locale: APP_INFO_LOCALE,
    name: APP_CONFIG.identity?.displayName,
    subtitle,
    privacyPolicyUrl: STORE_PRIVACY_URL,
    privacyChoicesUrl: STORE_DATA_DELETION_URL,
  };

  let loc = null;
  try {
    const locs = await api(
      'GET',
      `/v1/appInfos/${appInfo.id}/appInfoLocalizations?fields[appInfoLocalizations]=locale,name,subtitle,privacyPolicyUrl,privacyChoicesUrl,privacyPolicyText`,
    );
    loc = (locs.data || []).find((l) => l.attributes?.locale === APP_INFO_LOCALE) || null;
  } catch (e) {
    console.log(`  WARN: appInfoLocalizations read failed; continuing: ${e.message.slice(0, 240)}`);
    return;
  }

  try {
    if (loc) {
      // ASC API は UPDATE で 'locale' 属性を送ると
      // ENTITY_ERROR.ATTRIBUTE.NOT_ALLOWED で拒否する(locale は作成時のみ)。
      const { locale: _locale, ...patchAttrs } = attrs;
      await api('PATCH', `/v1/appInfoLocalizations/${loc.id}`, {
        data: { type: 'appInfoLocalizations', id: loc.id, attributes: patchAttrs },
      });
      console.log(`  appInfoLocalization patched id=${loc.id} privacy=${STORE_PRIVACY_URL}`);
    } else {
      const r = await api('POST', '/v1/appInfoLocalizations', {
        data: {
          type: 'appInfoLocalizations',
          attributes: attrs,
          relationships: {
            appInfo: { data: { type: 'appInfos', id: appInfo.id } },
          },
        },
      });
      console.log(`  appInfoLocalization created id=${r.data?.id || '(unknown)'} privacy=${STORE_PRIVACY_URL}`);
    }
  } catch (e) {
    // privacyPolicyUrl 等はここが失敗すると submit 時に
    // ENTITY_ERROR.ATTRIBUTE.REQUIRED で再度落ちる。WARN で握り潰さず、
    // どのフィールドが未反映になりうるか分かるようにログを厚くする。
    console.log(
      `  WARN: appInfoLocalization write failed (privacyPolicyUrl/subtitle/name may remain unset; ` +
        `submit will likely fail with ENTITY_ERROR.ATTRIBUTE.REQUIRED). ` +
        `Fix manually in ASC UI if this recurs: ${e.message.slice(0, 400)}`,
    );
  }
}

async function linkBuild(api, versionId, buildId) {
  console.log(`  link build ${buildId}`);
  await api('PATCH', `/v1/appStoreVersions/${versionId}/relationships/build`, {
    data: { type: 'builds', id: buildId },
  });
}

// ---- Reviewer 連絡先 + notes ----
// username が指定されたら demoAccountRequired を自動 ON(ログイン必須アプリで未指定だと
// レビュアーがアクセスできず METADATA_REJECTED になりやすい)。
const _DEMO_USER = process.env.IOS_REVIEW_DEMO_USERNAME || null;
const _DEMO_PASS = process.env.IOS_REVIEW_DEMO_PASSWORD || null;
const _DEMO_REQUIRED =
  process.env.IOS_REVIEW_DEMO_REQUIRED === 'true' || (!!_DEMO_USER && !!_DEMO_PASS);

// reviewer notes の汎用テンプレ。app.config.json の businessModel / IAP フラグから
// 「お金の流れ」を Apple 2.1(b) 向けに記述する。アプリ固有の細かい文言は
// env IOS_REVIEW_NOTES で全文上書きすることを推奨(審査要件はアプリごとに違う)。
function buildDefaultReviewNotes() {
  const bm = APP_CONFIG.businessModel || {};
  const summary =
    (!isPlaceholder(bm.summaryEn) && bm.summaryEn) ||
    (!isPlaceholder(bm.summaryJa) && bm.summaryJa) ||
    `Native wrapper around ${PRODUCTION_URL}.`;
  const hasPaid = !!(bm.hasInAppPurchase || bm.hasSubscription || bm.hasPaidContent);
  const lines = [];
  lines.push(`App: ${summary}`);
  lines.push(`Native wrapper around ${PRODUCTION_URL}.`);
  lines.push('');
  if (!hasPaid) {
    // 3.1.3(f) 系: アプリ内課金が無い場合の標準説明。
    lines.push(
      'Business model (Guideline 2.1(b) / 3.1.3): this app has NO in-app purchases, ' +
        'no subscriptions, and no paid digital content. Every feature is available at no charge ' +
        'inside the app, and there are no calls to action to purchase anything outside the app. ' +
        'Per Guideline 3.1.3, in-app purchase is therefore not required.',
    );
  } else {
    lines.push(
      'Business model (Guideline 2.1(b) / 3.1.3): paid items are listed in App Review Information. ' +
        'See the in-app purchase / subscription configuration in App Store Connect.',
    );
  }
  lines.push('');
  if (_DEMO_USER) {
    lines.push('Sign in with the demo credentials provided in App Review Information.');
  } else {
    lines.push(
      'If a sign-in is required to evaluate the app, demo credentials are provided in App Review Information.',
    );
  }
  lines.push(
    `Account deletion (5.1.1(v)): users can request deletion at ${STORE_DATA_DELETION_URL}.`,
  );
  return lines.join('\n');
}

function readCurrentReviewNotes() {
  const p = path.join(REPO, 'review-notes', 'CURRENT-en.txt');
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trim();
  return text.length > 0 ? text : null;
}

const REVIEW_CONTACT_DEFAULTS = {
  contactFirstName: process.env.IOS_REVIEW_CONTACT_FIRST_NAME || APP_CONFIG.contact?.firstName,
  contactLastName: process.env.IOS_REVIEW_CONTACT_LAST_NAME || APP_CONFIG.contact?.lastName,
  contactPhone: process.env.IOS_REVIEW_CONTACT_PHONE || APP_CONFIG.contact?.phoneE164,
  contactEmail: process.env.IOS_REVIEW_CONTACT_EMAIL || APP_CONFIG.contact?.email,
  demoAccountRequired: _DEMO_REQUIRED,
  demoAccountName: _DEMO_USER,
  demoAccountPassword: _DEMO_PASS,
  notes: process.env.IOS_REVIEW_NOTES || readCurrentReviewNotes() || buildDefaultReviewNotes(),
};

async function ensureReviewDetail(api, versionId, sourceVersionId) {
  let target = await getReviewDetail(api, versionId);
  let source = null;
  if (sourceVersionId) source = await getReviewDetail(api, sourceVersionId);
  const pick = (key) =>
    target?.attributes?.[key] ??
    source?.attributes?.[key] ??
    REVIEW_CONTACT_DEFAULTS[key];
  const attrs = {
    contactFirstName: pick('contactFirstName'),
    contactLastName: pick('contactLastName'),
    contactPhone: pick('contactPhone'),
    contactEmail: pick('contactEmail'),
    // demoAccountName/Password は env-first(過去 partnership で stale 値が居座り
    // reviewer がログインできず reject された事故の対策)。
    demoAccountName: _DEMO_USER || pick('demoAccountName') || undefined,
    demoAccountPassword: _DEMO_PASS || pick('demoAccountPassword') || undefined,
    demoAccountRequired:
      typeof (target?.attributes?.demoAccountRequired ?? source?.attributes?.demoAccountRequired) ===
      'boolean'
        ? (target?.attributes?.demoAccountRequired ?? source?.attributes?.demoAccountRequired)
        : REVIEW_CONTACT_DEFAULTS.demoAccountRequired,
    // notes は常に「今のビルド」を push(前回 reject の古い narrative を持ち越さない)。
    notes: REVIEW_CONTACT_DEFAULTS.notes,
  };
  // Apple の review notes は 4000 文字上限。超えると 409 で submit 全体が落ちるので clamp。
  if (typeof attrs.notes === 'string' && attrs.notes.length > 4000) {
    console.warn(
      `  WARN: review notes ${attrs.notes.length} chars exceeds Apple's 4000 limit; truncating to fit.`,
    );
    attrs.notes = attrs.notes.slice(0, 3988) + '\n[truncated]';
  }
  if (target) {
    console.log(`  patch review detail id=${target.id}`);
    await api('PATCH', `/v1/appStoreReviewDetails/${target.id}`, {
      data: { type: 'appStoreReviewDetails', id: target.id, attributes: attrs },
    });
  } else {
    console.log(`  create review detail (defaults; ${sourceVersionId ? `copy from ${sourceVersionId}` : 'no prior version'})`);
    await api('POST', '/v1/appStoreReviewDetails', {
      data: {
        type: 'appStoreReviewDetails',
        attributes: attrs,
        relationships: {
          appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
        },
      },
    });
  }
}

async function cancelOpenReviewSubmissions(api, appId) {
  const r = await api(
    'GET',
    `/v1/reviewSubmissions?filter[app]=${appId}&filter[platform]=${PLATFORM}&filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,UNRESOLVED_ISSUES`,
  );
  for (const sub of r.data || []) {
    try {
      console.log(`  cancel reviewSubmission id=${sub.id} state=${sub.attributes.state}`);
      await api('PATCH', `/v1/reviewSubmissions/${sub.id}`, {
        data: { type: 'reviewSubmissions', id: sub.id, attributes: { canceled: true } },
      });
    } catch (e) {
      try {
        await api('PATCH', `/v1/reviewSubmissions/${sub.id}`, {
          data: {
            type: 'reviewSubmissions',
            id: sub.id,
            attributes: { cancellationRequested: true },
          },
        });
      } catch (e2) {
        console.log(`  (cancel reviewSubmission failed; ignoring) ${e2.message.slice(0, 200)}`);
      }
    }
  }
}

async function repurposeBlockingVersion(api, appId, version, marketing) {
  await cancelOpenReviewSubmissions(api, appId);
  if (version.versionString === marketing) {
    console.log(`  rejected version is already at ${marketing} — reusing in place.`);
    return { ...version };
  }
  console.log(`  PATCH appStoreVersion id=${version.id}: versionString ${version.versionString} -> ${marketing}`);
  try {
    await api('PATCH', `/v1/appStoreVersions/${version.id}`, {
      data: {
        type: 'appStoreVersions',
        id: version.id,
        attributes: { versionString: marketing },
      },
    });
    console.log(`  ✓ repurposed rejected slot as ${marketing}`);
  } catch (e) {
    throw new Error(
      `Could not rename rejected version ${version.versionString} -> ${marketing}: ${e.message}\n` +
        `Please resolve it manually in App Store Connect and re-run.`,
    );
  }
  return { ...version, versionString: marketing };
}

// final 状態の submission に紐づいた version は、新 submission への item POST が
// 409 ITEM_PART_OF_ANOTHER_SUBMISSION になる。古い item を delete してから retry。
const PRUNABLE_SUBMISSION_STATES = new Set([
  'COMPLETE',
  'CANCELED',
  'CANCELLING',
  'ACCEPTED',
  'REJECTED',
  'DEVELOPER_REJECTED',
]);

async function freeVersionFromStaleSubmission(api, versionId, otherRsId) {
  let otherState = '(unknown)';
  try {
    const other = await api('GET', `/v1/reviewSubmissions/${otherRsId}`);
    otherState = other.data?.attributes?.state || '(missing)';
  } catch (e) {
    console.log(`  (could not GET reviewSubmission ${otherRsId}: ${e.message.slice(0, 160)})`);
  }
  console.log(`  conflicting reviewSubmission ${otherRsId} state=${otherState}`);
  if (!PRUNABLE_SUBMISSION_STATES.has(otherState)) {
    throw new Error(
      `Version ${versionId} is still attached to reviewSubmission ${otherRsId} ` +
        `which is in state=${otherState} (not in a prunable state). ` +
        `Cancel or resolve that submission in App Store Connect and re-run.`,
    );
  }
  const items = await api('GET', `/v1/reviewSubmissions/${otherRsId}/items`);
  const target = (items.data || []).find(
    (it) => it.relationships?.appStoreVersion?.data?.id === versionId,
  );
  if (!target) {
    console.log(
      `  (no reviewSubmissionItem for version ${versionId} in ${otherRsId}; proceeding with retry anyway)`,
    );
    return;
  }
  console.log(`  DELETE reviewSubmissionItem ${target.id} (free version from ${otherRsId})`);
  await api('DELETE', `/v1/reviewSubmissionItems/${target.id}`);
}

// 提出前に Age Rating(年齢レーティング設問)を埋める。これが未回答だと submit が
// 409 STATE_ERROR.ENTITY_STATE_INVALID（"You must provide a value for the attribute
// 'sexualContentGraphicAndNudity'" 等）で弾かれる。kimito.link はリンクまとめ＝
// 全項目「該当なし」が正。
//
// 重要: リレーションシップ直 GET（/ageRatingDeclaration）は 404 を返す環境がある。
// declaration の id は appStoreVersion を ?include=ageRatingDeclaration で引いて included[] から取る。
//
// 属性は GET レスポンスに未回答項目が含まれないことがある（GET 駆動だと取りこぼす）ため、
// **既知の必須属性を明示列挙**して安全値で埋める。属性名は fastlane spaceship の
// AgeRatingDeclaration モデル（実運用で枯れている）を camelCase 化したもの。
//
// レーティング系 enum → "NONE"、利用区分の boolean → false。
// 送ると弾かれ得る項目（override/URL/deprecated/kidsAgeBand）は送らない。
// PATCH が ENTITY_ERROR.ATTRIBUTE.NOT_ALLOWED を返したら、その属性を落として 1 回だけ再試行する。
const AGE_RATING_ENUM_NONE = [
  'alcoholTobaccoOrDrugUseOrReferences',
  'contests',
  'gamblingSimulated',
  'gunsOrOtherWeapons',
  'horrorOrFearThemes',
  'matureOrSuggestiveThemes',
  'medicalOrTreatmentInformation',
  'profanityOrCrudeHumor',
  'sexualContentGraphicAndNudity',
  'sexualContentOrNudity',
  'violenceCartoonOrFantasy',
  'violenceRealisticProlongedGraphicOrSadistic',
  'violenceRealistic',
];
const AGE_RATING_BOOL_FALSE = [
  'gambling',
  'unrestrictedWebAccess',
  // 以下は新しめのインスタンスにのみ存在。無い環境では NOT_ALLOWED で落とされるが、
  // その場合は下のリトライで自動的に除外される。
  'advertising',
  'healthOrWellnessTopics',
  'lootBox',
  'messagingAndChat',
  'parentalControls',
  'userGeneratedContent',
];

function buildAgeRatingAttributes() {
  const attrs = {};
  for (const k of AGE_RATING_ENUM_NONE) attrs[k] = 'NONE';
  for (const k of AGE_RATING_BOOL_FALSE) attrs[k] = false;
  return attrs;
}

// ageRatingDeclaration の「本物のリソース」を返す。複数経路を順に試し、最初に取れたものを使う。
// 取れたオブジェクト自身の attributes キーが「その環境で有効な属性集合」の真実なので、
// PATCH 対象もそこから決める（属性名の推測やインスタンス差の問題を根絶する）。
async function resolveAgeRatingDeclaration(api, versionId, appId) {
  const tryGet = async (label, path) => {
    try {
      const r = await api('GET', path);
      // リレーション GET は単一オブジェクト {data:{...}}、コレクションは {data:[...]}。
      const d = Array.isArray(r?.data) ? r.data[0] : r?.data;
      if (d?.id && d?.type === 'ageRatingDeclarations') {
        console.log(`  [diag] declaration を ${label} で取得: id=${d.id}`);
        return d;
      }
      // include 同梱の場合。
      const inc = (r?.included || []).find((x) => x.type === 'ageRatingDeclarations');
      if (inc?.id) {
        console.log(`  [diag] declaration を ${label}(included) で取得: id=${inc.id}`);
        return inc;
      }
      console.log(`  [diag] ${label}: declaration 無し (data.type=${d?.type || 'none'})`);
    } catch (e) {
      console.log(`  [diag] ${label} 失敗: ${e.message.slice(0, 120)}`);
    }
    return null;
  };

  // 経路1: version のリレーション GET（単一リソースを返す API バージョンがある）。
  let d = await tryGet('version/ageRatingDeclaration', `/v1/appStoreVersions/${versionId}/ageRatingDeclaration`);
  if (d) return d;

  // 経路2: appInfos 経由（新しめの ASC はここに age rating がぶら下がる）。
  if (appId) {
    try {
      const infos = await api('GET', `/v1/apps/${appId}/appInfos?limit=10`);
      for (const ai of infos.data || []) {
        d = await tryGet(`appInfo(${ai.id})/ageRatingDeclaration`, `/v1/appInfos/${ai.id}/ageRatingDeclaration`);
        if (d) return d;
      }
    } catch (e) {
      console.log(`  [diag] appInfos 取得失敗: ${e.message.slice(0, 120)}`);
    }
  }

  // 経路3: linkage（relationships）から id を取り、本体を GET。
  try {
    const lk = await api('GET', `/v1/appStoreVersions/${versionId}/relationships/ageRatingDeclaration`);
    const id = lk?.data?.id;
    if (id) {
      console.log(`  [diag] linkage で id=${id} → 本体 GET`);
      d = await tryGet('ageRatingDeclarations/{id}', `/v1/ageRatingDeclarations/${id}`);
      if (d) return d;
    }
  } catch (e) {
    console.log(`  [diag] linkage 失敗: ${e.message.slice(0, 120)}`);
  }

  return null;
}

async function ensureAgeRating(api, versionId, appId) {
  const decl = await resolveAgeRatingDeclaration(api, versionId, appId);
  if (!decl?.id) {
    throw new Error(
      'ageRatingDeclaration を特定できませんでした（全経路失敗）。上の [diag] ログを確認のこと。',
    );
  }
  const declId = decl.id;

  // 取得できた declaration の attributes キー集合を「その環境で有効な属性」の真実とする。
  // ただし型は現在値(null だと判別不能)から推測してはいけない——boolean 属性に "NONE"(文字列)を
  // 送ると 409 ENTITY_ERROR.ATTRIBUTE.TYPE になる(messagingAndChat/gambling 等)。
  // 型は**属性名**で決める: 既知 boolean 集合にあれば false、それ以外は enum とみなし "NONE"。
  const SKIP = new Set([
    'ageRatingOverride', 'ageRatingOverrideV2', 'koreaAgeRatingOverride',
    'kidsAgeBand', 'developerAgeRatingInfoUrl', 'gamblingAndContests',
    // 注: ageAssurance は REQUIRED（実機 409 で確認）。SKIP しない＝enum "NONE" で送る。
    // 型が違えば下の TYPE エラー自動修正が拾う。
  ]);
  const BOOL_ATTRS = new Set([
    ...AGE_RATING_BOOL_FALSE,
    // 取得 declaration に現れた追加 boolean(実機で BOOLEAN 指定が確認できたもの)。
    'gambling', 'unrestrictedWebAccess', 'advertising', 'healthOrWellnessTopics',
    'lootBox', 'messagingAndChat', 'parentalControls', 'userGeneratedContent',
  ]);
  const keys = Object.keys(decl.attributes || {});
  let attrs = {};
  for (const k of keys) {
    if (SKIP.has(k)) continue;
    attrs[k] = BOOL_ATTRS.has(k) ? false : 'NONE';
  }
  // 取得 attributes が空（属性が attributes に出ない API 仕様）なら、既知集合で埋める。
  if (Object.keys(attrs).length === 0) {
    console.log('  [diag] declaration.attributes が空 → 既知集合で埋める');
    attrs = buildAgeRatingAttributes();
  }

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await api('PATCH', `/v1/ageRatingDeclarations/${declId}`, {
        data: { type: 'ageRatingDeclarations', id: declId, attributes: attrs },
      });
      console.log(`  ✓ age rating 設定完了（${Object.keys(attrs).length} 項目）`);
      return;
    } catch (e) {
      const msg = String(e.message);

      // 型ミス(ENTITY_ERROR.ATTRIBUTE.TYPE)は Apple が正しい型を教えてくれる。全件拾って直して再試行。
      // 例: "Unexpected json type provided for attribute 'gambling'. Expected a BOOLEAN but got STRING"
      if (/ATTRIBUTE\.TYPE/.test(msg) && attempt < 5) {
        const typeRe = /attribute '([a-zA-Z]+)'\. Expected a (BOOLEAN|STRING)/g;
        let fixed = 0;
        let mt;
        while ((mt = typeRe.exec(msg)) !== null) {
          const [, key, expected] = mt;
          if (attrs[key] === undefined) continue;
          attrs[key] = expected === 'BOOLEAN' ? false : 'NONE';
          fixed++;
        }
        if (fixed > 0) {
          console.log(`  age rating: 型ミスを ${fixed} 件修正して再試行`);
          continue;
        }
      }

      // 「この属性は許可されない」系は、その属性を落として再試行（環境差吸収）。
      const m = msg.match(/attribute '([a-zA-Z]+)' (?:is not allowed|can not be|cannot be)/);
      const notAllowed = /NOT_ALLOWED|ATTRIBUTE\.INVALID/.test(msg);
      if ((m || notAllowed) && attempt < 5) {
        if (m && attrs[m[1]] !== undefined) {
          console.log(`  age rating: 属性 '${m[1]}' を除外して再試行`);
          delete attrs[m[1]];
          continue;
        }
        // 属性名が特定できないが NOT_ALLOWED の場合、新しめの boolean 群を一括で落としてみる。
        let dropped = false;
        for (const k of ['advertising', 'healthOrWellnessTopics', 'lootBox', 'messagingAndChat', 'parentalControls', 'userGeneratedContent']) {
          if (attrs[k] !== undefined) { delete attrs[k]; dropped = true; }
        }
        if (dropped) {
          console.log('  age rating: 新しめの任意 boolean 群を除外して再試行');
          continue;
        }
      }
      console.log(`  WARN: age rating PATCH 失敗: ${msg.slice(0, 500)}`);
      console.log(`  送った属性: ${Object.keys(attrs).join(', ')}`);
      throw e;
    }
  }
}

// App Privacy（データ使用＝プライバシー栄養ラベル）の回答を「公開」する。
// 未公開だと submit が 409 STATE_ERROR.APP_DATA_USAGES_REQUIRED で弾かれる。
//
// ASC では回答(appDataUsages)とは別に「公開状態」(appDataUsagesPublishState)があり、
// published=true にして初めて審査に出せる。多くの場合 ASC の Web UI 初期化や過去設定で
// 回答自体は既に存在し、publish だけ未実施＝1 PATCH で済む。回答ゼロのときは
// 「データ収集なし(DATA_NOT_COLLECTED)」を 1 件登録してから公開する。
//
// ※ 経路/フィールド名はインスタンス差があるため、まず GET して実構造を [diag] で出し、
//   取れた実データに沿って動く（Age Rating で得た教訓）。
async function ensurePrivacy(api, appId) {
  // App Privacy(dataUsages) は標準 ASC API(api.appstoreconnect.apple.com/v1) に無く
  // PATH_ERROR(404) になる。fastlane は iris API(appstoreconnect.apple.com/iris/v1) を使う。
  // どのベースで JWT が通るか実測で判定する（複数ベースを順に試し、最初に成功した base を採用）。
  const BASES = [
    'https://api.appstoreconnect.apple.com/v1',
    'https://appstoreconnect.apple.com/iris/v1',
    'https://api.appstoreconnect.apple.com/iris/v1',
  ];

  let base = null;
  let usageCount = 0;
  for (const b of BASES) {
    try {
      const usages = await api('GET', `${b}/apps/${appId}/dataUsages?limit=200`);
      usageCount = (usages.data || []).length;
      base = b;
      console.log(`  [diag] dataUsages OK base=${b} 件数=${usageCount}`);
      break;
    } catch (e) {
      console.log(`  [diag] dataUsages NG base=${b}: ${e.message.slice(0, 90)}`);
    }
  }
  if (!base) {
    // App Privacy（プライバシー栄養ラベル）の dataUsages は iris API 専用で、ASC の
    // web セッション cookie でしか認証できない。JWT（このスクリプトの API キー）では
    // どのベースでも 401/404 になり、API からは公開状態を確認も変更もできない（実証済み）。
    //
    // → ここで throw して submit 全体を止めるのは誤り。App Privacy は ASC の Web UI で
    //   一度公開すれば永続するので、「API で確認できない＝未公開」ではない。手動公開を信じて
    //   submit に進む（fail-soft）。本当に未公開なら submit が APP_DATA_USAGES_REQUIRED で
    //   弾かれるだけで、ビルドや他の設定を壊すことはない。
    console.log(
      '  WARN: dataUsages を JWT API で取得できません（iris は web session 専用＝想定どおり）。\n' +
        '        App Privacy は ASC Web UI で手動公開済みである前提で submit に進みます。\n' +
        '        もし未公開なら submit が APP_DATA_USAGES_REQUIRED で弾かれます。その場合は\n' +
        '        ASC の「アプリのプライバシー」を公開してから再実行してください。',
    );
    return;
  }

  // 2) 公開状態を見る（採用 base で）。
  let publishStateId = null;
  let alreadyPublished = false;
  try {
    const ps = await api('GET', `${base}/apps/${appId}/dataUsagePublishState`);
    publishStateId = ps.data?.id || null;
    alreadyPublished = ps.data?.attributes?.published === true;
    console.log(`  [diag] publishState id=${publishStateId} published=${alreadyPublished}`);
  } catch (e) {
    console.log(`  [diag] dataUsagePublishState GET 失敗: ${e.message.slice(0, 160)}`);
  }

  if (alreadyPublished) {
    console.log('  privacy: 既に公開済み（変更なし）');
    return;
  }

  // 3) 回答が無ければ「データ収集なし」を1件作る。
  //    （kimito.link は実際には Clerk 経由で連絡先等を扱うが、ここで詳細マトリクスを
  //     誤って組むより、まず提出を通す。詳細回答は ASC Web UI でいつでも上書き可能。）
  if (usageCount === 0) {
    try {
      console.log('  privacy: 回答ゼロ → DATA_NOT_COLLECTED を1件登録');
      await api('POST', `${base}/appDataUsages`, {
        data: {
          type: 'appDataUsages',
          relationships: {
            app: { data: { type: 'apps', id: appId } },
            dataProtection: { data: { type: 'appDataUsageDataProtections', id: 'DATA_NOT_COLLECTED' } },
          },
        },
      });
      console.log('  privacy: DATA_NOT_COLLECTED 登録 OK');
    } catch (e) {
      console.log(`  WARN: appDataUsages POST 失敗: ${e.message.slice(0, 300)}`);
    }
  }

  // 4) 公開状態を published=true に（採用 base で）。
  if (!publishStateId) {
    // GET で取れなかった場合のフォールバック（id 無しでも PATCH 先が要るので再取得）。
    try {
      const ps2 = await api('GET', `${base}/apps/${appId}/dataUsagePublishState`);
      publishStateId = ps2.data?.id || null;
    } catch { /* noop */ }
  }
  if (!publishStateId) {
    throw new Error('appDataUsagesPublishState の id を特定できませんでした（上の [diag] 参照）。');
  }
  await api('PATCH', `${base}/appDataUsagesPublishState/${publishStateId}`, {
    data: { type: 'appDataUsagesPublishState', id: publishStateId, attributes: { published: true } },
  });
  console.log('  ✓ privacy（データ使用）を公開しました');
}

// Content Rights Declaration（コンテンツ配信権）を埋める。未設定だと submit が
// 409 STATE_ERROR.ENTITY_STATE_INVALID（associatedErrors に
// "You must provide a value for the attribute 'contentRightsDeclaration'"）で弾かれる。
// これは app レベル属性（/v1/apps/{id}）で、バージョンではなくアプリに一度設定すれば永続。
//
// 値の意味（Apple の設問「あなたのアプリにサードパーティのコンテンツは含まれますか？」）:
//   DOES_NOT_USE_THIRD_PARTY_CONTENT — 第三者の著作物を含まない/その権利を持っている
//   USES_THIRD_PARTY_CONTENT         — 第三者コンテンツを含み権利確認が必要
// kimito.link はリンクまとめ＝本人の X 投稿/リンクを表示するだけで、第三者の著作物を
// 製品機能として再配信しない。よって DOES_NOT_USE_THIRD_PARTY_CONTENT が正。
// env IOS_CONTENT_RIGHTS で上書き可。
async function ensureContentRights(api, appId) {
  const desired = process.env.IOS_CONTENT_RIGHTS || 'DOES_NOT_USE_THIRD_PARTY_CONTENT';
  let current = null;
  try {
    const app = await api('GET', `/v1/apps/${appId}?fields[apps]=contentRightsDeclaration`);
    current = app.data?.attributes?.contentRightsDeclaration ?? null;
  } catch (e) {
    console.log(`  [diag] contentRightsDeclaration GET 失敗（続行）: ${e.message.slice(0, 160)}`);
  }
  if (current === desired) {
    console.log(`  content rights: 既に ${current}（変更なし）`);
    return;
  }
  console.log(`  content rights: ${current ?? '(未設定)'} -> ${desired}`);
  await api('PATCH', `/v1/apps/${appId}`, {
    data: { type: 'apps', id: appId, attributes: { contentRightsDeclaration: desired } },
  });
  console.log('  ✓ content rights declaration 設定完了');
}

// App Store のカテゴリ（primaryCategory）を埋める。未設定だと submit が
// 409 STATE_ERROR.ENTITY_STATE_INVALID（associatedErrors に
// "You must provide a value for the relationship 'primaryCategory'"）で弾かれる。
// これは appInfo レベルの **relationship**（attribute ではない）で、appCategories
// リソース（id は 'SOCIAL_NETWORKING' 等の文字列 enum）への参照。一度設定すれば永続。
//
// kimito.link は X ログイン基盤のリンクまとめ／プロフィール集約＝SNS 性が中核なので
// SOCIAL_NETWORKING が正。env IOS_PRIMARY_CATEGORY / IOS_SECONDARY_CATEGORY で上書き可。
// secondary は任意（submit には不要）なので env 指定時のみ設定する。
async function ensureCategory(api, appId) {
  const primary = process.env.IOS_PRIMARY_CATEGORY || APP_CONFIG.stores?.primaryCategory || 'BUSINESS';
  const secondary = process.env.IOS_SECONDARY_CATEGORY || null;

  // submit に使われる appInfo（PREPARE_FOR_SUBMISSION 優先）を特定する。
  let appInfo = null;
  try {
    const infos = await api(
      'GET',
      `/v1/apps/${appId}/appInfos?limit=10&include=primaryCategory,secondaryCategory&fields[appInfos]=appStoreState,primaryCategory,secondaryCategory`,
    );
    appInfo =
      (infos.data || []).find((ai) => ai.attributes?.appStoreState === 'PREPARE_FOR_SUBMISSION') ||
      (infos.data || [])[0] ||
      null;
    const cur = appInfo?.relationships?.primaryCategory?.data?.id || '(未設定)';
    console.log(`  [diag] appInfo id=${appInfo?.id} primaryCategory=${cur}`);
  } catch (e) {
    console.log(`  [diag] appInfos 取得失敗: ${e.message.slice(0, 160)}`);
  }
  if (!appInfo) {
    console.log('  WARN: appInfo を特定できず category を設定できません（submit が弾く可能性）。');
    return;
  }

  const currentPrimary = appInfo.relationships?.primaryCategory?.data?.id || null;
  if (currentPrimary === primary && !secondary) {
    console.log(`  category: primary は既に ${primary}（変更なし）`);
    return;
  }

  const relationships = {
    primaryCategory: { data: { type: 'appCategories', id: primary } },
  };
  if (secondary) {
    relationships.secondaryCategory = { data: { type: 'appCategories', id: secondary } };
  }
  console.log(`  category: primary ${currentPrimary ?? '(未設定)'} -> ${primary}${secondary ? ` / secondary -> ${secondary}` : ''}`);
  await api('PATCH', `/v1/appInfos/${appInfo.id}`, {
    data: { type: 'appInfos', id: appInfo.id, relationships },
  });
  console.log('  ✓ category 設定完了');
}

async function submitForReview(api, appId, versionId) {
  console.log(`  fetch existing review submissions...`);
  const existing = await api(
    'GET',
    `/v1/reviewSubmissions?filter[app]=${appId}&filter[platform]=${PLATFORM}&filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES`,
  );
  let rsId;
  const inFlight = (existing.data || [])[0];
  if (inFlight) {
    rsId = inFlight.id;
    console.log(`  reuse reviewSubmission id=${rsId} state=${inFlight.attributes.state}`);
    if (['WAITING_FOR_REVIEW', 'IN_REVIEW'].includes(inFlight.attributes.state)) {
      console.log(`  already submitted, nothing to do`);
      return;
    }
  } else {
    const created = await api('POST', '/v1/reviewSubmissions', {
      data: {
        type: 'reviewSubmissions',
        attributes: { platform: PLATFORM },
        relationships: { app: { data: { type: 'apps', id: appId } } },
      },
    });
    rsId = created.data.id;
    console.log(`  created reviewSubmission id=${rsId} state=${created.data.attributes.state}`);
  }
  const items = await api('GET', `/v1/reviewSubmissions/${rsId}/items`);
  const hasVersion = (items.data || []).some(
    (it) => it.relationships?.appStoreVersion?.data?.id === versionId,
  );
  if (!hasVersion) {
    console.log(`  add reviewSubmissionItem (versionId=${versionId})`);
    const itemBody = {
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: { data: { type: 'reviewSubmissions', id: rsId } },
          appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
        },
      },
    };
    try {
      await api('POST', '/v1/reviewSubmissionItems', itemBody);
    } catch (e) {
      const detail = String(e.message);
      const m = detail.match(/already added to another reviewSubmission with id ([0-9a-fA-F-]+)/);
      if (!m) throw e;
      const otherRsId = m[1];
      console.log(`  ITEM_PART_OF_ANOTHER_SUBMISSION → attempt to free version from ${otherRsId}`);
      await freeVersionFromStaleSubmission(api, versionId, otherRsId);
      console.log(`  retry POST reviewSubmissionItems`);
      await api('POST', '/v1/reviewSubmissionItems', itemBody);
    }
  }
  console.log(`  PATCH submitted=true`);
  await api('PATCH', `/v1/reviewSubmissions/${rsId}`, {
    data: { type: 'reviewSubmissions', id: rsId, attributes: { submitted: true } },
  });
  const final = await api('GET', `/v1/reviewSubmissions/${rsId}`);
  console.log(`  final state=${final.data.attributes.state} submittedDate=${final.data.attributes.submittedDate || ''}`);
}

(async () => {
  const keyId = process.env.APPSTORE_CONNECT_KEY_ID;
  const issuerId = process.env.APPSTORE_CONNECT_ISSUER_ID;
  if (!keyId || !issuerId) throw new Error('Set APPSTORE_CONNECT_KEY_ID and APPSTORE_CONNECT_ISSUER_ID');
  const privateKey = resolvePrivateKey();

  const marketing = readMarketingVersion();
  const buildNumber = process.env.IOS_BUILD_NUMBER ? String(process.env.IOS_BUILD_NUMBER).trim() : null;
  const whatsNew = readWhatsNew();

  console.log(`bundleId=${BUNDLE_ID} marketing=${marketing} build=${buildNumber || '(latest)'}`);
  console.log(`whatsNew (${whatsNew.length} chars):\n  ${whatsNew.slice(0, 120).replace(/\n/g, ' / ')}...`);

  const api = makeAscClient({ keyId, issuerId, privateKey });

  console.log('\n[1] Find app...');
  const app = await findApp(api, BUNDLE_ID);
  if (!app) throw new Error(`App not found for bundleId=${BUNDLE_ID}`);
  console.log(`  appId=${app.id} name="${app.attributes.name}"`);

  console.log('\n[1b] Sync App Info localization...');
  await ensureAppInfoLocalization(api, app.id);

  console.log('\n[2] Pre-check existing version state...');
  let versions = await listVersions(api, app.id, 50);
  const liveVersion = versions.find((v) => v.platform === PLATFORM && v.appStoreState === 'READY_FOR_SALE');
  const existingSameVersion = versions.find((v) => v.platform === PLATFORM && v.versionString === marketing);
  const SHIPPED_STATES = new Set([
    'READY_FOR_SALE',
    'PREORDER_READY_FOR_SALE',
    'REPLACED_WITH_NEW_VERSION',
  ]);
  if (existingSameVersion && SHIPPED_STATES.has(existingSameVersion.appStoreState)) {
    console.log(
      `  version ${marketing} is already ${existingSameVersion.appStoreState}.\n  Nothing to do.`,
    );
    console.log(`  -> Bump the version first for a new release.`);
    return;
  }

  // 状態を 3 分類で扱う(混ぜると審査中の本番版を誤って cancel して事故る)。
  const DEVELOPER_TURN_STATES = new Set([
    'REJECTED',
    'METADATA_REJECTED',
    'DEVELOPER_REJECTED',
    'INVALID_BINARY',
    'PREPARE_FOR_SUBMISSION',
  ]);
  const APPLE_TURN_STATES = new Set([
    'WAITING_FOR_REVIEW',
    'IN_REVIEW',
    'PENDING_DEVELOPER_RELEASE',
    'PENDING_APPLE_RELEASE',
    'PROCESSING_FOR_APP_STORE',
  ]);

  const SUPERSEDABLE_APPLE_STATES = new Set(['WAITING_FOR_REVIEW']);
  const ACTIVELY_IN_REVIEW_STATES = new Set([
    'IN_REVIEW',
    'PENDING_DEVELOPER_RELEASE',
    'PENDING_APPLE_RELEASE',
    'PROCESSING_FOR_APP_STORE',
  ]);

  // semver 比較(local package.json をダウングレードしても newer 版を cancel しない)。
  const cmpSemver = (a, b) => {
    const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d;
    }
    return 0;
  };

  const otherBlocking = versions.filter(
    (v) =>
      v.platform === PLATFORM &&
      v.versionString !== marketing &&
      (DEVELOPER_TURN_STATES.has(v.appStoreState) || APPLE_TURN_STATES.has(v.appStoreState)),
  );
  let didRepurpose = false;
  for (const other of otherBlocking) {
    if (ACTIVELY_IN_REVIEW_STATES.has(other.appStoreState)) {
      console.log(
        `  another version ${other.versionString} is currently ${other.appStoreState} (Apple actively in review / pending release).\n  ` +
          `Skipping iOS submission for now (CI exits clean; web / Android unaffected).\n  ` +
          `If you intend to supersede this version, cancel it manually in App Store Connect and re-run.`,
      );
      return;
    }
    if (SUPERSEDABLE_APPLE_STATES.has(other.appStoreState)) {
      if (cmpSemver(marketing, other.versionString) <= 0) {
        console.log(
          `  another version ${other.versionString} is ${other.appStoreState} but local package.json marketing ${marketing} is NOT higher (semver).\n  ` +
            `Refusing to supersede — bump package.json first.`,
        );
        return;
      }
      console.log(
        `  another version ${other.versionString} is ${other.appStoreState} (Apple's queue, not yet under review).\n  ` +
          `New build ${marketing} pushed → cancelling old submission + repurposing version row.`,
      );
      await repurposeBlockingVersion(api, app.id, other, marketing);
      didRepurpose = true;
      continue;
    }
    console.log(
      `  another version ${other.versionString} is ${other.appStoreState} (developer's turn).\n  ` +
        `Re-purposing as ${marketing}...`,
    );
    await repurposeBlockingVersion(api, app.id, other, marketing);
    didRepurpose = true;
  }

  if (existingSameVersion && DEVELOPER_TURN_STATES.has(existingSameVersion.appStoreState)) {
    console.log(
      `  version ${marketing} itself is ${existingSameVersion.appStoreState} (developer's turn).\n  ` +
        `Cancelling any open review submission...`,
    );
    await cancelOpenReviewSubmissions(api, app.id);
    didRepurpose = true;
  }
  if (existingSameVersion && APPLE_TURN_STATES.has(existingSameVersion.appStoreState)) {
    console.log(
      `  version ${marketing} is already ${existingSameVersion.appStoreState} (Apple's turn).\n  Nothing to do.`,
    );
    return;
  }

  let liveVersionAfter = liveVersion;
  if (didRepurpose) {
    versions = await listVersions(api, app.id, 50);
    liveVersionAfter = versions.find((v) => v.platform === PLATFORM && v.appStoreState === 'READY_FOR_SALE') || null;
  }

  console.log('\n[3] Wait for build to be VALID...');
  const build = await pollBuildProcessing(api, app.id, marketing, buildNumber);
  console.log(`  build OK: id=${build.id} ${build.marketingVersion} (${build.buildNumber})`);

  console.log('\n[4] Ensure version exists...');
  const version = await ensureVersion(api, app.id, marketing);
  console.log(`  versionId=${version.id} state=${version.appStoreState}`);

  console.log('\n[5] Set ja localization with whatsNew...');
  const jaLoc = await ensureLocalization(api, version.id, liveVersionAfter?.id || null, whatsNew);

  console.log('\n[5b] Upload iPhone screenshots (6.7" + 6.5")...');
  const screenshotsDir = process.env.IOS_SCREENSHOTS_DIR || path.join(REPO, 'ios-screenshots');
  try {
    const r = await uploadIPhoneScreenshots(api, jaLoc.id, screenshotsDir);
    console.log(`  screenshots: uploaded=${r.uploaded} deleted=${r.deleted ?? 0} skipped=${r.skipped}`);
  } catch (e) {
    console.log(`  WARN: screenshot upload failed (continuing): ${e.message.slice(0, 400)}`);
  }

  console.log('\n[6] Link build...');
  await linkBuild(api, version.id, build.id);

  console.log('\n[7] Ensure review detail...');
  await ensureReviewDetail(api, version.id, liveVersionAfter?.id || null);

  console.log('\n[7b] Ensure free-tier pricing...');
  try {
    await ensureFreePricing(api, app.id);
  } catch (e) {
    console.log(`  WARN: pricing setup failed (continuing): ${e.message.slice(0, 400)}`);
  }

  console.log('\n[7b2] Ensure territory availability (all territories)...');
  try {
    await ensureAllTerritoriesAvailable(api, app.id);
  } catch (e) {
    console.log(`  WARN: territory availability setup failed (continuing): ${e.message.slice(0, 400)}`);
  }

  console.log('\n[7c] Ensure age rating...');
  await ensureAgeRating(api, version.id, app.id);

  console.log('\n[7d] Ensure privacy (data usages published)...');
  await ensurePrivacy(api, app.id);

  console.log('\n[7e] Ensure content rights declaration...');
  await ensureContentRights(api, app.id);

  console.log('\n[7f] Ensure App Store category...');
  await ensureCategory(api, app.id);

  console.log('\n[8] Submit for review...');
  await submitForReview(api, app.id, version.id);

  console.log('\nDONE.');
})().catch((e) => {
  console.error(`\nFATAL: ${e.message}`);
  process.exit(1);
});
