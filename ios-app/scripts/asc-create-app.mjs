#!/usr/bin/env node
// 移植元: partnership_program_website/scripts/asc-create-app.mjs
//        (Exosome/scripts/asc-create-app.mjs と同一内容)
//
// app.config.json を SSOT として App Store Connect のアプリレコードを provision する。
// 固有値は一切ハードコードせず、すべて app.config.json / env から読む。
//
// Apple は brand-new App レコードの API 作成を信頼できる形で提供していないため、
// このスクリプトは仕事を分割する:
//   1. 設定済み bundleId のアプリが既にあれば「メタデータ provision」として扱う:
//      App Info カテゴリ / 年齢レーティング / コンテンツ権利を PATCH し、
//      発見した ascAppId を app.config.json に書き戻す。
//   2. アプリが無ければ、ASC web UI での手動作成手順を正確に表示し、再実行を促す。
//
// spawn-new-app 系で bundleId / displayName をセットした後に実行する。
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  makeAscClient,
  findApp,
} from './lib/asc-api.mjs';
import { loadAppConfig, getProjectRoot } from './lib/app-config.mjs';

const ROOT = getProjectRoot();
const CONFIG_PATH = path.join(ROOT, 'app.config.json');

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});

if (values.help) {
  console.log(
    [
      'asc-create-app: provision App Store Connect metadata for the configured app.',
      '',
      'Reads app.config.json and ASC API credentials from env:',
      '  APPSTORE_CONNECT_KEY_ID',
      '  APPSTORE_CONNECT_ISSUER_ID',
      '  APPSTORE_CONNECT_API_KEY_P8_BASE64  (or _PATH / _P8 with literal PEM)',
      '',
      'Flags:',
      '  --dry-run   Show what would change without calling Apple.',
      '  -h, --help  Show this help.',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

const config = loadAppConfig();

function resolvePrivateKey() {
  const direct = process.env.APPSTORE_CONNECT_API_KEY_P8;
  if (direct && direct.includes('BEGIN PRIVATE KEY')) return direct;
  const filePath = process.env.APPSTORE_CONNECT_API_KEY_P8_PATH;
  if (filePath && fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
  const b64 = process.env.APPSTORE_CONNECT_API_KEY_P8_BASE64;
  if (b64) return Buffer.from(b64.trim(), 'base64').toString('utf8');
  throw new Error(
    'Provide APPSTORE_CONNECT_API_KEY_P8 / _PATH / _BASE64 in the environment.',
  );
}

const api = makeAscClient({
  keyId: process.env.APPSTORE_CONNECT_KEY_ID,
  issuerId: process.env.APPSTORE_CONNECT_ISSUER_ID,
  privateKey: resolvePrivateKey(),
});

const bundleId = config.identity.bundleId;
console.log(`Looking up ASC app for bundleId=${bundleId}...`);

const app = await findApp(api, bundleId);

if (!app) {
  console.log(`\n  App record NOT found in ASC.`);
  console.log('\nApple does not reliably support creating brand-new app records');
  console.log('via the public API. Do this manually one time:');
  console.log('');
  console.log('  1. https://developer.apple.com/account/resources/identifiers/list');
  console.log(`     → register App ID: ${bundleId}`);
  console.log('     (Capabilities: leave defaults for now)');
  console.log('');
  console.log('  2. https://appstoreconnect.apple.com/apps');
  console.log('     → "+" → New App');
  console.log(`        Platforms: iOS`);
  console.log(`        Name: ${config.identity.displayNameEn}`);
  console.log(`        Primary Language: English (U.S.)`);
  console.log(`        Bundle ID: ${bundleId}  (select from the dropdown)`);
  console.log(`        SKU: ${config.identity.shortName.toLowerCase()}-ios-${Date.now()}`);
  console.log(`        User Access: Full Access`);
  console.log('');
  console.log('  3. Re-run this script to fill App Info / age rating / content rights.');
  process.exit(2);
}

console.log(`Found app: id=${app.id}  name="${app.attributes.name}"`);

// ----- 発見した ascAppId を app.config.json に書き戻す(SSOT を最新化) -----
if (config.stores.ascAppId !== app.id) {
  console.log(
    `Persisting ascAppId in app.config.json: ${config.stores.ascAppId ?? 'null'} → ${app.id}`,
  );
  if (!values['dry-run']) {
    config.stores.ascAppId = app.id;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  }
}

// ----- App Info: カテゴリ + コンテンツ権利 -----
const appInfos = await api('GET', `/v1/apps/${app.id}/appInfos`);
const editableAppInfo = (appInfos.data || []).find(
  (ai) => ai.attributes?.appStoreState === 'PREPARE_FOR_SUBMISSION' ||
    ai.attributes?.appStoreAgeRating == null,
) || appInfos.data?.[0];

if (!editableAppInfo) {
  console.log('  No editable appInfo found — skipping metadata patch.');
} else {
  console.log(`Patching appInfo ${editableAppInfo.id}:`);
  const patch = {
    type: 'appInfos',
    id: editableAppInfo.id,
    attributes: {},
    relationships: {},
  };
  const wantedCategory = config.stores.primaryCategory;
  patch.relationships.primaryCategory = {
    data: { type: 'appCategories', id: ascCategoryId(wantedCategory) },
  };
  patch.attributes.usesThirdPartyContent =
    config.stores.contentRights === 'USES_THIRD_PARTY_CONTENT';

  if (values['dry-run']) {
    console.log('  [dry-run] PATCH /v1/appInfos/' + editableAppInfo.id, JSON.stringify(patch, null, 2));
  } else {
    try {
      await api('PATCH', `/v1/appInfos/${editableAppInfo.id}`, { data: patch });
      console.log(`  ✓ category=${wantedCategory}  usesThirdPartyContent=${patch.attributes.usesThirdPartyContent}`);
    } catch (e) {
      console.log(`  ! appInfo PATCH failed (will need ASC UI fix): ${e.message.slice(0, 200)}`);
    }
  }
}

// ----- 年齢レーティング宣言 -----
console.log('Setting age rating...');
const ageRatingPayload = ageRatingAttrs(config.stores.ageRating);
if (values['dry-run']) {
  console.log('  [dry-run] age rating →', config.stores.ageRating);
} else {
  let existingDecl = null;
  try {
    const r = await api('GET', `/v1/apps/${app.id}/ageRatingDeclaration`);
    existingDecl = r?.data || null;
  } catch {
    /* no existing */
  }
  if (existingDecl) {
    try {
      await api('PATCH', `/v1/ageRatingDeclarations/${existingDecl.id}`, {
        data: { type: 'ageRatingDeclarations', id: existingDecl.id, attributes: ageRatingPayload },
      });
      console.log(`  ✓ ageRating=${config.stores.ageRating}`);
    } catch (e) {
      console.log(`  ! age rating PATCH failed: ${e.message.slice(0, 200)}`);
    }
  } else {
    console.log('  · no existing ageRatingDeclaration; will be created on first version submit');
  }
}

console.log('\nDone. ascAppId =', app.id);

// ----------------------------------------------------------------------------
// Mappings (App Store Connect category IDs は概ね固定値)
// ----------------------------------------------------------------------------
function ascCategoryId(category) {
  const map = {
    BUSINESS: 'BUSINESS',
    PRODUCTIVITY: 'PRODUCTIVITY',
    LIFESTYLE: 'LIFESTYLE',
    UTILITIES: 'UTILITIES',
    FINANCE: 'FINANCE',
    EDUCATION: 'EDUCATION',
    HEALTH_AND_FITNESS: 'HEALTH_AND_FITNESS',
  };
  return map[category] || category;
}

function ageRatingAttrs(rating) {
  const base = {
    alcoholTobaccoOrDrugUseOrReferences: 'NONE',
    contests: 'NONE',
    gamblingSimulated: 'NONE',
    medicalOrTreatmentInformation: 'NONE',
    profanityOrCrudeHumor: 'NONE',
    sexualContentGraphicAndNudity: 'NONE',
    sexualContentOrNudity: 'NONE',
    horrorOrFearThemes: 'NONE',
    matureOrSuggestiveThemes: 'NONE',
    unrestrictedWebAccess: false,
    gamblingAndContests: false,
    kidsAgeBand: null,
    violenceCartoonOrFantasy: 'NONE',
    violenceRealistic: 'NONE',
    violenceRealisticProlongedGraphicOrSadistic: 'NONE',
  };
  if (rating === 'FOUR_PLUS') return base;
  if (rating === 'NINE_PLUS') return { ...base, matureOrSuggestiveThemes: 'INFREQUENT_OR_MILD' };
  if (rating === 'TWELVE_PLUS') return { ...base, matureOrSuggestiveThemes: 'FREQUENT_OR_INTENSE' };
  if (rating === 'SEVENTEEN_PLUS') return { ...base, sexualContentOrNudity: 'INFREQUENT_OR_MILD' };
  return base;
}
