#!/usr/bin/env node
// App Store 用 Provisioning Profile を App Store Connect API で作成する。
// これにより Apple Developer Portal の手動操作なしで、bundleId 固有の
// プロビジョニングプロファイル（IOS_APPSTORE_PROFILE_BASE64 の中身）を作れる。
//
// 必要な env（ローカル実行用。鍵は kimitolink-linktree/.secrets-local 等から渡す）:
//   APPSTORE_CONNECT_KEY_ID
//   APPSTORE_CONNECT_ISSUER_ID
//   APPSTORE_CONNECT_API_KEY_P8_PATH   (.p8 ファイルのパス)  ← または _P8 で中身を直接
//   APP_BUNDLE_ID  (default: app.config.json identity.bundleId)
//
// 出力:
//   build/AppStore.mobileprovision   （作成された .mobileprovision）
//   標準出力に base64（gh secret set にパイプ可能）
//
// 使い方（PowerShell/Git Bash）:
//   APPSTORE_CONNECT_KEY_ID=XXX APPSTORE_CONNECT_ISSUER_ID=YYY \
//   APPSTORE_CONNECT_API_KEY_P8_PATH=/path/AuthKey.p8 \
//   node scripts/asc-create-profile.mjs
//
// その後:
//   base64 -w0 build/AppStore.mobileprovision | gh secret set IOS_APPSTORE_PROFILE_BASE64 --repo <owner/repo>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeAscClient } from './lib/asc-api.mjs';
import { loadAppConfig, getProjectRoot } from './lib/app-config.mjs';

const ROOT = getProjectRoot();
const cfg = loadAppConfig();
const BUNDLE_ID = process.env.APP_BUNDLE_ID || cfg.identity.bundleId;

function resolvePrivateKey() {
  if (process.env.APPSTORE_CONNECT_API_KEY_P8) return process.env.APPSTORE_CONNECT_API_KEY_P8;
  const p = process.env.APPSTORE_CONNECT_API_KEY_P8_PATH;
  if (p && fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  if (process.env.APPSTORE_CONNECT_API_KEY_P8_BASE64) {
    return Buffer.from(process.env.APPSTORE_CONNECT_API_KEY_P8_BASE64, 'base64').toString('utf8');
  }
  throw new Error('Provide APPSTORE_CONNECT_API_KEY_P8 / _PATH / _BASE64 in the environment.');
}

const keyId = (process.env.APPSTORE_CONNECT_KEY_ID || '').trim();
const issuerId = (process.env.APPSTORE_CONNECT_ISSUER_ID || '').trim();
if (!keyId || !issuerId) throw new Error('APPSTORE_CONNECT_KEY_ID / _ISSUER_ID required.');

const api = makeAscClient({ keyId, issuerId, privateKey: resolvePrivateKey() });

async function main() {
  console.log(`bundleId = ${BUNDLE_ID}`);

  // 1) Bundle ID リソース取得
  const bidRes = await api('GET', `/v1/bundleIds?filter[identifier]=${encodeURIComponent(BUNDLE_ID)}&limit=200`);
  const bid = (bidRes.data || []).find((b) => b.attributes?.identifier === BUNDLE_ID);
  if (!bid) {
    throw new Error(
      `Bundle ID "${BUNDLE_ID}" が Developer Portal に見つかりません。先に Identifiers で登録してください。`,
    );
  }
  console.log(`  bundleId resource id = ${bid.id}`);

  // 2) 配布証明書（DISTRIBUTION / Apple Distribution）取得。
  // ⚠️ アカウントに配布証明書が複数あると、Profile に紐付けた証明書と
  // 署名に使う証明書（Secret の .cer）が食い違い、Export IPA が
  // "Provisioning profile doesn't include signing certificate" で失敗する。
  // → env CERT_SERIAL（Secret の .cer のシリアル）と一致する証明書を厳密に選ぶ。
  const certRes = await api('GET', '/v1/certificates?limit=200&fields[certificates]=certificateType,displayName,expirationDate,serialNumber');
  const distAll = (certRes.data || [])
    .filter((c) => ['IOS_DISTRIBUTION', 'DISTRIBUTION', 'APPLE_DISTRIBUTION'].includes(c.attributes?.certificateType));
  if (!distAll.length) {
    throw new Error('配布証明書（Apple Distribution）が見つかりません。Certificates を確認してください。');
  }
  // openssl は先頭ゼロパディング付きで serial を出すが、ASC は先頭ゼロを落として
  // 保持することがある（例: openssl=0EB4EB... / ASC=EB4EB...）。先頭ゼロを除いて比較する。
  const normSerial = (s) => String(s || '').trim().toUpperCase().replace(/^0X/, '').replace(/^0+/, '');
  const wantSerial = normSerial(process.env.CERT_SERIAL);
  let cert;
  if (wantSerial) {
    cert = distAll.find((c) => normSerial(c.attributes?.serialNumber) === wantSerial);
    if (!cert) {
      console.error('利用可能な配布証明書:');
      for (const c of distAll) console.error(`  id=${c.id} serial=${c.attributes?.serialNumber} exp=${c.attributes?.expirationDate}`);
      throw new Error(`CERT_SERIAL=${wantSerial} に一致する配布証明書が ASC に見つかりません。`);
    }
  } else {
    cert = distAll.sort((a, b) => Date.parse(b.attributes?.expirationDate || 0) - Date.parse(a.attributes?.expirationDate || 0))[0];
    console.warn('  [warn] CERT_SERIAL 未指定。期限最新の証明書を使用（複数証明書があると署名不一致の恐れ）。');
  }
  console.log(`  distribution cert id = ${cert.id} (serial ${cert.attributes?.serialNumber}, exp ${cert.attributes?.expirationDate})`);

  // 3) 既存の同名 profile があれば消す（再作成で最新証明書に追従）
  const profileName = `${cfg.identity.shortName} App Store`;
  const existRes = await api('GET', `/v1/profiles?filter[name]=${encodeURIComponent(profileName)}&limit=200`);
  for (const p of existRes.data || []) {
    if (p.attributes?.name === profileName) {
      console.log(`  deleting existing profile ${p.id} (${profileName})`);
      await api('DELETE', `/v1/profiles/${p.id}`).catch(() => {});
    }
  }

  // 4) Profile 作成（IOS_APP_STORE）
  const body = {
    data: {
      type: 'profiles',
      attributes: { name: profileName, profileType: 'IOS_APP_STORE' },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bid.id } },
        certificates: { data: [{ type: 'certificates', id: cert.id }] },
      },
    },
  };
  const created = await api('POST', '/v1/profiles', body);
  const content = created.data?.attributes?.profileContent;
  if (!content) throw new Error('Profile は作成されたが profileContent が空です。');

  const outDir = path.join(ROOT, 'build');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'AppStore.mobileprovision');
  fs.writeFileSync(outPath, Buffer.from(content, 'base64'));
  console.log(`  wrote ${outPath}`);
  console.log(`  profile id = ${created.data.id}, name = ${profileName}`);
  console.log('\n--- IOS_APPSTORE_PROFILE_BASE64 (この base64 を Secret に登録) ---');
  console.log(content);
  console.log('--- end ---');
  console.log('\n次: base64 値はすでに上記。または build/AppStore.mobileprovision から:');
  console.log('  base64 -w0 build/AppStore.mobileprovision | gh secret set IOS_APPSTORE_PROFILE_BASE64 --repo kimito-link/malwarecheck.site');
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
