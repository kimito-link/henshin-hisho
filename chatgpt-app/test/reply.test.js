import assert from 'node:assert/strict';
import {
  applyInstruction,
  assessMessage,
  buildCandidates,
  compareSnapshot,
  PATENT_APPLICATIONS,
  PATENT_LABEL,
  reviewConfirmation
} from '../src/reply.js';

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

await test('出願番号は指定の文字列だけ', async () => {
  assert.deepEqual(PATENT_APPLICATIONS, [
    '特願22026-159882',
    '特願22026-040421',
    '特願22026-041498',
    '特願22026-206930',
    '特願22026-227084'
  ]);
  assert.equal(
    PATENT_LABEL,
    '特許出願中（特願22026-159882・特願22026-040421・特願22026-041498・特願22026-206930・特願22026-227084）'
  );
  assert.equal(PATENT_LABEL.includes('155882'), false);
  assert.equal(PATENT_LABEL.includes('041494'), false);
  assert.equal(PATENT_LABEL.includes('特願2026-'), false);
});

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

await test('各候補に相手の気持ちが付き、並びが違う', async () => {
  const assessment = assessMessage({ sender: '佐藤', subject: '見積の相談', body: '値引きはできますか。', tone: 'polite' });
  const candidates = buildCandidates(assessment);
  const categories = new Set();
  for (const candidate of candidates) {
    assert.ok(candidate.emotion.category);
    assert.equal(typeof candidate.emotion.score, 'number');
    assert.ok(candidate.emotion.reason);
    categories.add(candidate.emotion.category);
  }
  assert.ok(categories.size >= 2);
});

await test('さっきの人はしおりの相手に解決し、指示のトーンを読む', async () => {
  const applied = applyInstruction(
    { instruction: 'さっきの人に、納期だけ先に丁寧に返して' },
    [{ id: 'shiori-1', sender: '山田', subject: '納期の確認', excerpt: '来週の納期を確認したいです。' }]
  );
  assert.equal(applied.reference.resolved, true);
  assert.equal(applied.reference.shioriId, 'shiori-1');
  assert.equal(applied.input.sender, '山田');
  assert.equal(applied.input.tone, 'polite');
  assert.match(applied.input.intent, /納期/);
  assert.match(applied.input.body, /来週の納期/);
  const missing = applyInstruction({ instruction: 'さっきの人に返して', body: '本文はあります' }, []);
  assert.equal(missing.reference.resolved, false);
  assert.equal(missing.reference.reason, 'no_previous_person');
  assert.equal(missing.input.sender || '', '');
});

await test('保留の指示は高リスクでなくても保留候補にする', async () => {
  const applied = applyInstruction({ body: '明日の会議の件です', instruction: '保留にして' });
  const candidates = buildCandidates(assessMessage(applied.input));
  assert.equal(candidates.length, 3);
  assert.equal(candidates.every((candidate) => candidate.holding), true);
});

await test('コピー直前の状態が違うと再確認', async () => {
  const snapshot = { riskLevel: 'low', texts: ['下書きです'] };
  assert.equal(compareSnapshot(snapshot, { riskLevel: 'low', copyText: '下書きです' }).ok, true);
  assert.equal(compareSnapshot(snapshot, { riskLevel: 'low', copyText: '下書きです。追記' }).reason, 'state_mismatch');
  assert.equal(compareSnapshot(snapshot, { riskLevel: 'high', copyText: '下書きです' }).reason, 'state_mismatch');
  assert.equal(compareSnapshot(null, { riskLevel: 'low', copyText: '下書きです' }).reason, 'state_mismatch');
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
