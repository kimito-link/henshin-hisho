import assert from 'node:assert/strict';
import { maskSecrets } from '../src/projects/masker.js';

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

// 実演で確認した実データ（Chatwork概要欄）に近い文言
test('ラベル密着型: パスコード: xxxx を伏せる', () => {
  const { text, masked } = maskSecrets('サイト①\nhttp://best-trust.biz/sys-admin/\nID\nbesttrust\nパスコード: xxxxYYYY1234');
  assert.equal(masked, true);
  assert.ok(!text.includes('xxxxYYYY1234'));
  assert.ok(text.includes('パスコード: ***'));
});

test('ラベル密着型: ID besttrust の besttrust までは伏せない誤爆をしない（短い値は許容）', () => {
  const { text } = maskSecrets('ID\nbesttrust');
  // "ID\nbesttrust" は改行を挟むため \S+ には一致しない設計（次行まで食わない）ことを確認
  assert.equal(text, 'ID\nbesttrust');
});

test('ラベル密着型: 全角コロンに対応する', () => {
  const { text, masked } = maskSecrets('パスワード：abcdef123456');
  assert.equal(masked, true);
  assert.ok(!text.includes('abcdef123456'));
});

test('値そのもの型: 32文字以上の英数記号連続を伏せる', () => {
  const key = 'sk-ant-' + 'a'.repeat(40);
  const { text, masked } = maskSecrets(`APIキーはこちら ${key} です`);
  assert.equal(masked, true);
  assert.ok(!text.includes(key));
});

test('値そのもの型: URLは誤爆しない', () => {
  const url = 'https://www.chatwork.com/g/c2e13db64cquirabcdefghijklmnopqrstuvwxyz1234567890';
  const { text, masked } = maskSecrets(`招待リンク: ${url}`);
  assert.equal(masked, false);
  assert.ok(text.includes(url));
});

test('短い値・通常の文章は誤検知しない', () => {
  const { text, masked } = maskSecrets('現在、ホームページのリニューアルが完了し、旧サイトから新サイトへの切り替えを予定しております。');
  assert.equal(masked, false);
  assert.equal(text, '現在、ホームページのリニューアルが完了し、旧サイトから新サイトへの切り替えを予定しております。');
});

test('空文字・undefinedを安全に扱う', () => {
  assert.deepEqual(maskSecrets(''), { text: '', masked: false });
  assert.deepEqual(maskSecrets(undefined), { text: '', masked: false });
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
