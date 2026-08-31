#!/usr/bin/env node
// App Store Connect の app リソースに contentRightsDeclaration を設定する。
//
// 初回提出が "You must provide a value for the attribute 'contentRightsDeclaration'"
// (ENTITY_ERROR.ATTRIBUTE.REQUIRED) で 409 になるのを解消する。
// asc-create-app.mjs の appInfo PATCH は別属性で、これは app 本体の属性。
//
// 値:
//   DOES_NOT_USE_THIRD_PARTY_CONTENT  … 第三者コンテンツを含まない（malwarecheck はこれ）
//   USES_THIRD_PARTY_CONTENT          … 含む
//
// 必要な env:
//   APPSTORE_CONNECT_KEY_ID / _ISSUER_ID / _API_KEY_P8_BASE64(or _PATH/_P8)
//   APP_BUNDLE_ID（default: app.config.json identity.bundleId）
//   CONTENT_RIGHTS（default: app.config.json stores.contentRights）
import fs from 'node:fs';
import { makeAscClient, findApp } from './lib/asc-api.mjs';
import { loadAppConfig } from './lib/app-config.mjs';

const cfg = loadAppConfig();
const BUNDLE_ID = process.env.APP_BUNDLE_ID || cfg.identity.bundleId;
const DECL = process.env.CONTENT_RIGHTS || cfg.stores.contentRights || 'DOES_NOT_USE_THIRD_PARTY_CONTENT';

function resolvePrivateKey() {
  if (process.env.APPSTORE_CONNECT_API_KEY_P8) return process.env.APPSTORE_CONNECT_API_KEY_P8;
  const p = process.env.APPSTORE_CONNECT_API_KEY_P8_PATH;
  if (p && fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  if (process.env.APPSTORE_CONNECT_API_KEY_P8_BASE64) {
    return Buffer.from(process.env.APPSTORE_CONNECT_API_KEY_P8_BASE64, 'base64').toString('utf8');
  }
  throw new Error('Provide APPSTORE_CONNECT_API_KEY_P8 / _PATH / _BASE64.');
}

const keyId = (process.env.APPSTORE_CONNECT_KEY_ID || '').trim();
const issuerId = (process.env.APPSTORE_CONNECT_ISSUER_ID || '').trim();
if (!keyId || !issuerId) throw new Error('APPSTORE_CONNECT_KEY_ID / _ISSUER_ID required.');

const api = makeAscClient({ keyId, issuerId, privateKey: resolvePrivateKey() });

async function main() {
  const app = await findApp(api, BUNDLE_ID);
  if (!app) throw new Error(`App not found for bundleId=${BUNDLE_ID}`);
  console.log(`app id=${app.id}  contentRightsDeclaration -> ${DECL}`);

  await api('PATCH', `/v1/apps/${app.id}`, {
    data: {
      type: 'apps',
      id: app.id,
      attributes: { contentRightsDeclaration: DECL },
    },
  });
  console.log('  ✓ contentRightsDeclaration set');
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
