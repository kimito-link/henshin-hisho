import assert from 'node:assert/strict';
import { extractTriageJson } from '../src/triage.js';
import { pickTone } from '../src/draft-gen.js';

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

await test('extractTriageJson repairs truncated JSON and returns repaired status', async () => {
  const truncated = '{"category":"support","priority":"high","summary":"途中で切れた';
  const result = extractTriageJson(truncated);
  assert.equal(result.status, 'repaired');
  assert.equal(result.data.category, 'support');
  assert.equal(result.data.priority, 'high');
});

await test('pickTone returns known tone and falls back to polite for unknown tone', async () => {
  assert.equal(pickTone('firm'), 'firm');
  assert.equal(pickTone('calm'), 'calm');
  assert.equal(pickTone('casual'), 'casual');
  assert.equal(pickTone('polite'), 'polite');
  assert.equal(pickTone('unknown_tone'), 'polite');
  assert.equal(pickTone(''), 'polite');
  assert.equal(pickTone(undefined), 'polite');
});

console.log(`\nai-triage-shared.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
