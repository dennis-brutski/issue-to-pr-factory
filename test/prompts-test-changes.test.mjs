// The rules tell agents when an existing test may change: when the task says so, and lines added to test support.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPrompt } from '../lib/stages.mjs';

const vars = { number: 7, branch: 'factory/issue-7', base: 'main', title: 'T', body: 'B', comments: 'C', findings: 'F' };

test('the rules allow the test change the task asks for, as a draft', () => {
  const p = renderPrompt('implement', vars, { testDirs: ['test/'] });
  assert.match(p, /you may change or delete an existing test when the task's change needs it \(a new signature, message or behaviour the task changes, logic the task removes\); change only what that needs; never weaken a test to make it pass \(no removed assertions, looser expected values, `try`\/`catch` around a failure, early `return`\); add new test cases to the test file they belong in\. The pull request is a draft unless the task lists the test file under `## Tests that change`/);
});
test('the rules allow adding lines to test support files', () => {
  const p = renderPrompt('implement', vars, { testDirs: ['test/'], testSupport: ['test/fakes/', 'test/x.test.mjs'] });
  assert.match(p, /You may add lines to `test\/fakes\/`, `test\/x\.test\.mjs` \(fakes and contract tests\); do not change or remove their existing lines\./);
});
test('without test support files the rules do not mention them', () => {
  assert.doesNotMatch(renderPrompt('implement', vars, { testDirs: ['test/'] }), /fakes and contract tests/);
});
