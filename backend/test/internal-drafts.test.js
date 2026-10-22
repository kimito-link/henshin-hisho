import assert from 'node:assert/strict';
import { handleInternalReplyDrafts } from '../src/internal-drafts.js';

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

function memoryKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, String(value));
    }
  };
}

function call(env, { token = 'draft-token', body } = {}) {
  return handleInternalReplyDrafts(
    new Request('https://example.com/internal/reply-drafts', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body || {})
    }),
    env,
    { fetchImpl: () => { throw new Error('llm_should_not_be_called'); } }
  );
}

await test('サービス鍵が違うと下書きを作らない', async () => {
  const response = await call({ INTERNAL_DRAFT_TOKEN: 'draft-token', APP_KV: memoryKv() }, { token: 'nope' });
  assert.equal(response.status, 401);
});

await test('原価ガードが止めれば LLM を呼ばず定型へ戻せる', async () => {
  const user = { id: 'user-1', email: 'owner@example.com', trialEndsAt: Math.floor(Date.now() / 1000) + 86400 };
  const env = {
    INTERNAL_DRAFT_TOKEN: 'draft-token',
    APP_KV: memoryKv({ 'users:user-1': JSON.stringify(user) }),
    OPENROUTER_API_KEY: 'should-not-be-used'
  };
  const response = await call(env, {
    body: { userId: 'user-1', sender: '佐藤', subject: '納期の確認', body: '来週でお願いします。', tones: ['polite'] }
  });
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.reason, 'cost_guard_unavailable');
  assert.equal(payload.ok, false);
});

if (fail > 0) {
  console.error(`${fail} failed`);
  process.exit(1);
}
console.log(`${pass} passed`);
