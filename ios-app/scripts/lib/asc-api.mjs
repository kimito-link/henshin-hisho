// 移植元: partnership_program_website/scripts/lib/asc-api.mjs
//        (Exosome/scripts/lib/asc-api.mjs と同一内容)
//
// App Store Connect API ヘルパ(ES256 JWT 認証 / fetch ベース REST)。
// ローカル CLI(appstore-submit.mjs)と CI ワークフロー両方で使う。
// アプリ固有値は持たない。認証は env、対象 app は呼び出し側が bundleId で渡す。
// app.config.json を SSOT とする運用のため、このファイル自体は無改変で使える。
import fs from 'node:fs';
import crypto from 'node:crypto';

const HOST = 'https://api.appstoreconnect.apple.com';

function readP8(privateKeyOrPath) {
  if (privateKeyOrPath.includes('BEGIN PRIVATE KEY')) return privateKeyOrPath;
  return fs.readFileSync(privateKeyOrPath, 'utf8');
}

export function makeAscJwt({ keyId, issuerId, privateKey }) {
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: issuerId,
    iat: now,
    exp: now + 1200,
    aud: 'appstoreconnect-v1',
  };
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const sig = crypto.sign(null, Buffer.from(signingInput), {
    key: readP8(privateKey),
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${sig.toString('base64url')}`;
}

export function makeAscClient({ keyId, issuerId, privateKey }) {
  return async function api(method, path, body) {
    const url = path.startsWith('http') ? path : `${HOST}${path}`;
    const init = {
      method,
      headers: {
        Authorization: `Bearer ${makeAscJwt({ keyId, issuerId, privateKey })}`,
        'Content-Type': 'application/json',
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(url, init);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 800)}`);
    }
    return text ? JSON.parse(text) : null;
  };
}

export async function findApp(api, bundleId) {
  const r = await api('GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`);
  return r.data?.[0] || null;
}

export async function listVersions(api, appId, limit = 20) {
  const r = await api('GET', `/v1/apps/${appId}/appStoreVersions?limit=${limit}&fields[appStoreVersions]=versionString,appStoreState,platform,copyright,releaseType`);
  return (r.data || []).map((v) => ({
    id: v.id,
    platform: v.attributes.platform,
    versionString: (v.attributes.versionString || '').trim(),
    appStoreState: v.attributes.appStoreState,
    copyright: v.attributes.copyright,
    releaseType: v.attributes.releaseType,
  }));
}

export async function findVersion(api, appId, platform, versionString) {
  const list = await listVersions(api, appId, 50);
  return list.find((v) => v.platform === platform && v.versionString === versionString) || null;
}

export async function getLocalizations(api, versionId) {
  const r = await api('GET', `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations?fields[appStoreVersionLocalizations]=locale,description,keywords,marketingUrl,supportUrl,promotionalText,whatsNew`);
  return r.data || [];
}

export async function getReviewDetail(api, versionId) {
  try {
    const r = await api('GET', `/v1/appStoreVersions/${versionId}/appStoreReviewDetail?fields[appStoreReviewDetails]=contactFirstName,contactLastName,contactPhone,contactEmail,demoAccountName,demoAccountPassword,demoAccountRequired,notes`);
    return r.data || null;
  } catch (e) {
    if (String(e.message).includes('404')) return null;
    throw e;
  }
}

export async function getLinkedBuild(api, versionId) {
  try {
    const r = await api('GET', `/v1/appStoreVersions/${versionId}/build?fields[builds]=version,uploadedDate,processingState`);
    return r.data || null;
  } catch (e) {
    if (String(e.message).includes('404')) return null;
    throw e;
  }
}

export async function findBuildByVersion(api, appId, marketingVersion, buildNumber) {
  const r = await api(
    'GET',
    `/v1/builds?filter[app]=${appId}&filter[preReleaseVersion.version]=${encodeURIComponent(marketingVersion)}&filter[version]=${encodeURIComponent(buildNumber)}&limit=5&include=preReleaseVersion&fields[builds]=version,uploadedDate,processingState,expired`,
  );
  const b = (r.data || [])[0];
  if (!b) return null;
  const prv = (r.included || []).find((i) => i.id === b.relationships?.preReleaseVersion?.data?.id);
  return {
    id: b.id,
    buildNumber: b.attributes.version,
    marketingVersion: prv?.attributes?.version || marketingVersion,
    processingState: b.attributes.processingState,
    uploadedDate: b.attributes.uploadedDate,
    expired: b.attributes.expired,
  };
}

export async function listRecentBuilds(api, appId, limit = 10) {
  const r = await api(
    'GET',
    `/v1/builds?filter[app]=${appId}&limit=${limit}&include=preReleaseVersion&fields[builds]=version,uploadedDate,processingState,expired`,
  );
  return (r.data || []).map((b) => {
    const prv = (r.included || []).find((i) => i.id === b.relationships?.preReleaseVersion?.data?.id);
    return {
      id: b.id,
      buildNumber: b.attributes.version,
      marketingVersion: prv?.attributes?.version || null,
      processingState: b.attributes.processingState,
      uploadedDate: b.attributes.uploadedDate,
      expired: b.attributes.expired,
    };
  });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
