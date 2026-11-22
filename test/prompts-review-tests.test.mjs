// The review session also checks changes to existing tests, and reports what it finds as test concerns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPrompt, schemas } from '../lib/stages.mjs';

const vars = { number: 7, branch: 'factory/issue-7', base: 'main', title: 'T', body: 'B', comments: 'C' };
const p = renderPrompt('review', vars, { testDirs: ['test/'] });

test('the review prompt asks whether added lines form new tests', () => {
  assert.match(p, /added lines form new tests, not lines inside an existing one/);
});
test('the review prompt asks whether test changes match the Tests that change section', () => {
  assert.match(p, /`## Tests that change`/);
});
test('the review prompt asks whether an existing test is weakened', () => {
  assert.match(p, /weakened/);
  assert.match(p, /removed assertions/);
  assert.match(p, /early `return`/);
});
test('the review prompt asks for test_concerns', () => {
  assert.match(p, /`test_concerns`/);
});
test('the review schema requires test_concerns, a list of strings', () => {
  assert.deepEqual(schemas.review.properties.test_concerns, { type: 'array', items: { type: 'string' } });
  assert.ok(schemas.review.required.includes('test_concerns'));
});
