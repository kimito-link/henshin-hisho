import assert from 'node:assert/strict';
import { guardCustomerReplySection } from '../src/projects/leak-guard.js';

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    fail += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

const publicMessages = [{ body: '予算は3万円程度です' }];
const internalMessages = [{ body: 'エンジニアの見積もりは4万円程度です' }];

test('guardCustomerReplySection: 内部限定の金額が返信案に混入していれば差し替える(2026-08-31実損の再現)', () => {
  const llmOutput = `■ 状況の整理
【事実】顧客は3万円と発言。

■ 顧客向け返信案
お世話になっております。今回の作業は4万円程度で承っております。`;
  const result = guardCustomerReplySection(llmOutput, publicMessages, internalMessages);
  assert.equal(result.leakBlocked, true);
  assert.ok(result.blockedAmounts.includes('40000'));
  assert.ok(!result.text.includes('4万円程度で承っております'));
  assert.ok(result.text.includes('非表示にしました'));
  assert.ok(result.text.includes('■ 状況の整理'), '返信案より前のセクションは保持する');
});

test('guardCustomerReplySection: 公開ログにも同じ金額があれば混入とみなさない', () => {
  const llmOutput = `■ 顧客向け返信案
今回は3万円で承ります。`;
  const publicWithSameAmount = [{ body: '3万円でお願いします' }];
  const result = guardCustomerReplySection(llmOutput, publicWithSameAmount, internalMessages);
  assert.equal(result.leakBlocked, false);
  assert.ok(result.text.includes('3万円で承ります'));
});

test('guardCustomerReplySection: 返信案セクションが無いモード(status/reconcile)はそのまま通す', () => {
  const llmOutput = '■ 状況の整理\n【事実】顧客は3万円と発言。エンジニアは4万円と発言。';
  const result = guardCustomerReplySection(llmOutput, publicMessages, internalMessages);
  assert.equal(result.leakBlocked, false);
  assert.equal(result.text, llmOutput);
});

test('guardCustomerReplySection: 内部ログに金額が無ければ何もしない', () => {
  const llmOutput = '■ 顧客向け返信案\n進捗をご確認いただけますと幸いです。';
  const result = guardCustomerReplySection(llmOutput, publicMessages, [{ body: '作業を進めています' }]);
  assert.equal(result.leakBlocked, false);
  assert.equal(result.text, llmOutput);
});

test('guardCustomerReplySection: 表記ゆれ(40,000円 と 4万円)を同一金額として検出する', () => {
  const llmOutput = `■ 顧客向け返信案
今回は40,000円で承っております。`;
  const result = guardCustomerReplySection(llmOutput, publicMessages, internalMessages);
  assert.equal(result.leakBlocked, true);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
