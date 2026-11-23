// Later stages read the issue's "## Tests that change" from the pull request body, but only from the
// factory's own part: between "Closes #n" and "## What changed". The summary after it is the agent's text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testsThatChangeOf } from '../lib/stages.mjs';

const pr = (body) => ({ kind: 'pr', number: 12, headRef: 'factory/issue-7', body });

test('an issue is read in full', () => {
  assert.deepEqual(testsThatChangeOf({ kind: 'issue', number: 7, body: 'x\n\n## Tests that change\n\n- `test/a.test.js`\n' }), ['test/a.test.js']);
});

test('a pull request gives the factory section before the summary', () => {
  const body = 'Closes #7\n\n## Tests that change\n\n- `test/a.test.js`\n\n## What changed\n\nMade a 2.\n\n## Checks\n\nok';
  assert.deepEqual(testsThatChangeOf(pr(body)), ['test/a.test.js']);
});

test('a section in the summary of a pull request is ignored', () => {
  const body = 'Closes #7\n\n## What changed\n\nMade a 2.\n\n## Tests that change\n\n- `test/b.test.js`\n\n## Checks\n\nok';
  assert.deepEqual(testsThatChangeOf(pr(body)), []);
});

test('a section in the warning above "Closes" is ignored', () => {
  const body = '> ⚠ This pull request changes files you should check:\n> - x\n\n## Tests that change\n\n- `test/b.test.js`\n\nCloses #7\n\n## What changed\n\nMade a 2.';
  assert.deepEqual(testsThatChangeOf(pr(body)), []);
});

test('a pull request body without the factory layout gives an empty list', () => {
  assert.deepEqual(testsThatChangeOf(pr('## Tests that change\n\n- `test/a.test.js`\n')), []);
  assert.deepEqual(testsThatChangeOf(pr('')), []);
});
