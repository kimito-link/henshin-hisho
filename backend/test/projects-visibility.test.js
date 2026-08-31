import assert from 'node:assert/strict';
import { decideSenderRole, decideVisibility, deriveDefaultVisibility } from '../src/projects/visibility.js';

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

// --- decideSenderRole ---

test('senderRole: internal_staffに登録があればoperatorはinternal', () => {
  const staffMap = new Map([['chatwork:100', { staff_role: 'operator' }]]);
  const role = decideSenderRole({
    source: 'chatwork',
    senderAccountId: '100',
    channelLink: { counterpart_role: 'customer' },
    staffMap
  });
  assert.equal(role, 'internal');
});

test('senderRole: internal_staffに登録があればengineerはengineer', () => {
  const staffMap = new Map([['chatwork:200', { staff_role: 'engineer' }]]);
  const role = decideSenderRole({
    source: 'chatwork',
    senderAccountId: '200',
    channelLink: { counterpart_role: 'customer' },
    staffMap
  });
  assert.equal(role, 'engineer');
});

test('senderRole: staff未登録・顧客窓口ルームならcustomer', () => {
  const role = decideSenderRole({
    source: 'coconala',
    senderAccountId: 'yutaka',
    channelLink: { counterpart_role: 'customer' },
    staffMap: new Map()
  });
  assert.equal(role, 'customer');
});

test('senderRole: staff未登録・エンジニア窓口ルームならengineer', () => {
  const role = decideSenderRole({
    source: 'chatwork',
    senderAccountId: '999',
    channelLink: { counterpart_role: 'engineer' },
    staffMap: new Map()
  });
  assert.equal(role, 'engineer');
});

test('senderRole: staff未登録・mixedルームならunknown', () => {
  const role = decideSenderRole({
    source: 'chatwork',
    senderAccountId: '999',
    channelLink: { counterpart_role: 'mixed' },
    staffMap: new Map()
  });
  assert.equal(role, 'unknown');
});

test('senderRole: 表示名は判定に一切使わない（同一account_idなら常に同じ結果）', () => {
  const staffMap = new Map([['chatwork:100', { staff_role: 'operator' }]]);
  // 表示名が「君斗りんく」でも「besttrust」でも、account_idが同じならinternal判定は変わらない
  const roleA = decideSenderRole({ source: 'chatwork', senderAccountId: '100', channelLink: { counterpart_role: 'customer' }, staffMap });
  const roleB = decideSenderRole({ source: 'chatwork', senderAccountId: '100', channelLink: { counterpart_role: 'engineer' }, staffMap });
  assert.equal(roleA, 'internal');
  assert.equal(roleB, 'internal');
});

// --- decideVisibility（3ルール） ---

test('visibility: 顧客窓口ルームは全発言public', () => {
  const v = decideVisibility({ senderRole: 'customer', channelLink: { counterpart_role: 'customer' } });
  assert.equal(v, 'public');
});

test('visibility: 顧客窓口ルームでは内部staffの発言もpublic', () => {
  // 実演事実: 顧客直接窓口(Soletta案件)で運営者が答えた発言も、顧客がその場で読んでいるためpublic
  const v = decideVisibility({ senderRole: 'internal', channelLink: { counterpart_role: 'customer' } });
  assert.equal(v, 'public');
});

test('visibility: エンジニア窓口ルームは全発言internal', () => {
  const v = decideVisibility({ senderRole: 'engineer', channelLink: { counterpart_role: 'engineer' } });
  assert.equal(v, 'internal');
});

test('visibility: mixedルームはfail-closedでinternal', () => {
  // 実演事実: 同一Chatworkルーム内に顧客予算とエンジニア原価が混在するケース
  const v = decideVisibility({ senderRole: 'unknown', channelLink: { counterpart_role: 'mixed' } });
  assert.equal(v, 'internal');
});

// --- deriveDefaultVisibility ---

test('deriveDefaultVisibility: customerはpublic、それ以外はinternal', () => {
  assert.equal(deriveDefaultVisibility('customer'), 'public');
  assert.equal(deriveDefaultVisibility('engineer'), 'internal');
  assert.equal(deriveDefaultVisibility('mixed'), 'internal');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
