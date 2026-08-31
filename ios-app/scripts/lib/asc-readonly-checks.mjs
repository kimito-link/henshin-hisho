// ASC の「UI 手動項目」を提出前に **GET のみ** で検証する読み取り専用チェック群。
//
// 背景: _docs/FIRST-SUBMISSION-blockers.md B7/B8（contentRightsDeclaration 未設定・
// App プライバシー「公開」ボタン押し忘れ）と配信地域 0 件は、これまで「症状が出て
// から直す」チェックリストだった。ここでは submit 前に ASC 側の実状態を API で読み取り、
// lint-pre-submission.mjs の CHECK 9〜11 として「症状が出る前に止める」ゲートに昇格する。
//
// 設計上の約束:
//   - このモジュールは fail/warn/ok を **返す** だけ。実際の失敗集計・exit は
//     呼び出し側（lint-pre-submission.mjs）が既存の fail()/warn()/ok() で行う。
//   - 認証情報は既存の submit スクリプトと同一（APPSTORE_CONNECT_* + bundleId）。
//     新種のクレデンシャルは増やさない。creds/bundleId が無ければ呼び出し側が skip する。
//   - ASC API のエンドポイント仕様は Apple 側で predocumented なく変わりうる（配信地域は
//     v1 availableTerritories が deprecated → v2 appAvailabilities/territoryAvailabilities に移行済み）。
//     エンドポイントが 404/想定外形状を返したら false fail を出さず 'warn'（手動確認を促す）に倒す。
//     = 「分からなければ止める」ではなく「分からなければ人間に確認させる」。blocking を誤爆させない。
import fs from 'node:fs';
import { makeAscClient, findApp, listVersions, getReviewDetail } from './asc-api.mjs';

// asc-set-content-rights.mjs と同一の解決順（.p8 直値 / パス / base64）。
export function resolveAscPrivateKey() {
  if (process.env.APPSTORE_CONNECT_API_KEY_P8) return process.env.APPSTORE_CONNECT_API_KEY_P8;
  const p = process.env.APPSTORE_CONNECT_API_KEY_P8_PATH;
  if (p && fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  if (process.env.APPSTORE_CONNECT_API_KEY_P8_BASE64) {
    return Buffer.from(process.env.APPSTORE_CONNECT_API_KEY_P8_BASE64, 'base64').toString('utf8');
  }
  return null;
}

// ASC 資格情報が揃っているか（揃っていなければ呼び出し側は skip する）。
export function hasAscCreds() {
  const keyId = (process.env.APPSTORE_CONNECT_KEY_ID || '').trim();
  const issuerId = (process.env.APPSTORE_CONNECT_ISSUER_ID || '').trim();
  return Boolean(keyId && issuerId && resolveAscPrivateKey());
}

// {status:'ok'|'warn'|'fail', detail:string} を返す小さな結果型。
const R = (status, detail) => ({ status, detail });

/**
 * bundleId から app を引き、contentRightsDeclaration / App プライバシー / 配信地域を
 * GET のみで検証する。呼び出し側は返った results 配列を fail/warn/ok に振り分ける。
 *
 * @param {string} bundleId app.config.json identity.bundleId
 * @returns {Promise<{name:string, guideline:string, result:{status:string,detail:string}}[]>}
 */
export async function runAscReadonlyChecks(bundleId) {
  const keyId = (process.env.APPSTORE_CONNECT_KEY_ID || '').trim();
  const issuerId = (process.env.APPSTORE_CONNECT_ISSUER_ID || '').trim();
  const privateKey = resolveAscPrivateKey();
  const api = makeAscClient({ keyId, issuerId, privateKey });

  const out = [];
  let app;
  try {
    app = await findApp(api, bundleId);
  } catch (e) {
    // ネットワーク/認証エラーで app すら引けないなら、3 項目まとめて「確認できず」warn。
    // ここで fail にすると、ローカルの一時的なネット断で提出全体を止めてしまう。
    return [
      { name: 'asc-readonly-reachable', guideline: 'process', result: R('warn', `ASC API に到達できず手動項目を検証できなかった: ${e.message}`) },
    ];
  }
  if (!app) {
    // まだアプリ枠が無い（初回提出前）。asc-create-app.mjs で作る段階。ここは warn。
    return [
      { name: 'asc-app-exists', guideline: 'process', result: R('warn', `bundleId=${bundleId} の App が ASC に見つからない。初回なら asc-create-app.mjs で枠を作る`) },
    ];
  }
  const appId = app.id;

  out.push({ name: 'asc-content-rights-declared', guideline: 'meta/B7', result: await checkContentRightsDeclared(api, appId) });
  out.push({ name: 'asc-app-privacy-published', guideline: 'privacy/B8', result: await checkAppPrivacyPublished(api, appId) });
  out.push({ name: 'asc-territories-configured', guideline: 'process', result: await checkTerritoriesConfigured(api, appId) });
  out.push({ name: 'asc-review-demo-stale', guideline: 'process', result: await checkReviewDemoStale(api, appId) });
  return out;
}

// --- ASC 側 reviewer デモ値の stale 検出(タスク3) --------------------------------
// appstore-submit.mjs は demoAccountName/Password を env-first で上書きするが(env が正)、
// 「却下対応してもズレたまま」の手がかりとして、ASC 側の現在値と env の食い違いを事前に可視化する。
// env が優先されるため blocking にはしない(warn)。env 未指定なら比較不能なので skip 相当の ok。
async function checkReviewDemoStale(api, appId) {
  // secret に紛れる末尾改行/空白で誤検知しないよう trim して比較する(module 内の他の env と同様)。
  const envUser = (process.env.IOS_REVIEW_DEMO_USERNAME || '').trim();
  if (!envUser) {
    // ログイン不要アプリ or demo 値未使用。比較対象が無いので沈黙(ok)。
    return R('ok', 'IOS_REVIEW_DEMO_USERNAME 未指定(demo 比較なし)');
  }
  try {
    // 編集可能な最新バージョン(submit 対象になりうるもの)の reviewDetail を見る。
    const versions = await listVersions(api, appId, 50);
    const editableStates = new Set([
      'PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'METADATA_REJECTED',
      'REJECTED', 'INVALID_BINARY', 'WAITING_FOR_REVIEW',
    ]);
    const target =
      versions.find((v) => v.platform === 'IOS' && editableStates.has(v.appStoreState)) ||
      versions.find((v) => v.platform === 'IOS') ||
      null;
    if (!target) return R('ok', '比較対象の appStoreVersion が無い(初回提出前など)');
    const detail = await getReviewDetail(api, target.id);
    const ascUser = detail?.attributes?.demoAccountName != null
      ? String(detail.attributes.demoAccountName).trim()
      : null;
    if (ascUser && ascUser !== envUser) {
      return R('warn',
        `ASC 側 demoAccountName が env と不一致。次回 submit で env 値が上書きするが、` +
        `今の食い違いは「却下対応してもログインできない」の手がかり: ASC="${ascUser}" env="${envUser}"`);
    }
    return R('ok', 'ASC 側 demoAccountName は env と一致(または未設定)');
  } catch (e) {
    return R('warn', `reviewDetail を確認できなかった(手動確認を): ${e.message}`);
  }
}

// --- B7: contentRightsDeclaration -------------------------------------------
// 未設定だと初回 submit が 409 ENTITY_ERROR.ATTRIBUTE.REQUIRED になる。blocking。
async function checkContentRightsDeclared(api, appId) {
  try {
    const r = await api('GET', `/v1/apps/${appId}?fields[apps]=contentRightsDeclaration`);
    const decl = r?.data?.attributes?.contentRightsDeclaration;
    if (!decl) {
      return R('fail', 'contentRightsDeclaration が未設定。node scripts/asc-set-content-rights.mjs を実行して宣言する(B7)');
    }
    return R('ok', `contentRightsDeclaration = ${decl}`);
  } catch (e) {
    return R('warn', `contentRightsDeclaration を確認できなかった(手動確認を): ${e.message}`);
  }
}

// --- B8: App プライバシー「公開」------------------------------------------------
// ASC UI で「アプリのプライバシー」の右上「公開」を押さないと、保存だけでは審査に出せない。
// ⚠️ 重要(appstore-submit.mjs ensurePrivacy で実証済み): App Privacy の dataUsage 系は
//    標準 JWT API(api.appstoreconnect.apple.com/v1)には無く、iris API + web セッション
//    cookie でしか認証できない。このスクリプトの API キー(JWT)では **どのベースでも
//    401/404 になり、公開状態を API から読めないのが正常**。よって:
//      - 読めない = 「未公開」ではない → fail にしない(false fail を出さない)。
//      - 読めて published=false のときだけ fail(実際に未公開)。
//    そもそも submit 時に ensurePrivacy が公開を試みる二段構え。ここは「早期に気づく」補助。
// 経路/ベースは submit の ensurePrivacy と同一にして挙動を揃える(dataUsagePublishState は単数)。
async function checkAppPrivacyPublished(api, appId) {
  const BASES = [
    'https://api.appstoreconnect.apple.com/v1',
    'https://appstoreconnect.apple.com/iris/v1',
    'https://api.appstoreconnect.apple.com/iris/v1',
  ];
  for (const base of BASES) {
    try {
      const ps = await api('GET', `${base}/apps/${appId}/dataUsagePublishState`);
      const published = ps?.data?.attributes?.published;
      if (published === true) return R('ok', 'App プライバシーは公開済み');
      if (published === false) {
        return R('fail', 'App プライバシーが未公開。ASC UI「アプリのプライバシー」→ 右上「公開」を押す(保存だけでは不可)。submit 時に ensurePrivacy も公開を試みる(B8)');
      }
      // 200 だが published が boolean でない(形状差異)。誤爆を避け warn。
      return R('warn', 'App プライバシーの公開状態を判定できなかった(形状差異)。ASC UI で「公開」済みか手動確認を(B8)');
    } catch {
      // このベースは 401/404。次のベースを試す。
    }
  }
  // 全ベースで読めない = JWT では確認不可(想定どおり)。fail にせず、手動/submit 任せである旨を warn。
  return R('warn', 'App プライバシーの公開状態は JWT API では確認できません(iris は web セッション専用＝想定どおり)。ASC UI で「公開」済みか確認。未公開なら submit が APP_DATA_USAGES_REQUIRED で弾く(B8)');
}

// --- 配信地域 -----------------------------------------------------------------
// 0 件だと審査に通っても実機 DL できない。appstore-submit.mjs [7b2] で
// ensureAllTerritoriesAvailable による自動修復が入っているため、ここは
// submit を経由しない経路(手動確認・過去バージョンの検証等)向けの検知として残す。
// v1 availableTerritories は deprecated。v2 appAvailabilities → territoryAvailabilities を辿る。
async function checkTerritoriesConfigured(api, appId) {
  try {
    const avail = await api('GET', `/v1/apps/${appId}/appAvailabilityV2`);
    const availId = avail?.data?.id;
    if (!availId) {
      return R('warn', '配信地域(appAvailability)を取得できなかった。ASC UI「価格および配信状況」で地域設定を確認');
    }
    // territoryAvailabilities は件数が多いので存在確認だけ（limit=1 で 1 件でもあれば設定済みとみなす）。
    const terr = await api('GET', `/v2/appAvailabilities/${availId}/territoryAvailabilities?limit=1`);
    const count = (terr?.data || []).length;
    if (count === 0) {
      return R('warn', '配信地域が0件。次回 appstore-submit.mjs 実行で自動設定されるが、急ぐ場合はASC UI「価格および配信状況」→「すべての国または地域」を選択(反映まで最大24h)');
    }
    return R('ok', '配信地域が設定済み');
  } catch (e) {
    return R('warn', `配信地域を確認できなかった(手動確認を): ${e.message}`);
  }
}
