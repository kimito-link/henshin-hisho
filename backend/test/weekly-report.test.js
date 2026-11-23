import assert from 'node:assert/strict';
import worker from '../src/index.js';

let pass = 0;
let fail = 0;

const MONDAY_EIGHT_JST = Date.parse('2026-07-05T23:00:00.000Z');
const WEEKLY_SUBJECT = '【AI返信秘書】今週の成果レポート';
const WEEKLY_COPY = /今週の成果レポート|今週は危険な返信はありませんでした|危ない返信を|返信漏れ防止|週次レポートを見る|推定損失回避額/;

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
    MAIL_FROM: 'AI返信秘書 <no-reply@example.test>',
    RESEND_API_KEY: 're_test_key'
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

function installMailTrap() {
  const sent = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (!target.startsWith('https://api.resend.com/')) {
      throw new Error(`unexpected_network:${target}`);
    }
    sent.push({ url: target, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ id: 'mail_test' }), { status: 200 });
  };
  return {
    sent,
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}

function assertNoWeeklyMail(sent) {
  for (const mail of sent) {
    assert.doesNotMatch(mail.body.subject || '', WEEKLY_COPY);
    assert.doesNotMatch(mail.body.text || '', WEEKLY_COPY);
    assert.notEqual(mail.body.subject, WEEKLY_SUBJECT);
  }
}

async function signup(env, email) {
  const response = await worker.fetch(request('POST', '/auth/signup', {
    email,
    password: 'password123'
  }), env);
  const json = await response.json();
  assert.equal(response.status, 200);
  const userId = await env.APP_KV.get(`email-index:${email}`);
  return { token: json.token, userId };
}

async function putUser(env, user) {
  await env.APP_KV.put(`users:${user.id}`, JSON.stringify(user));
}

function legacyUser(overrides = {}) {
  return {
    id: overrides.id,
    email: overrides.email,
    digest: { enabled: false, hour: 8, timezone: 'Asia/Tokyo', channel: 'email' },
    weeklyReport: { enabled: true },
    avgCaseValue: 0,
    ...overrides
  };
}

await test('weekly report generator module is gone', async () => {
  await assert.rejects(() => import('../src/weekly-report.js'), /Cannot find module|ERR_MODULE_NOT_FOUND/);
});

await test('scheduled cron does not mail a non-zero weekly report for a legacy enabled user', async () => {
  const trap = installMailTrap();
  try {
    const env = createEnv();
    const user = legacyUser({
      id: 'user_nonzero',
      email: 'nonzero@example.com',
      avgCaseValue: 50000
    });
    await putUser(env, user);
    await env.APP_KV.put(`inbox:${user.id}:risk`, JSON.stringify({
      id: 'risk',
      receivedAt: MONDAY_EIGHT_JST - 60 * 60 * 1000,
      status: 'draft_ready',
      riskLevel: 'high',
      riskConfirmed: true,
      triage: {
        category: 'legal',
        suggestedAction: 'needs_manual_review',
        riskLevel: 'high',
        requiresHumanApproval: true
      },
      draft: { body: '確認します。' }
    }));
    await worker.scheduled({ scheduledTime: MONDAY_EIGHT_JST }, env);
    assert.equal(trap.sent.length, 0);
    assertNoWeeklyMail(trap.sent);
  } finally {
    trap.restore();
  }
});

await test('scheduled cron does not mail the zero-count weekly report', async () => {
  const trap = installMailTrap();
  try {
    const env = createEnv();
    await putUser(env, legacyUser({
      id: 'user_zero',
      email: 'zero@example.com',
      weeklyReport: { enabled: true },
      avgCaseValue: 0
    }));
    await worker.scheduled({ scheduledTime: MONDAY_EIGHT_JST }, env);
    assert.equal(trap.sent.length, 0);
    assertNoWeeklyMail(trap.sent);
  } finally {
    trap.restore();
  }
});

await test('scheduled cron still sends the daily digest and never the weekly report', async () => {
  const trap = installMailTrap();
  try {
    const env = createEnv();
    const { userId } = await signup(env, 'digest@example.com');
    const stored = JSON.parse(await env.APP_KV.get(`users:${userId}`));
    stored.weeklyReport = { enabled: true };
    stored.avgCaseValue = 80000;
    await putUser(env, stored);
    await env.APP_KV.put(`inbox:${userId}:today`, JSON.stringify({
      id: 'today',
      status: 'triaged',
      receivedAt: Date.parse('2026-07-06T00:30:00.000Z'),
      riskLevel: 'low',
      triage: {
        category: 'reply_needed',
        priority: 'normal',
        suggestedAction: 'create_draft',
        riskLevel: 'low',
        requiresHumanApproval: false
      }
    }));
    await worker.scheduled({ scheduledTime: MONDAY_EIGHT_JST }, env);
    assert.equal(trap.sent.length, 1);
    assert.match(trap.sent[0].body.subject, /本日の要対応ダイジェスト/);
    assertNoWeeklyMail(trap.sent);
  } finally {
    trap.restore();
  }
});

await test('legacy weekly report route does not generate or send the report', async () => {
  const trap = installMailTrap();
  try {
    const env = createEnv();
    const { token, userId } = await signup(env, 'legacy-get@example.com');
    const stored = JSON.parse(await env.APP_KV.get(`users:${userId}`));
    stored.weeklyReport = { enabled: true };
    await putUser(env, stored);
    const response = await worker.fetch(request('GET', '/report/weekly', undefined, token), env);
    const body = await response.text();
    assert.equal(response.status, 404);
    assert.doesNotMatch(body, WEEKLY_COPY);
    assert.equal(trap.sent.length, 0);
  } finally {
    trap.restore();
  }
});

await test('legacy report settings route does not enable sending or persist a weekly preference', async () => {
  const trap = installMailTrap();
  try {
    const env = createEnv();
    const { token, userId } = await signup(env, 'legacy-post@example.com');
    const before = await env.APP_KV.get(`users:${userId}`);
    const response = await worker.fetch(request('POST', '/account/report-settings', {
      enabled: true,
      avgCaseValue: 120000
    }, token), env);
    const body = await response.text();
    assert.equal(response.status, 404);
    assert.doesNotMatch(body, WEEKLY_COPY);
    assert.equal(await env.APP_KV.get(`users:${userId}`), before);
    assert.equal(trap.sent.length, 0);
    await worker.scheduled({ scheduledTime: MONDAY_EIGHT_JST }, env);
    assert.equal(trap.sent.length, 0);
    assertNoWeeklyMail(trap.sent);
  } finally {
    trap.restore();
  }
});

await test('account settings omit weekly report configuration', async () => {
  const env = createEnv();
  const { token, userId } = await signup(env, 'account@example.com');
  const stored = JSON.parse(await env.APP_KV.get(`users:${userId}`));
  assert.equal(Object.hasOwn(stored, 'weeklyReport'), false);
  assert.equal(Object.hasOwn(stored, 'avgCaseValue'), false);
  const response = await worker.fetch(request('GET', '/account', undefined, token), env);
  const json = await response.json();
  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn(json.settings, 'weeklyReport'), false);
  assert.equal(Object.hasOwn(json.settings, 'avgCaseValue'), false);
  assert.equal(json.settings.digest.enabled, true);
  assert.equal(typeof json.settings.accountPolicy, 'object');
});

await test('magic link mail still sends and is not a weekly report', async () => {
  const trap = installMailTrap();
  try {
    const env = createEnv();
    await signup(env, 'magic@example.com');
    const response = await worker.fetch(request('POST', '/auth/magic-link', {
      email: 'magic@example.com'
    }), env);
    const json = await response.json();
    assert.equal(response.status, 200);
    assert.equal(json.mailed, true);
    assert.equal(trap.sent.length, 1);
    assert.match(trap.sent[0].body.subject, /ログインリンク/);
    assertNoWeeklyMail(trap.sent);
  } finally {
    trap.restore();
  }
});

console.log(`\nweekly-report.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
