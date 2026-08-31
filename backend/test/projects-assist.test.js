import assert from 'node:assert/strict';
import { buildAssistPrompt } from '../src/projects/assist.js';

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

const project = { name: 'andstory.jp サイト切り替え', summary: 'WordPress→Jimdo移行' };
const channels = [
  { label: 'andstory.jp グループ', source: 'chatwork', counterpart_role: 'mixed', description_masked: 'ドメイン: andstory.jp' },
  { label: 'ココナラ見積り相談', source: 'coconala', counterpart_role: 'customer', description_masked: '' }
];
const publicMessages = [
  { sent_at: Date.parse('2026-08-30T08:53:00Z'), channel_source: 'coconala', sender_role: 'customer', sender_display_name: 'ANDSTORY', body: '予算は3万円程度です' }
];
const internalMessages = [
  { sent_at: Date.parse('2026-08-04T11:36:00Z'), channel_source: 'chatwork', sender_role: 'engineer', sender_display_name: 'corehei', body: '現時点では金額の算出が難しい' }
];

test('buildAssistPrompt: システム指示・few-shot・両ログ・依頼文が全て含まれる', () => {
  const prompt = buildAssistPrompt({ project, channels, publicMessages, internalMessages, mode: 'status' });
  assert.ok(prompt.includes('絶対に守るルール'));
  assert.ok(prompt.includes('金額を自分で確定しない') || prompt.includes('金額・納期・作業範囲を自分で確定しない'));
  assert.ok(prompt.includes('例1: 金額の食い違い'));
  assert.ok(prompt.includes('andstory.jp サイト切り替え'));
  assert.ok(prompt.includes('予算は3万円程度です'));
  assert.ok(prompt.includes('現時点では金額の算出が難しい'));
  assert.ok(prompt.includes('この案件の現状を出力形式に従って整理してください'));
});

test('buildAssistPrompt: 公開ログと内部ログが別セクションに分かれている', () => {
  const prompt = buildAssistPrompt({ project, channels, publicMessages, internalMessages, mode: 'reconcile' });
  // few-shot例にも「公開ログ:」「内部ログ:」という語が出るため、コンテキスト部の
  // 見出し（【】付き）だけを対象に、最後に出現する組（＝実データのセクション）を見る。
  const publicIdx = prompt.lastIndexOf('【公開ログ】');
  const internalIdx = prompt.lastIndexOf('【内部ログ】');
  const customerBodyIdx = prompt.lastIndexOf('予算は3万円程度です');
  const engineerBodyIdx = prompt.lastIndexOf('現時点では金額の算出が難しい');
  assert.ok(publicIdx < internalIdx, '実データの【公開ログ】見出しは【内部ログ】見出しより前にある');
  assert.ok(publicIdx < customerBodyIdx && customerBodyIdx < internalIdx, '顧客発言は公開ログセクション内にある');
  assert.ok(internalIdx < engineerBodyIdx, 'エンジニア発言は内部ログセクション内にある');
});

test('buildAssistPrompt: draft_replyモードはintentを指示文に含める', () => {
  const prompt = buildAssistPrompt({ project, channels, publicMessages, internalMessages, mode: 'draft_reply', intent: '見積りが遅れている旨をお詫びする' });
  assert.ok(prompt.includes('見積りが遅れている旨をお詫びする'));
  assert.ok(prompt.includes('顧客向け返信案を作成'));
});

test('buildAssistPrompt: メッセージが空でも壊れない', () => {
  const prompt = buildAssistPrompt({ project, channels: [], publicMessages: [], internalMessages: [], mode: 'status' });
  assert.ok(prompt.includes('該当する発言はありません'));
  assert.ok(prompt.includes('チャネル未登録'));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
