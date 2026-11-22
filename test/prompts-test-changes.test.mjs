// The rules tell agents when an existing test may change: when the task says so, and lines added to test support.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPrompt } from '../lib/stages.mjs';

const vars = { number: 7, branch: 'factory/issue-7', base: 'main', title: 'T', body: 'B', comments: 'C', findings: 'F' };

test('the rules allow the test change the task asks for, as a draft', () => {
  const p = renderPrompt('implement', vars, { testDirs: ['test/'] });
  assert.match(p, /if the task says an existing test must change, change only that test, only as asked; the pull request will be a draft/);
});
test('the rules allow adding lines to test support files', () => {
  const p = renderPrompt('implement', vars, { testDirs: ['test/'], testSupport: ['test/fakes/', 'test/x.test.mjs'] });
  assert.match(p, /You may add lines to `test\/fakes\/`, `test\/x\.test\.mjs` \(fakes and contract tests\); do not change or remove their existing lines\./);
});
test('without test support files the rules do not mention them', () => {
  assert.doesNotMatch(renderPrompt('implement', vars, { testDirs: ['test/'] }), /fakes and contract tests/);
});
