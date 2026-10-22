import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  applyStripeEvent,
  billingView,
  consumeGeneration,
  createCheckoutSession,
  startTrial,
  verifyStripeSignature
} from '../src/billing.js';
import { createMemoryKv } from './helpers.js';

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

await test('お試しは14日で、二度目は延長しない', async () => {
  const env = { CHATGPT_KV: createMemoryKv() };
  const now = Date.parse('2026-10-22T00:00:00Z');
  const started = await startTrial(env, 'User@Example.com', now);
  assert.equal(started.ok, true);
  assert.equal(started.billing.plan, 'trial');
  assert.equal(started.billing.trialDaysRemaining, 14);
  const again = await startTrial(env, 'user@example.com', now + 86400000);
  assert.equal(again.already, true);
  assert.equal(again.billing.trialDaysRemaining, 13);
  const expired = await billingView(env, 'user@example.com', now + 15 * 86400000);
  assert.equal(expired.plan, 'expired');
  const blocked = await startTrial(env, 'user@example.com', now + 15 * 86400000);
  assert.equal(blocked.reason, 'trial_used');
});

await test('期限切れは候補枠を消費しないで止める', async () => {
  const env = { CHATGPT_KV: createMemoryKv() };
  const now = Date.parse('2026-10-22T00:00:00Z');
  await startTrial(env, 'a@example.com', now);
  const gate = await consumeGeneration(env, { email: 'a@example.com', deskId: 'desk-12345678' }, now + 15 * 86400000);
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, 'plan_expired');
  assert.equal(env.CHATGPT_KV.store.has('usage:a@example.com:trial'), false);
});

await test('メールなしは1日3件', async () => {
  const env = { CHATGPT_KV: createMemoryKv() };
  const now = Date.parse('2026-10-22T00:00:00Z');
  const deskId = 'desk-abcdef12';
  for (let i = 0; i < 3; i += 1) {
    const gate = await consumeGeneration(env, { deskId }, now);
    assert.equal(gate.ok, true);
  }
  const blocked = await consumeGeneration(env, { deskId }, now);
  assert.equal(blocked.reason, 'preview_exhausted');
});

await test('Stripe未設定では決済URLを作らない', async () => {
  const session = await createCheckoutSession({ CHATGPT_KV: createMemoryKv() }, { email: 'a@example.com', origin: 'https://example.com' });
  assert.equal(session.reason, 'stripe_not_configured');
});

await test('署名が合うWebhookだけ有料にする', async () => {
  const env = { CHATGPT_KV: createMemoryKv(), STRIPE_WEBHOOK_SECRET: 'whsec_test' };
  const event = {
    type: 'checkout.session.completed',
    data: { object: { metadata: { email: 'paid@example.com' }, customer: 'cus_123' } }
  };
  const payload = JSON.stringify(event);
  const stamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', env.STRIPE_WEBHOOK_SECRET).update(`${stamp}.${payload}`).digest('hex');
  assert.equal(await verifyStripeSignature(payload, `t=${stamp},v1=${signature}`, env.STRIPE_WEBHOOK_SECRET), true);
  assert.equal(await verifyStripeSignature(payload, `t=${stamp - 1000},v1=${signature}`, env.STRIPE_WEBHOOK_SECRET), false);
  const applied = await applyStripeEvent(env, event);
  assert.equal(applied.ok, true);
  const view = await billingView(env, 'paid@example.com');
  assert.equal(view.plan, 'active');
  const gate = await consumeGeneration(env, { email: 'paid@example.com' });
  assert.equal(gate.ok, true);
});

await test('解約イベントで有料を終了する', async () => {
  const env = { CHATGPT_KV: createMemoryKv() };
  await applyStripeEvent(env, {
    type: 'checkout.session.completed',
    data: { object: { customer_email: 'end@example.com', customer: 'cus_end' } }
  });
  await applyStripeEvent(env, {
    type: 'customer.subscription.deleted',
    data: { object: { customer: 'cus_end', status: 'canceled' } }
  });
  const view = await billingView(env, 'end@example.com');
  assert.equal(view.plan, 'expired');
});

if (fail > 0) {
  console.error(`${fail} failed`);
  process.exit(1);
}
console.log(`${pass} passed`);
