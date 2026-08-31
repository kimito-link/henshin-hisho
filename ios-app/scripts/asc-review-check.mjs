#!/usr/bin/env node
// 移植元: partnership_program_website/scripts/asc-review-check.mjs
//        (Exosome/scripts/asc-review-check.mjs と同一内容)
//
// App Store Connect の審査ステータスをポーリングし、REJECTED / METADATA_REJECTED /
// DEVELOPER_REJECTED / INVALID_BINARY を検出して JSON レポートを吐く。
// 連携ワークフローがこれを元に GitHub Issue を自動作成する想定。
//
// app.config.json を SSOT とする: bundleId はハードコードせず、env APP_BUNDLE_ID
// 優先 → app.config.json identity.bundleId の順で解決する。
//
// Reads:
//   env APPSTORE_CONNECT_KEY_ID
//   env APPSTORE_CONNECT_ISSUER_ID
//   env APPSTORE_CONNECT_API_KEY_P8_BASE64 (or _PATH or raw _P8)
//   env APP_BUNDLE_ID (省略時は app.config.json の identity.bundleId)
//
// Outputs (stdout):
//   {"appId":"...","bundleId":"...","rejections":[{...}],"timestamp":"..."}
//
// Exit codes:
//   0 = ran successfully (rejections list may be empty)
//   non-zero = api/auth error
import fs from 'node:fs';
import { makeAscClient, findApp, listVersions } from './lib/asc-api.mjs';
import { classifyRejection, fetchRejectionFeedback } from './lib/asc-rejection-classify.mjs';
import { loadAppConfig } from './lib/app-config.mjs';

const APP_CONFIG = loadAppConfig();
const BUNDLE_ID = process.env.APP_BUNDLE_ID || APP_CONFIG.identity.bundleId;

const REJECT_STATES = new Set([
  'REJECTED',
  'METADATA_REJECTED',
  'DEVELOPER_REJECTED',
  'INVALID_BINARY',
]);

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
  throw new Error('Provide APPSTORE_CONNECT_API_KEY_P8_PATH, _BASE64, or _P8');
}

function emit(report) {
  process.stdout.write(JSON.stringify(report) + '\n');
}

(async () => {
  const keyId = process.env.APPSTORE_CONNECT_KEY_ID;
  const issuerId = process.env.APPSTORE_CONNECT_ISSUER_ID;
  if (!keyId || !issuerId) {
    throw new Error('Missing APPSTORE_CONNECT_KEY_ID / APPSTORE_CONNECT_ISSUER_ID');
  }
  const privateKey = resolvePrivateKey();
  const api = makeAscClient({ keyId, issuerId, privateKey });

  const app = await findApp(api, BUNDLE_ID);
  if (!app) {
    // ASC アプリレコードがまだ無い。空レポートを静かに出す。
    emit({
      bundleId: BUNDLE_ID,
      appId: null,
      rejections: [],
      timestamp: new Date().toISOString(),
      note: 'no_app_record_yet',
    });
    return;
  }

  const versions = await listVersions(api, app.id, 20);
  const rejected = versions.filter((v) => REJECT_STATES.has(v.appStoreState));
  const rejections = [];
  for (const v of rejected) {
    const feedbackText = await fetchRejectionFeedback(api, v.id);
    const classification = classifyRejection({ state: v.appStoreState, feedbackText });
    rejections.push({
      versionId: v.id,
      versionString: v.versionString,
      state: v.appStoreState,
      platform: v.platform,
      feedbackText,
      classification,
    });
  }

  emit({
    bundleId: BUNDLE_ID,
    appId: app.id,
    appName: app.attributes?.name || null,
    rejections,
    timestamp: new Date().toISOString(),
  });
})().catch((e) => {
  console.error(`asc-review-check FATAL: ${e.message}`);
  process.exit(1);
});
