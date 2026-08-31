import assert from 'node:assert/strict';
import {
  DEFAULT_ACCOUNT_POLICY,
  accountPolicyForUser,
  updateAccountPolicy
} from '../src/account-policy.js';
import { buildDraftPrompt, normalizeSecretaryNote } from '../src/draft-gen.js';

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

function createEnv() {
  return { APP_KV: createMemoryKv() };
}

await test('未設定ユーザーは DEFAULT_ACCOUNT_POLICY 相当を返す', () => {
  const policy = accountPolicyForUser({});
  assert.equal(policy.version, DEFAULT_ACCOUNT_POLICY.version);
  assert.equal(policy.discountCeilingPercent, null);
  assert.equal(policy.bundlePolicy, 'none');
});

await test('updateAccountPolicy で保存した discountCeilingPercent が読み戻せる', async () => {
  const env = createEnv();
  const user = { id: 'user_1', email: 'a@example.com' };
  const saved = await updateAccountPolicy(env, user, { discountCeilingPercent: 20 });
  assert.equal(saved.discountCeilingPercent, 20);
  const raw = await env.APP_KV.get('users:user_1');
  const reloaded = JSON.parse(raw);
  assert.equal(accountPolicyForUser(reloaded).discountCeilingPercent, 20);
});

await test('version は保存のたびに +1 される', async () => {
  const env = createEnv();
  const user = { id: 'user_2', email: 'b@example.com' };
  const first = await updateAccountPolicy(env, user, { discountCeilingPercent: 10 });
  assert.equal(first.version, 1);
  const raw = await env.APP_KV.get('users:user_2');
  const reloaded = JSON.parse(raw);
  const second = await updateAccountPolicy(env, reloaded, { discountCeilingPercent: 15 });
  assert.equal(second.version, 2);
});

await test('discountCeilingPercent は 0-100 にクランプされる', async () => {
  const env = createEnv();
  const user = { id: 'user_3', email: 'c@example.com' };
  const saved = await updateAccountPolicy(env, user, { discountCeilingPercent: 150 });
  assert.equal(saved.discountCeilingPercent, 100);
});

await test('updateAccountPolicy は既存の他フィールドを保持する(丸ごと上書きレース対策)', async () => {
  const env = createEnv();
  const user = { id: 'user_4', email: 'd@example.com', digest: { enabled: true, hour: 9 } };
  await updateAccountPolicy(env, user, { discountCeilingPercent: 5 });
  const raw = await env.APP_KV.get('users:user_4');
  const reloaded = JSON.parse(raw);
  assert.equal(reloaded.digest.enabled, true);
  assert.equal(reloaded.digest.hour, 9);
});

await test('buildDraftPrompt に accountPolicy を渡すとプロンプトに値引き上限が含まれる', () => {
  const prompt = buildDraftPrompt(
    { subject: '見積依頼', body: '30%値引きできますか', riskLevel: 'low' },
    { accountPolicy: { discountCeilingPercent: 20, minOrderValueYen: null, bundlePolicy: 'none', freeformNote: '' } }
  );
  assert.match(prompt, /値引きは最大20%まで/);
});

await test('accountPolicy が無い場合はプロンプトに会社方針ブロックが出ない', () => {
  const prompt = buildDraftPrompt(
    { subject: '見積依頼', body: '本文', riskLevel: 'low' },
    {}
  );
  assert.doesNotMatch(prompt, /会社の方針/);
});

await test('industryTemplate は既定の3種以外は空文字に丸められる', async () => {
  const env = createEnv();
  const user = { id: 'user_5', email: 'e@example.com' };
  const saved = await updateAccountPolicy(env, user, { industryTemplate: 'unknown_template' });
  assert.equal(saved.industryTemplate, '');
});

await test('industryTemplate に正規のテンプレIDを保存すると読み戻せる', async () => {
  const env = createEnv();
  const user = { id: 'user_6', email: 'f@example.com' };
  const saved = await updateAccountPolicy(env, user, { industryTemplate: 'butsuhan' });
  assert.equal(saved.industryTemplate, 'butsuhan');
});

await test('buildDraftPrompt に industryTemplate を渡すと業種別の一文が含まれる', () => {
  const prompt = buildDraftPrompt(
    { subject: '見積依頼', body: '本文', riskLevel: 'low' },
    { accountPolicy: { industryTemplate: 'butsuhan', discountCeilingPercent: null, minOrderValueYen: null, bundlePolicy: 'none', freeformNote: '' } }
  );
  assert.match(prompt, /物販・卸業として/);
});

await test('inbox.js相当: tone未指定時はaccountPolicy.defaultToneがフォールバックに使われる', () => {
  const accountPolicy = accountPolicyForUser({ accountPolicy: { defaultTone: 'firm' } });
  const note = normalizeSecretaryNote({}, { tone: undefined || accountPolicy.defaultTone });
  assert.equal(note.tone, 'firm');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
