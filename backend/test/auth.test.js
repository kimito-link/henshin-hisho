import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { accountPlan } from '../src/auth.js';

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
    APP_BASE_URL: 'https://henshin-hisho.link/app/'
  };
}

function post(path, body, token = '') {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`https://app.example.test${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
}

function get(path, token = '') {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return new Request(`https://app.example.test${path}`, { method: 'GET', headers });
}

async function signup(env, email = 'buyer@example.com', password = 'password123') {
  const response = await worker.fetch(post('/auth/signup', { email, password }), env);
  return { response, json: await response.json() };
}

await test('signup creates user, hashes password, starts trial, and returns a session', async () => {
  const env = createEnv();
  const { response, json } = await signup(env);
  assert.equal(response.status, 200);
  assert.equal(json.ok, true);
  assert.match(json.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(json.account.plan, 'trial');
  assert.equal(json.account.trialDaysRemaining, 14);

  const userId = await env.APP_KV.get('email-index:buyer@example.com');
  const user = JSON.parse(await env.APP_KV.get(`users:${userId}`));
  assert.equal(user.email, 'buyer@example.com');
  assert.notEqual(user.passwordHash, 'password123');
  assert.match(user.passwordHash, /^pbkdf2\$/);
  assert.equal(await env.APP_KV.get(`session:${json.token}`) !== null, true);
});

await test('login verifies password and creates a new valid session', async () => {
  const env = createEnv();
  await signup(env, 'login@example.com', 'password123');
  const response = await worker.fetch(post('/auth/login', {
    email: 'login@example.com',
    password: 'password123'
  }), env);
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.ok, true);

  const account = await worker.fetch(get('/account', json.token), env);
  assert.equal(account.status, 200);
  assert.equal((await account.json()).account.plan, 'trial');
});

await test('account plan transitions from trial to expired', async () => {
  const now = 1000;
  assert.equal(accountPlan({ trialEndsAt: now + 86400 }, now).plan, 'trial');
  assert.equal(accountPlan({ trialEndsAt: now - 1 }, now).plan, 'expired');
});

await test('account delete removes the user, indexes, sessions, and user-owned keys', async () => {
  const env = createEnv();
  const { json } = await signup(env, 'delete@example.com', 'password123');
  const userId = await env.APP_KV.get('email-index:delete@example.com');
  await env.APP_KV.put(`inbox:${userId}:item_1`, JSON.stringify({ id: 'item_1' }));

  const response = await worker.fetch(post('/account/delete', {}, json.token), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(env.APP_KV.store.size, 0);
});

console.log(`\nauth.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
