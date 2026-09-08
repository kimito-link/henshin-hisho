// 移植元: partnership_program_website/scripts/lib/play-api.mjs
//        (Exosome/scripts/lib/play-api.mjs と同一内容)
//
// Google Play Developer API ヘルパ(RS256 service-account JWT → OAuth2 token 交換)。
// ローカル CLI と CI ワークフロー両方で使う。
// アプリ固有値は持たない。packageName は呼び出し側(app.config.json 由来)が渡す。
// app.config.json を SSOT とする運用のため、このファイル自体は無改変で使える。
import fs from 'node:fs';
import crypto from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
// 2026-09-08 追加: 売上ダッシュボードがインストール数CSVをCloud Storageから読むのに要る scope。
// androidpublisher と別トークンが要る(1トークンに複数scopeを含めることも可能だが、
// 既存呼び出しへの影響を避けるため呼び出し側で明示的に選ぶ設計にする)。
export const STORAGE_READONLY_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';

export function loadServiceAccount() {
  const direct = process.env.GOOGLE_PLAY_SA_JSON;
  if (direct) {
    return JSON.parse(direct);
  }
  const filePath = process.env.GOOGLE_PLAY_SA_JSON_PATH;
  if (filePath && fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  const b64 = process.env.GOOGLE_PLAY_SA_JSON_BASE64;
  if (b64) {
    return JSON.parse(Buffer.from(b64.trim(), 'base64').toString('utf8'));
  }
  throw new Error('Provide GOOGLE_PLAY_SA_JSON_PATH, _BASE64, or _JSON env');
}

function makeJwt(sa, scope = SCOPE) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(signingInput), sa.private_key);
  return `${signingInput}.${sig.toString('base64url')}`;
}

// 2026-09-08: scopeごとにキャッシュを分ける(単一 _cachedToken のままscopeを混ぜると
// 別scopeのトークンを誤って返す。設計B-6で指摘された地雷)。
const _cachedTokensByScope = new Map();

export async function getAccessToken(sa, scope = SCOPE) {
  const cached = _cachedTokensByScope.get(scope);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }
  const jwt = makeJwt(sa, scope);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OAuth2 token exchange failed: ${res.status} ${text}`);
  const j = JSON.parse(text);
  _cachedTokensByScope.set(scope, {
    token: j.access_token,
    expiresAt: Date.now() + j.expires_in * 1000,
  });
  return j.access_token;
}

export function makePlayClient(sa, packageName) {
  return async function api(method, urlOrPath, body, contentType = 'application/json') {
    const token = await getAccessToken(sa);
    const url = urlOrPath.startsWith('http')
      ? urlOrPath
      : `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}${urlOrPath}`;
    const init = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };
    if (body !== undefined) {
      if (contentType === 'application/json') {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      } else {
        init.headers['Content-Type'] = contentType;
        init.body = body;
      }
    }
    const res = await fetch(url, init);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${method} ${urlOrPath} -> ${res.status}: ${text.slice(0, 800)}`);
    }
    return text ? JSON.parse(text) : null;
  };
}

export async function uploadBundle(sa, packageName, editId, aabPath) {
  const token = await getAccessToken(sa);
  const stat = fs.statSync(aabPath);
  const url = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${packageName}/edits/${editId}/bundles?uploadType=media`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(stat.size),
    },
    body: fs.createReadStream(aabPath),
    duplex: 'half',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`uploadBundle failed: ${res.status} ${text.slice(0, 800)}`);
  return JSON.parse(text);
}

function contentTypeForImage(filePath) {
  const ext = filePath.toLowerCase().split('.').pop();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return 'application/octet-stream';
}

export async function uploadListingImage(sa, packageName, editId, language, imageType, imagePath) {
  const token = await getAccessToken(sa);
  const stat = fs.statSync(imagePath);
  const enc = encodeURIComponent;
  const url =
    'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/' +
    `${enc(packageName)}/edits/${enc(editId)}/listings/${enc(language)}/${enc(imageType)}?uploadType=media`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentTypeForImage(imagePath),
      'Content-Length': String(stat.size),
    },
    body: fs.createReadStream(imagePath),
    duplex: 'half',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`uploadListingImage ${imageType} failed: ${res.status} ${text.slice(0, 800)}`);
  return JSON.parse(text);
}

// 2026-09-08 追加: 売上ダッシュボード用。Play Developer Reporting APIにインストール数は
// 無い(vitals/crash専用)ため、Play Consoleが自動配置するCloud Storageバケットの
// CSVを直接読む(設計F7)。gsutil不要、Storage JSON APIをfetch直叩き。
export async function listInstallReportObjects(sa, bucket, packageName) {
  const token = await getAccessToken(sa, STORAGE_READONLY_SCOPE);
  const prefix = encodeURIComponent(`stats/installs/installs_${packageName}_`);
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?prefix=${prefix}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`listInstallReportObjects -> ${res.status}: ${text.slice(0, 800)}`);
  const j = JSON.parse(text);
  return (j.items || []).map((o) => o.name);
}

// CSVは UTF-16LE + BOM で返る(設計D-2の地雷)。UTF-8のつもりで読むと列名が化ける。
export async function fetchInstallReportCsv(sa, bucket, objectName) {
  const token = await getAccessToken(sa, STORAGE_READONLY_SCOPE);
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fetchInstallReportCsv(${objectName}) -> ${res.status}: ${text.slice(0, 800)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('utf16le').replace(/^﻿/, '');
}
