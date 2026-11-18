import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skippedTests } from '../lib/brakes.mjs';

const diff = (...added) => ['diff --git a/test/x.test.mjs b/test/x.test.mjs', '+++ b/test/x.test.mjs', ...added.map((l) => `+${l}`)].join('\n');

test('added skip, only and todo calls are flagged', () => {
  for (const line of ["test.skip('x', () => {})", "it.only('x', () => {})", "describe.todo('x')", "xit('x', () => {})", "test('x', { skip: true }, () => {})", '@pytest.mark.skip'])
    assert.equal(skippedTests(diff(line)).length, 1, line);
});

test('removed or unchanged lines and plain tests are clean', () => {
  assert.deepEqual(skippedTests("-test.skip('x', () => {})\n test.only('y')"), []);
  assert.deepEqual(skippedTests(diff("test('skips nothing', () => {})", 'const only = 1;')), []);
});

test('each finding quotes the line', () =>
  assert.match(skippedTests(diff("it.only('focus', () => {})"))[0], /test skipped or singled out: it\.only\('focus'/));
