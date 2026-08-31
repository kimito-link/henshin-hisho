import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { parseTriageContent } from '../src/triage.js';

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
    OPENROUTER_API_KEY: 'sk-or-v1_test',
    APP_MODEL: 'google/gemma-3-12b-it'
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
    email: 'inbox@example.com',
    password: 'password123'
  }), env);
  const json = await response.json();
  return json.token;
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
    return new Response(JSON.stringify(response?.body || response), {
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

function llmBody(content) {
  return { choices: [{ message: { content } }] };
}

function triageContent(overrides = {}) {
  return JSON.stringify({
    category: 'reply_needed',
    priority: 'normal',
    riskLevel: 'low',
    requiresHumanApproval: false,
    summary: '返信が必要な問い合わせです',
    detectedTasks: [],
    suggestedAction: 'create_draft',
    draftIntent: '内容を確認して返信する',
    warnings: [],
    ...overrides
  });
}

await test('parseTriageContent keeps extension-compatible high-risk normalization', async () => {
  const triage = parseTriageContent(triageContent({
    category: 'legal',
    riskLevel: 'low',
    requiresHumanApproval: false
  }));
  assert.equal(triage.riskLevel, 'high');
  assert.equal(triage.requiresHumanApproval, true);
  assert.equal(triage.suggestedAction, 'needs_manual_review');
});

await test('paste assess stores a channel-independent inbox item and returns 9 buckets', async () => {
  await withMockFetch({ body: llmBody(triageContent()) }, async () => {
    const env = createEnv();
    const token = await signup(env);
    const response = await worker.fetch(request('POST', '/inbox/assess', {
      channel: 'paste',
      from: { name: '山田さん', email: 'yamada@example.com' },
      subject: '見積もり確認',
      body: '見積もりについて確認したいです。'
    }, token), env);
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.ok, true);
    assert.equal(json.item.channel, 'paste');
    assert.equal(json.item.triage.category, 'reply_needed');

    const list = await worker.fetch(request('GET', '/inbox', undefined, token), env);
    const listJson = await list.json();
    assert.equal(Object.keys(listJson.buckets).length, 9);
    assert.equal(listJson.buckets.needs_reply.length, 1);
  });
});

await test('high-risk draft is rejected until explicit server-side confirmation', async () => {
  await withMockFetch((call) => {
    const prompt = call.body.messages[0].content;
    if (prompt.includes('返信下書き')) return { body: llmBody('確認のうえ改めてご連絡いたします。') };
    return {
      body: llmBody(triageContent({
        category: 'legal',
        riskLevel: 'high',
        requiresHumanApproval: true,
        summary: '契約と返金に関する高リスク連絡',
        suggestedAction: 'needs_manual_review',
        warnings: ['高リスクカテゴリのため人間確認が必要です']
      }))
    };
  }, async () => {
    const env = createEnv();
    const token = await signup(env);
    const assess = await worker.fetch(request('POST', '/inbox/assess', {
      channel: 'paste',
      subject: '契約と返金について',
      body: '契約解除と返金を約束してください。'
    }, token), env);
    const item = (await assess.json()).item;

    const blocked = await worker.fetch(request('POST', `/inbox/${item.id}/draft`, {
      tone: 'calm',
      intent: '保留で返す'
    }, token), env);
    assert.equal(blocked.status, 409);
    assert.deepEqual(await blocked.json(), { ok: false, reason: 'risk_confirmation_required' });

    const confirmed = await worker.fetch(request('POST', `/inbox/${item.id}/confirm-risk`, {}, token), env);
    assert.equal(confirmed.status, 200);

    const draft = await worker.fetch(request('POST', `/inbox/${item.id}/draft`, {
      tone: 'calm',
      intent: '保留で返す'
    }, token), env);
    assert.equal(draft.status, 200);
    const draftJson = await draft.json();
    assert.equal(draftJson.draft.body, '確認のうえ改めてご連絡いたします。');
    assert.equal(draftJson.item.status, 'draft_ready');
  });
});

await test('broken triage JSON retries once with rescue model', async () => {
  await withMockFetch((call, count) => {
    if (count === 1) return { body: llmBody('not-json') };
    return { body: llmBody(triageContent({ category: 'support', summary: '救済成功' })) };
  }, async (calls) => {
    const env = createEnv();
    const token = await signup(env);
    const response = await worker.fetch(request('POST', '/inbox/assess', {
      channel: 'paste',
      subject: 'サポート依頼',
      body: '使い方を教えてください。'
    }, token), env);
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.item.triage.category, 'support');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.model, 'openai/gpt-4o-mini');
  });
});

console.log(`\ninbox.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
