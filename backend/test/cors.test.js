// CORS: Capacitor ネイティブアプリ(iOS/Android)の WebView オリジンを許可すること。
// 許可しないと、サーバーが200を返しても WebView がレスポンスを破棄し、アプリ内ログインが
// 必ず失敗する(App Store Guideline 2.1「サインインできない」で3回却下された真因)。
import assert from 'node:assert/strict';
import worker from '../src/index.js';

let pass = 0;
let fail = 0;

async function test(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`ok - ${name}`);
  } catch (err) {
    fail += 1;
    console.error(`not ok - ${name}: ${err.message}`);
  }
}

const env = { APP_KV: null }; // OPTIONS は KV に触れない

function preflight(origin) {
  return new Request('https://henshin-hisho-app.info-a40.workers.dev/auth/login', {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
  });
}

async function acaoFor(origin) {
  const res = await worker.fetch(preflight(origin), env, { waitUntil() {} });
  return res.headers.get('Access-Control-Allow-Origin');
}

await test('Web オリジンを許可する', async () => {
  assert.equal(await acaoFor('https://henshin-hisho.link'), 'https://henshin-hisho.link');
});

// ★実機iOSの実Origin。server.iosScheme(既定 "capacitor")が決める。
// capacitor.config.json の ios.scheme は「Xcodeビルドスキーム名」でURLスキームではない
// (誤読して henshinhisho://localhost だけ許可し、4回目の 2.1 却下を生んだ)。
await test('iOS実機(Capacitor既定 capacitor://localhost)のオリジンを許可する', async () => {
  assert.equal(await acaoFor('capacitor://localhost'), 'capacitor://localhost');
});

await test('iOS(将来 server.iosScheme=henshinhisho にした場合)のオリジンを許可する', async () => {
  assert.equal(await acaoFor('henshinhisho://localhost'), 'henshinhisho://localhost');
});

await test('Android(Capacitor 既定 https://localhost)のオリジンを許可する', async () => {
  assert.equal(await acaoFor('https://localhost'), 'https://localhost');
});

await test('未許可オリジンは ACAO を返さない', async () => {
  assert.equal(await acaoFor('https://evil.example.com'), null);
});

await test('APP_ALLOWED_ORIGIN(カンマ区切り)で上書きできる', async () => {
  const custom = { ...env, APP_ALLOWED_ORIGIN: 'https://a.example, https://b.example' };
  const res = await worker.fetch(preflight('https://b.example'), custom, { waitUntil() {} });
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://b.example');
  const res2 = await worker.fetch(preflight('https://henshin-hisho.link'), custom, { waitUntil() {} });
  assert.equal(res2.headers.get('Access-Control-Allow-Origin'), null, '上書き時は既定を含めない');
});

// 回帰: inbox.js が独自の単一オリジン完全一致 jsonResponse を持っていたため、
// APP_ALLOWED_ORIGIN をカンマ区切りにした途端 /inbox 系だけ ACAO が消えた事故の再発防止。
// 未認証の 401 でも CORS ヘッダは付く(付かないと WebView はエラー本文すら読めない)。
await test('/inbox 系レスポンスにも ACAO が付く(iOSオリジン・401でも)', async () => {
  const req = new Request('https://henshin-hisho-app.info-a40.workers.dev/inbox', {
    method: 'GET',
    headers: { Origin: 'henshinhisho://localhost' },
  });
  const res = await worker.fetch(req, env, { waitUntil() {} });
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'henshinhisho://localhost');
});

await test('/inbox 系レスポンスにも ACAO が付く(カンマ区切りenv上書き時)', async () => {
  const custom = { ...env, APP_ALLOWED_ORIGIN: 'https://henshin-hisho.link, henshinhisho://localhost' };
  const req = new Request('https://henshin-hisho-app.info-a40.workers.dev/inbox', {
    method: 'GET',
    headers: { Origin: 'https://henshin-hisho.link' },
  });
  const res = await worker.fetch(req, custom, { waitUntil() {} });
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://henshin-hisho.link');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
