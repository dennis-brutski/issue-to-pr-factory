import { test } from 'node:test';
import assert from 'node:assert/strict';
import { additionsOnly } from '../lib/brakes.mjs';

const head = 'diff --git a/f.mjs b/f.mjs\nindex 1..2 100644\n--- a/f.mjs\n+++ b/f.mjs\n';

test('a diff that only adds lines is additions only', () => {
  assert.equal(additionsOnly(`${head}@@ -1,2 +1,3 @@\n a\n+b\n c\n`), true);
});
test('a removed line is not additions only', () => {
  assert.equal(additionsOnly(`${head}@@ -1,2 +1,2 @@\n a\n-b\n+c\n`), false);
});
test('a removed line that starts with "--" is still a removed line', () => {
  assert.equal(additionsOnly(`${head}@@ -1,2 +1,1 @@\n a\n---i;\n`), false);
});
test('a change with no text hunk (binary, mode only, or empty) is not additions only', () => {
  assert.equal(additionsOnly(`${head.replace(/--- .*\n\+\+\+ .*\n/, '')}Binary files a/f.mjs and b/f.mjs differ\n`), false);
  assert.equal(additionsOnly(''), false);
});
