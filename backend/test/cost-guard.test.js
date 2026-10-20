// 原価ガードの効き目を「上限を小さくした環境で実際に拒否されること」で確かめる（COST_SAFETY_POLICY §4）。
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { costGuard, estimateCallMilli } from '../src/cost-guard.js';
import { callOpenRouter, MAX_PROMPT_CHARS } from '../src/llm.js';
import { prepareAssist } from '../src/projects/assist.js';
import { createFakeD1 } from './fake-d1.js';

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

function createMemoryKv() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix = '' } = {}) {
      return { keys: [...store.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })) };
    }
  };
}

function createEnv(overrides = {}) {
  return {
    APP_KV: createMemoryKv(),
    PROJECT_DB: createFakeD1(),
    SESSION_SECRET: 'test_session_secret_that_is_long_enough',
    APP_ALLOWED_ORIGIN: 'https://henshin-hisho.link',
    OPENROUTER_API_KEY: 'sk-or-v1_test',
    APP_MODEL: 'google/gemma-3-12b-it',
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
  const response = await worker.fetch(request('POST', '/auth/signup', { email: 'cost@example.com', password: 'password123' }), env);
  const json = await response.json();
  return { token: json.token, userId: json.user.id };
}

const TRIAGE_JSON = JSON.stringify({
  category: 'reply_needed', priority: 'normal', riskLevel: 'low', requiresHumanApproval: false,
  summary: '返信が必要です', detectedTasks: [], suggestedAction: 'create_draft', draftIntent: '返信する', warnings: []
});

async function withMockFetch(fn) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ choices: [{ message: { content: TRIAGE_JSON } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function assess(env, token) {
  return worker.fetch(request('POST', '/inbox/assess', { channel: 'paste', subject: '確認', body: '確認したいです。' }, token), env);
}

await test('期限切れの試用は 402 plan_expired で止まり、LLM を呼ばない', async () => {
  await withMockFetch(async (calls) => {
    const env = createEnv();
    const { token, userId } = await signup(env);
    const key = `users:${userId}`;
    const user = JSON.parse(env.APP_KV.store.get(key));
    env.APP_KV.store.set(key, JSON.stringify({ ...user, trialEndsAt: 1, plan: 'trial' }));
    const response = await assess(env, token);
    assert.equal(response.status, 402);
    const json = await response.json();
    assert.equal(json.reason, 'plan_expired');
    assert.match(json.message, /月額 2,980円（年額 29,800円）で続けられます/);
    assert.equal(calls.length, 0);
  });
});

await test('TRIAL_AI_CALLS=1 なら2回目は 429 user_quota_exhausted（LLM は1回分しか呼ばない）', async () => {
  await withMockFetch(async (calls) => {
    const env = createEnv({ TRIAL_AI_CALLS: '1' });
    const { token } = await signup(env);
    assert.equal((await assess(env, token)).status, 200);
    const callsAfterFirst = calls.length;
    const second = await assess(env, token);
    assert.equal(second.status, 429);
    const json = await second.json();
    assert.equal(json.reason, 'user_quota_exhausted');
    assert.equal(json.limit, 1);
    assert.match(json.message, /試用のAI利用回数（1回）を使い切りました。月額 2,980円（年額 29,800円）で続けられます/);
    assert.equal(calls.length, callsAfterFirst);
  });
});

await test('LLM_DAILY_BUDGET_MILLI=1 なら判定(2回分の予約)は 429 daily_budget_exhausted、利用者の1回は戻る', async () => {
  await withMockFetch(async (calls) => {
    const env = createEnv({ LLM_DAILY_BUDGET_MILLI: '1' });
    const { token, userId } = await signup(env);
    const response = await assess(env, token);
    assert.equal(response.status, 429);
    assert.equal((await response.json()).reason, 'daily_budget_exhausted');
    assert.equal(calls.length, 0);
    assert.equal(env.PROJECT_DB.counters.get(`user:${userId}:trial`), 0);
  });
});

await test('カウンタ(D1)が無ければ 503 cost_guard_unavailable（fail-closed）', async () => {
  await withMockFetch(async (calls) => {
    const env = createEnv({ PROJECT_DB: undefined });
    const { token } = await signup(env);
    const response = await assess(env, token);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).reason, 'cost_guard_unavailable');
    assert.equal(calls.length, 0);
  });
});

await test('D1 が失敗したら 503（fail-closed）', async () => {
  await withMockFetch(async (calls) => {
    const env = createEnv({ PROJECT_DB: { prepare() { throw new Error('d1 down'); } } });
    const { token } = await signup(env);
    const response = await assess(env, token);
    assert.equal(response.status, 503);
    assert.equal(calls.length, 0);
  });
});

await test('上限の env が数値として読めなければ 503（既定値に黙って落とさない）', async () => {
  await withMockFetch(async (calls) => {
    const env = createEnv({ LLM_DAILY_BUDGET_MILLI: '3ドル' });
    const { token } = await signup(env);
    const response = await assess(env, token);
    assert.equal(response.status, 503);
    assert.equal(calls.length, 0);
  });
});

await test('PAID_CALLS_DISABLED=1 で全停止（503 ai_paused）', async () => {
  await withMockFetch(async (calls) => {
    const env = createEnv({ PAID_CALLS_DISABLED: '1' });
    const { token } = await signup(env);
    const response = await assess(env, token);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).reason, 'ai_paused');
    assert.equal(calls.length, 0);
  });
});

await test('有料プランは月ごとのカウンタ。ACTIVE_MONTHLY_AI_CALLS=0 なら拒否', async () => {
  const env = createEnv({ ACTIVE_MONTHLY_AI_CALLS: '0' });
  const user = { id: 'user_a', plan: 'active', trialEndsAt: 0 };
  const nowMs = Date.parse('2026-10-19T00:00:00Z');
  const result = await costGuard(env, user, { estimateMilli: 1, nowMs });
  assert.equal(result.ok, false);
  assert.equal(result.status, 429);
  assert.match(result.body.message, /今月/);
  const ok = await costGuard(createEnv(), user, { estimateMilli: 1, nowMs });
  assert.equal(ok.ok, true);
  assert.equal(ok.reservation.userKey, 'user:user_a:active:2026-10');
});

await test('同時に来ても上限を超えて通らない（積んでから判定・超えたら戻す）', async () => {
  const env = createEnv({ LLM_PAID_DAILY_BUDGET_MILLI: '5' });
  const users = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `u${n}`, plan: 'active' }));
  const results = await Promise.all(users.map((user) => costGuard(env, user, { estimateMilli: 2 })));
  assert.equal(results.filter((r) => r.ok).length, 2);
});

await test('試用の予算を使い切っても有料プランは止まらない（プールが別）', async () => {
  const env = createEnv({ LLM_DAILY_BUDGET_MILLI: '0' });
  const trial = await costGuard(env, { id: 't1', trialEndsAt: Math.floor(Date.now() / 1000) + 3600 }, { estimateMilli: 1 });
  assert.equal(trial.ok, false);
  assert.equal(trial.body.reason, 'daily_budget_exhausted');
  const paid = await costGuard(env, { id: 'p1', plan: 'active' }, { estimateMilli: 1 });
  assert.equal(paid.ok, true);
  assert.match(paid.reservation.budgetKey, /^budget:llm:paid:/);
});

await test('表に無い高いモデルは最上位の価格で見積もる（APP_MODEL を変えても黙って回らない）', () => {
  const cheap = estimateCallMilli({ model: 'google/gemma-3-12b-it', promptChars: 20000, maxTokens: 1500 });
  const unknown = estimateCallMilli({ model: 'some/expensive-model', promptChars: 20000, maxTokens: 1500 });
  assert.ok(unknown >= cheap * 100, `${unknown} vs ${cheap}`);
});

await test('callOpenRouter は予約なしでは fetch せずに断る', async () => {
  let fetched = false;
  await assert.rejects(
    callOpenRouter(createEnv(), { userPrompt: 'x' }, { fetchImpl: async () => { fetched = true; } }),
    /cost_guard_required/
  );
  assert.equal(fetched, false);
});

await test('callOpenRouter はタイムアウトの signal を付けて呼ぶ・長すぎるプロンプトは断る', async () => {
  let seen = null;
  const fetchImpl = async (url, options) => {
    seen = options;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  };
  const reservation = { budgetKey: 'budget:llm:test' };
  assert.equal(await callOpenRouter(createEnv(), { userPrompt: 'x' }, { fetchImpl, reservation }), 'ok');
  assert.ok(seen.signal instanceof AbortSignal);
  await assert.rejects(
    callOpenRouter(createEnv(), { userPrompt: 'x'.repeat(MAX_PROMPT_CHARS + 1) }, { fetchImpl, reservation }),
    /prompt_too_long/
  );
});

await test('prepareAssist は上限字数に収まるまで古い発言を落とし、落とした件数を返す', () => {
  const allMessages = Array.from({ length: 200 }, (_, i) => ({
    sent_at: Date.parse('2026-10-01T00:00:00Z') - i * 60000,
    channel_source: 'chatwork',
    sender_role: 'customer',
    sender_display_name: '顧客',
    visibility: i % 2 ? 'public' : 'internal',
    body: 'あ'.repeat(5000)
  }));
  const prepared = prepareAssist({ project: { name: 'p' }, channels: [], allMessages, mode: 'status' });
  assert.ok(prepared.userPrompt.length <= MAX_PROMPT_CHARS);
  assert.ok(prepared.omittedCount > 0);
  assert.ok(!prepared.userPrompt.includes('あ'.repeat(1501)), '1発言は上限字数で切る');
  // leak-guard の照合材料は落とさない
  assert.equal(prepared.publicMessages.length + prepared.internalMessages.length, 200);
});

console.log(`\ncost-guard.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
