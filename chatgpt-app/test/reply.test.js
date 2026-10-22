import assert from 'node:assert/strict';
import { assessMessage, buildCandidates, reviewConfirmation } from '../src/reply.js';

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

await test('返金は高リスクで、候補は保留だけ', async () => {
  const assessment = assessMessage({
    sender: '山田',
    subject: '返金のお願い',
    body: '昨日の請求を全額返金してください。約束が違う。',
    channel: 'email',
    tone: 'firm'
  });
  assert.equal(assessment.risk.level, 'high');
  assert.equal(assessment.risk.requiresHumanApproval, true);
  assert.ok(assessment.risk.reasons.some((reason) => reason.includes('返金')));
  assert.equal(assessment.classification, 'needs_reply');
  const candidates = buildCandidates(assessment);
  assert.equal(candidates.length, 3);
  for (const candidate of candidates) {
    assert.equal(candidate.holding, true);
    assert.match(candidate.text, /改めてご連絡/);
    assert.doesNotMatch(candidate.text, /返金します|返金いたします|必ず対応|お約束できます/);
  }
});

await test('通知メールは返信候補を作らない', async () => {
  const assessment = assessMessage({
    sender: 'noreply@news.example',
    subject: '週刊ニュース',
    body: '今週の更新です。配信停止はこちら。'
  });
  assert.equal(assessment.classification, 'notice');
  assert.equal(buildCandidates(assessment).length, 0);
  assert.ok(assessment.risk.reasons.some((reason) => reason.includes('振り分け')));
});

await test('通知でも訴訟なら保留の候補を出す', async () => {
  const assessment = assessMessage({
    sender: 'noreply@court.example',
    subject: '通知',
    body: '訴訟の案内を自動配信しています。'
  });
  assert.equal(assessment.classification, 'needs_reply');
  assert.equal(assessment.risk.level, 'high');
  assert.equal(buildCandidates(assessment).length, 3);
});

await test('金額の相談には方針の数値を足す', async () => {
  const assessment = assessMessage({
    sender: '佐藤',
    subject: '見積の相談',
    body: '値引きはできますか。',
    discountCeilingPercent: 20,
    minOrderValueYen: 50000,
    tone: 'polite'
  });
  assert.equal(assessment.risk.level, 'medium');
  const candidates = buildCandidates(assessment);
  assert.match(candidates[0].text, /最大20%/);
  assert.match(candidates[0].text, /50000円/);
});

await test('LINEの引き渡し文は送信しないと書く', async () => {
  const assessment = assessMessage({ sender: '相手', body: '明日の件です', channel: 'line' });
  assert.match(assessment.handoff, /LINE/);
  assert.match(assessment.handoff, /送信は行いません/);
});

await test('確認チェックが無い文面は渡さない', async () => {
  const blocked = reviewConfirmation({ text: '下書き', humanConfirmed: false, riskLevel: 'low' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.sent, false);
  const high = reviewConfirmation({ text: '下書き', humanConfirmed: true, riskLevel: 'high', riskAcknowledged: false });
  assert.equal(high.reason, 'risk_acknowledgement_required');
  const ready = reviewConfirmation({ text: '下書きです', humanConfirmed: true, riskLevel: 'high', riskAcknowledged: true });
  assert.equal(ready.ok, true);
  assert.equal(ready.sent, false);
  assert.equal(ready.copyText, '下書きです');
});

if (fail > 0) {
  console.error(`${fail} failed`);
  process.exit(1);
}
console.log(`${pass} passed`);
