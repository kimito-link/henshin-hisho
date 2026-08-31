import assert from 'node:assert/strict';
import {
  aggregateWeeklyReport,
  buildWeeklyReportText,
  runWeeklyReportSchedule,
  updateReportSettings
} from '../src/weekly-report.js';

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
    MAIL_FROM: 'AI返信秘書 <no-reply@henshin-hisho.link>',
    RESEND_API_KEY: 're_test_key',
    APP_BASE_URL: 'https://henshin-hisho.link/app/'
  };
}

function reportItem(overrides = {}) {
  return {
    id: overrides.id || `item_${Math.random()}`,
    receivedAt: Date.parse('2026-07-06T00:00:00.000Z'),
    status: 'draft_ready',
    riskConfirmed: false,
    riskLevel: 'low',
    triage: {
      category: 'reply_needed',
      suggestedAction: 'create_draft',
      riskLevel: 'low',
      requiresHumanApproval: false
    },
    draft: { body: '確認します。' },
    ...overrides
  };
}

await test('weekly report aggregates only the last seven days', async () => {
  const now = Date.parse('2026-07-07T00:00:00.000Z');
  const summary = aggregateWeeklyReport([
    reportItem({
      id: 'risk',
      riskLevel: 'high',
      riskConfirmed: true,
      triage: { riskLevel: 'high', requiresHumanApproval: true, category: 'legal', suggestedAction: 'needs_manual_review' }
    }),
    reportItem({ id: 'reply' }),
    reportItem({ id: 'done', status: 'sent' }),
    reportItem({ id: 'old', receivedAt: now - 8 * 24 * 60 * 60 * 1000 })
  ], { now });
  assert.equal(summary.highRiskStopped, 1);
  assert.equal(summary.replyDrafts, 2);
  assert.equal(summary.completed, 1);
});

await test('weekly report hides money amount when average case value is unset', async () => {
  const summary = aggregateWeeklyReport([reportItem({ riskLevel: 'high', riskConfirmed: true })], {
    now: Date.parse('2026-07-07T00:00:00.000Z')
  });
  const text = buildWeeklyReportText(summary);
  assert.equal(summary.hasAmount, false);
  assert.doesNotMatch(text, /推定損失回避額/);
});

await test('zero weekly report copy stays positive', async () => {
  const text = buildWeeklyReportText(aggregateWeeklyReport([], {
    now: Date.parse('2026-07-07T00:00:00.000Z')
  }));
  assert.match(text, /今週は危険な返信はありませんでした/);
});

await test('estimated amount copy always includes basis when average case value exists', async () => {
  const summary = aggregateWeeklyReport([
    reportItem({ riskLevel: 'high', riskConfirmed: true })
  ], {
    now: Date.parse('2026-07-07T00:00:00.000Z'),
    avgCaseValue: 50000
  });
  const text = buildWeeklyReportText(summary);
  assert.equal(summary.estimatedAvoidedLoss, 50000);
  assert.match(text, /推定損失回避額/);
  assert.match(text, /算定根拠: 客単価50,000円 × 危ない返信1件/);
});

await test('report settings store average case value on the user', async () => {
  const env = createEnv();
  const user = { id: 'user_1', email: 'buyer@example.com', weeklyReport: { enabled: true }, avgCaseValue: 0 };
  await env.APP_KV.put('users:user_1', JSON.stringify(user));
  const settings = await updateReportSettings(env, user, { enabled: true, avgCaseValue: 120000 });
  assert.equal(settings.avgCaseValue, 120000);
  const stored = JSON.parse(await env.APP_KV.get('users:user_1'));
  assert.equal(stored.avgCaseValue, 120000);
});

await test('weekly schedule sends on Monday at digest hour', async () => {
  const sent = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    sent.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ id: 'mail_1' }), { status: 200 });
  };
  try {
    const user = {
      id: 'user_1',
      email: 'buyer@example.com',
      digest: { enabled: true, hour: 8, timezone: 'Asia/Tokyo', channel: 'email' },
      weeklyReport: { enabled: true },
      avgCaseValue: 0
    };
    const env = createEnv({
      'users:user_1': JSON.stringify(user),
      'inbox:user_1:item_1': JSON.stringify(reportItem())
    });
    const results = await runWeeklyReportSchedule(env, { now: Date.parse('2026-07-05T23:00:00.000Z') });
    assert.equal(results.length, 1);
    assert.equal(sent.length, 1);
    assert.match(sent[0].body.subject, /今週の成果レポート/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log(`\nweekly-report.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
