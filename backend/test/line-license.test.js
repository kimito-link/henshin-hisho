import assert from 'node:assert/strict';
import worker from '../src/index.js';

let pass = 0;
let fail = 0;

async function test(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    fail += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

function createMemoryKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = '' } = {}) {
      return {
        keys: [...store.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((name) => ({ name }))
      };
    }
  };
}

function createEnv(initial = {}) {
  return {
    APP_KV: createMemoryKv(initial),
    SESSION_SECRET: 'test_session_secret_that_is_long_enough',
    APP_ALLOWED_ORIGIN: 'https://henshin-hisho.link',
    LINE_CHANNEL_SECRET: 'line_secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'line_access_token',
    GMAIL_CONNECT_ENABLED: 'false',
    LICENSE_VERIFY_URL: 'https://license.example.test/verify'
  };
}

function jsonRequest(method, path, body, token = '') {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`https://app.example.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function signup(env, email = 'line@example.com') {
  const response = await worker.fetch(jsonRequest('POST', '/auth/signup', {
    email,
    password: 'password123'
  }), env);
  const json = await response.json();
  const userId = await env.APP_KV.get(`email-index:${email}`);
  return { token: json.token, userId };
}

function base64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

async function lineSignature(secret, rawBody) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return base64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))));
}

async function lineWebhookRequest(body, secret = 'line_secret') {
  const rawBody = JSON.stringify(body);
  return new Request('https://app.example.test/connectors/line/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-line-signature': await lineSignature(secret, rawBody)
    },
    body: rawBody
  });
}

async function withMockFetch(responseFactory, fn) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const call = {
      url: String(url),
      options,
      body: options.body ? JSON.parse(options.body) : null
    };
    calls.push(call);
    const response = typeof responseFactory === 'function'
      ? responseFactory(call, calls.length)
      : responseFactory;
    return new Response(JSON.stringify(response?.body || response || {}), {
      status: response?.status || 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

await test('LINE webhook rejects invalid signature', async () => {
  const env = createEnv();
  const response = await worker.fetch(new Request('https://app.example.test/connectors/line/webhook', {
    method: 'POST',
    headers: { 'x-line-signature': 'invalid' },
    body: JSON.stringify({ events: [] })
  }), env);
  assert.equal(response.status, 401);
});

await test('LINE webhook stores text message in the common inbox schema', async () => {
  const env = createEnv();
  const { token, userId } = await signup(env);
  await env.APP_KV.put('line-user:U123', userId);

  const body = {
    events: [{
      type: 'message',
      replyToken: 'reply_1',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U123' },
      message: { id: 'msg_1', type: 'text', text: '請求について確認したいです。' }
    }]
  };
  const response = await worker.fetch(await lineWebhookRequest(body), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, stored: 1 });

  const inbox = await worker.fetch(jsonRequest('GET', '/inbox', undefined, token), env);
  const json = await inbox.json();
  assert.equal(json.items.length, 1);
  assert.equal(json.items[0].channel, 'line');
  assert.equal(json.items[0].sourceMeta.lineUserId, 'U123');
});

await test('LINE send requires risk confirmation and explicit human send action', async () => {
  await withMockFetch({ status: 200, body: {} }, async (calls) => {
    const env = createEnv();
    const { token, userId } = await signup(env);
    const item = {
      id: 'line_item_1',
      channel: 'line',
      externalId: 'msg_1',
      from: { externalUserId: 'U123' },
      subject: 'LINEメッセージ',
      body: '契約解除について',
      excerpt: '契約解除について',
      receivedAt: Date.now(),
      status: 'needs_human_review',
      riskLevel: 'high',
      riskConfirmed: false,
      triage: { riskLevel: 'high', requiresHumanApproval: true },
      draft: { body: '確認のうえ改めてご連絡いたします。' },
      sourceMeta: { lineUserId: 'U123' },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await env.APP_KV.put(`inbox:${userId}:line_item_1`, JSON.stringify(item));

    const blocked = await worker.fetch(jsonRequest('POST', '/inbox/line_item_1/send', {
      confirmSend: true
    }, token), env);
    assert.equal(blocked.status, 409);
    assert.deepEqual(await blocked.json(), { ok: false, reason: 'risk_confirmation_required' });

    item.riskConfirmed = true;
    await env.APP_KV.put(`inbox:${userId}:line_item_1`, JSON.stringify(item));
    const missingConfirm = await worker.fetch(jsonRequest('POST', '/inbox/line_item_1/send', {}, token), env);
    assert.equal(missingConfirm.status, 400);
    assert.deepEqual(await missingConfirm.json(), { ok: false, reason: 'explicit_send_confirmation_required' });

    const sent = await worker.fetch(jsonRequest('POST', '/inbox/line_item_1/send', {
      confirmSend: true
    }, token), env);
    assert.equal(sent.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.line.me/v2/bot/message/push');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer line_access_token');
    assert.equal(calls[0].body.to, 'U123');
  });
});

await test('Gmail connector stays disabled while feature flag is false', async () => {
  const env = createEnv();
  const { token } = await signup(env, 'gmail-stub@example.com');
  const response = await worker.fetch(jsonRequest('POST', '/connectors/gmail/connect', {}, token), env);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, reason: 'gmail_connect_disabled' });
});

await test('extension license key links active plan to PWA account', async () => {
  await withMockFetch({
    status: 200,
    body: { ok: true, status: 'active', currentPeriodEnd: 2000000000 }
  }, async (calls) => {
    const env = createEnv();
    const { token, userId } = await signup(env, 'license@example.com');
    const response = await worker.fetch(jsonRequest('POST', '/account/link-license', {
      licenseKey: 'gs_test_license'
    }, token), env);
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.account.plan, 'active');
    const user = JSON.parse(await env.APP_KV.get(`users:${userId}`));
    assert.equal(user.licenseKey, 'gs_test_license');
    assert.equal(calls[0].url, 'https://license.example.test/verify');
  });
});

console.log(`\nline-license.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
