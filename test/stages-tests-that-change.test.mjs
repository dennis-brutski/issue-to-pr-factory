// The factory reads which test files an issue says will change, from its "## Tests that change" section.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testsThatChange } from '../lib/stages.mjs';

test('a section with two bullets gives both paths', () => {
  const body = '## Tests that change\n\n- `test/a.test.js`: now expects 2\n- `test/b.test.js` goes, its logic is removed\n';
  assert.deepEqual(testsThatChange(body), ['test/a.test.js', 'test/b.test.js']);
});

test('text outside the section is ignored', () => {
  const body = [
    '## Problem', '', '- `src/x.js` is wrong', '',
    '## Tests that change', '', '- `test/a.test.js`: and `test/c.test.js` is mentioned here', '',
    '## Out of scope', '', '- `test/b.test.js`', '',
  ].join('\n');
  assert.deepEqual(testsThatChange(body), ['test/a.test.js']);
});

test('no section gives an empty list', () => {
  assert.deepEqual(testsThatChange('## Problem\n\n- `test/a.test.js`\n'), []);
  assert.deepEqual(testsThatChange(''), []);
  assert.deepEqual(testsThatChange(undefined), []);
});

test('a section without bullets gives an empty list', () => {
  assert.deepEqual(testsThatChange('## Tests that change\n\nNone, `test/a.test.js` stays.\n'), []);
});
