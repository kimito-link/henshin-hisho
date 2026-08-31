import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {
  aggregateDailyDigest,
  buildDigestEmailText,
  createDigestUnsubscribeToken,
  currentHourInTimezone,
  runDigestSchedule
} from '../src/digest.js';
import { savePushSubscription } from '../src/push.js';

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
    APP_BASE_URL: 'https://henshin-hisho.link/app/',
    APP_WORKER_BASE_URL: 'https://henshin-hisho-app.info-a40.workers.dev',
    MAIL_FROM: 'AI返信秘書 <no-reply@henshin-hisho.link>',
    RESEND_API_KEY: 're_test_key'
  };
}

function item(overrides = {}) {
  return {
    id: overrides.id || `item_${Math.random()}`,
    status: 'triaged',
    receivedAt: Date.parse('2026-07-06T00:30:00.000Z'),
    triage: {
      category: 'reply_needed',
      priority: 'normal',
      suggestedAction: 'create_draft',
      riskLevel: 'low',
      requiresHumanApproval: false
    },
    riskLevel: 'low',
    ...overrides
  };
}

function request(method, path, body, token = '') {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`https://app.example.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function signup(env) {
  const response = await worker.fetch(request('POST', '/auth/signup', {
    email: 'digest@example.com',
    password: 'password123'
  }), env);
  const json = await response.json();
  const userId = await env.APP_KV.get('email-index:digest@example.com');
  return { token: json.token, userId };
}

await test('daily digest aggregates only today unhandled inbox items', async () => {
  const summary = aggregateDailyDigest([
    item({ id: 'reply' }),
    item({ id: 'risk', riskLevel: 'high', triage: { riskLevel: 'high', requiresHumanApproval: true, priority: 'normal', category: 'legal', suggestedAction: 'needs_manual_review' } }),
    item({ id: 'urgent', triage: { priority: 'urgent', category: 'support', suggestedAction: 'create_draft', riskLevel: 'low' } }),
    item({ id: 'later', triage: { priority: 'normal', category: 'fyi', suggestedAction: 'snooze', riskLevel: 'low' } }),
    item({ id: 'sent', status: 'sent' }),
    item({ id: 'old', receivedAt: Date.parse('2026-07-04T00:30:00.000Z') })
  ], {
    now: Date.parse('2026-07-06T01:00:00.000Z'),
    timezone: 'Asia/Tokyo'
  });
  assert.equal(summary.total, 4);
  assert.equal(summary.needsReply, 2);
  assert.equal(summary.highRisk, 1);
  assert.equal(summary.urgent, 1);
  assert.equal(summary.later, 1);
});

await test('zero digest copy is positive', async () => {
  const text = buildDigestEmailText({ total: 0, needsReply: 0, highRisk: 0, urgent: 0, later: 0 });
  assert.match(text, /今日はすべて対応済みです/);
});

await test('timezone hour matching uses user timezone', async () => {
  assert.equal(currentHourInTimezone(Date.parse('2026-07-05T23:00:00.000Z'), 'Asia/Tokyo'), 8);
  assert.equal(currentHourInTimezone(Date.parse('2026-07-05T23:00:00.000Z'), 'UTC'), 23);
});

await test('unsubscribe token disables digest without login', async () => {
  const env = createEnv();
  const { userId } = await signup(env);
  const token = await createDigestUnsubscribeToken(env, userId);
  const response = await worker.fetch(new Request(`https://app.example.test/digest/unsubscribe?t=${encodeURIComponent(token)}`, {
    method: 'POST'
  }), env);
  assert.equal(response.status, 200);
  const user = JSON.parse(await env.APP_KV.get(`users:${userId}`));
  assert.equal(user.digest.enabled, false);
});

await test('push subscription is stored by user', async () => {
  const env = createEnv();
  const result = await savePushSubscription(env, 'user_1', {
    endpoint: 'https://push.example.test/1',
    keys: { p256dh: 'p256dh', auth: 'auth' }
  });
  assert.deepEqual(result, { ok: true });
  const saved = JSON.parse(await env.APP_KV.get('push-sub:user_1'));
  assert.equal(saved.platform, 'web-push');
  assert.equal(saved.endpoint, 'https://push.example.test/1');
});

await test('native iOS APNs token is stored by user', async () => {
  const env = createEnv();
  const result = await savePushSubscription(env, 'user_ios', {
    platform: 'ios-apns',
    token: 'abcdef0123456789abcdef0123456789',
    environment: 'sandbox'
  });
  assert.deepEqual(result, { ok: true });
  const saved = JSON.parse(await env.APP_KV.get('push-sub:user_ios'));
  assert.equal(saved.platform, 'ios-apns');
  assert.equal(saved.token, 'abcdef0123456789abcdef0123456789');
  assert.equal(saved.environment, 'sandbox');
});

await test('scheduled digest sends only when digest hour matches and inbox has work', async () => {
  const sent = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    sent.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ id: 'mail_1' }), { status: 200 });
  };
  try {
    const env = createEnv();
    const { userId } = await signup(env);
    await env.APP_KV.put(`inbox:${userId}:item_1`, JSON.stringify(item()));
    const results = await runDigestSchedule(env, { now: Date.parse('2026-07-05T23:00:00.000Z') });
    assert.equal(results.length, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0].body.text, /本日の要返信/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log(`\ndigest.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
