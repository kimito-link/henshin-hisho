// 移植元: partnership_program_website/scripts/lib/asc-screenshot-upload.mjs
//
// App Store スクリーンショットを presigned-URL フローで ASC にアップロードする。
// Apple docs: https://developer.apple.com/documentation/appstoreconnectapi/uploading-assets-to-app-store-connect
// アプリ固有値は持たない(ファイルは prefix で照合)。app.config.json を SSOT とする
// 運用のため、このファイル自体は無改変で使える。appstore-submit.mjs から呼ばれる。
//
// スクショ1枚あたりのフロー:
//   1. POST /v1/appScreenshotSets (localization + screenshotDisplayType ごとに再利用)
//   2. POST /v1/appScreenshots に filename + fileSize → uploadOperations 取得
//   3. uploadOperations を実行(presigned PUT)
//   4. PATCH /v1/appScreenshots/{id} に uploaded:true + sourceFileChecksum(md5)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Apple はデバイス別スクショセットを要求。iPhone に絞っても 6.7" と 6.5" の
// 両方を検証する(片方だけだと STATE_ERROR.SCREENSHOT_REQUIRED.APP_IPHONE_65/67)。
// 各エントリは SCREENSHOT_OUT_DIR 内のファイル接頭辞 → display-type コード対応。
export const IPHONE_DISPLAY_TYPES = [
  { prefix: 'iphone-67', code: 'APP_IPHONE_67', width: 1290, height: 2796 },
  { prefix: 'iphone-65', code: 'APP_IPHONE_65', width: 1242, height: 2688 },
];

async function findOrCreateScreenshotSet(api, localizationId, displayType) {
  const list = await api(
    'GET',
    `/v1/appStoreVersionLocalizations/${localizationId}/appScreenshotSets?limit=20`,
  );
  const existing = (list.data || []).find(
    (s) => s.attributes.screenshotDisplayType === displayType,
  );
  if (existing) {
    return existing.id;
  }
  const created = await api('POST', '/v1/appScreenshotSets', {
    data: {
      type: 'appScreenshotSets',
      attributes: { screenshotDisplayType: displayType },
      relationships: {
        appStoreVersionLocalization: {
          data: { type: 'appStoreVersionLocalizations', id: localizationId },
        },
      },
    },
  });
  return created.data.id;
}

async function listScreenshots(api, setId) {
  // NB: 'uploaded' は fields[] で照会できない。assetDeliveryState.state === 'COMPLETE' で完了判定。
  const r = await api(
    'GET',
    `/v1/appScreenshotSets/${setId}/appScreenshots?limit=20&fields[appScreenshots]=fileName,assetDeliveryState`,
  );
  return r.data || [];
}

async function reserveScreenshot(api, setId, fileName, fileSize) {
  const r = await api('POST', '/v1/appScreenshots', {
    data: {
      type: 'appScreenshots',
      attributes: { fileName, fileSize },
      relationships: {
        appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } },
      },
    },
  });
  return r.data;
}

async function runUploadOperations(operations, bytes) {
  for (const op of operations) {
    const headers = {};
    for (const h of op.requestHeaders || []) {
      headers[h.name] = h.value;
    }
    const chunk = bytes.subarray(op.offset, op.offset + op.length);
    const res = await fetch(op.url, { method: op.method, headers, body: chunk });
    if (!res.ok) {
      throw new Error(
        `screenshot upload PUT ${op.url.slice(0, 80)}... -> ${res.status}: ${await res.text().then((t) => t.slice(0, 300))}`,
      );
    }
  }
}

async function commitScreenshot(api, screenshotId, bytes) {
  const md5 = crypto.createHash('md5').update(bytes).digest('hex');
  await api('PATCH', `/v1/appScreenshots/${screenshotId}`, {
    data: {
      type: 'appScreenshots',
      id: screenshotId,
      attributes: { uploaded: true, sourceFileChecksum: md5 },
    },
  });
}

async function deleteAllScreenshots(api, setId) {
  const existing = await listScreenshots(api, setId);
  let deleted = 0;
  for (const s of existing) {
    try {
      await api('DELETE', `/v1/appScreenshots/${s.id}`);
      deleted += 1;
    } catch (e) {
      // 部分的に古いスクショが残る状態が過去の Guideline 2.3.3 reject の原因。
      // 中途半端な mix を出荷するより、削除失敗で build を止める方が安全。
      throw new Error(
        `Failed to delete stale screenshot ${s.id} (${s.attributes.fileName}): ${e.message}`,
      );
    }
  }
  return deleted;
}

async function uploadOneSet(api, localizationId, dir, displayType, prefix) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .filter((f) => f.startsWith(prefix))
    .sort();
  if (files.length === 0) {
    console.log(`  ${displayType}: (no files starting with "${prefix}" in ${dir}; skipping)`);
    return { uploaded: 0, skipped: 0, deleted: 0 };
  }

  const setId = await findOrCreateScreenshotSet(api, localizationId, displayType);
  console.log(`  ${displayType} screenshotSet id=${setId}`);

  // 同じ version スロット(= 同じ appScreenshotSet)は versionString bump をまたいで
  // 残るため、明示的に消さないと古いスクショが永久に生き残る。再アップロード前に
  // 必ずクリアして、Apple に「今のキャプチャ」だけを見せる。ただしローカル dir が
  // 空のときは ASC のセットを黙って消さない(消すのは差し替えるファイルがある時だけ)。
  const deleted = await deleteAllScreenshots(api, setId);
  if (deleted > 0) {
    console.log(`  ${displayType}: deleted ${deleted} stale screenshot(s) before re-upload`);
  }

  let uploaded = 0;
  for (const file of files) {
    const full = path.join(dir, file);
    const bytes = fs.readFileSync(full);
    console.log(`  ${file}: reserving (${bytes.length} bytes)...`);
    const reserved = await reserveScreenshot(api, setId, file, bytes.length);
    console.log(`  ${file}: uploading bytes via ${reserved.attributes.uploadOperations.length} operation(s)...`);
    await runUploadOperations(reserved.attributes.uploadOperations, bytes);
    console.log(`  ${file}: committing checksum...`);
    await commitScreenshot(api, reserved.id, bytes);
    uploaded += 1;
  }
  return { uploaded, skipped: 0, deleted };
}

// 必要な iPhone スクショセット(現状 6.7" + 6.5")を `dir` から全部アップロード。
// ファイルは prefix 照合。常に delete-then-reupload で「今のキャプチャ」を出す。
export async function uploadIPhoneScreenshots(api, localizationId, dir) {
  if (!fs.existsSync(dir)) {
    console.log(`  (no screenshots dir at ${dir}; skipping)`);
    return { uploaded: 0, skipped: 0, deleted: 0 };
  }
  let uploaded = 0;
  let skipped = 0;
  let deleted = 0;
  for (const { prefix, code } of IPHONE_DISPLAY_TYPES) {
    const r = await uploadOneSet(api, localizationId, dir, code, prefix);
    uploaded += r.uploaded;
    skipped += r.skipped;
    deleted += r.deleted || 0;
  }
  return { uploaded, skipped, deleted };
}
