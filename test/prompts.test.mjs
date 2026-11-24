import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderPrompt, schemas } from '../lib/stages.mjs';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// The prompts name whoever runs the factory, from cfg.ownerName, not a fixed person.
const vars = { number: 7, branch: 'factory/issue-7', base: 'main', title: 'T', body: 'B', comments: 'C', findings: 'F' };

test('every prompt uses the configured owner name and no other', () => {
  for (const name of ['gate', 'implement', 'review', 'fix', 'rework', 'merge', 'explore']) {
    assert.doesNotMatch(renderPrompt(name, vars, { ownerName: 'Alex' }), /Dennis/, name);
  }
  const implement = renderPrompt('implement', vars, { ownerName: 'Alex' });
  assert.match(implement, /### Comments from Alex\n/);
  assert.match(implement, /Alex has authorised commits/);
  assert.match(renderPrompt('rework', vars, { ownerName: 'Alex' }), /^Alex reviewed this branch/m);
});
test('without an owner name the prompts say "the owner"', () =>
  assert.match(renderPrompt('implement', vars), /### Comments from the owner/));

// The review session also checks changes to existing tests, and reports what it finds as test concerns.
describe('review of test changes', () => {
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
});

const root = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('explore, merge and fix name the skills that fit them', () => {
  const want = {
    explore: ['systematic-debugging'],
    merge: ['verification-before-completion'],
    fix: ['receiving-code-review'],
  };
  for (const [p, names] of Object.entries(want))
    for (const n of names) assert.match(read(`prompts/${p}.md`), new RegExp(`factory:${n}\\b`), `${p}.md names ${n}`);
});

test('explore and merge say what to do when a skill says to ask', () => {
  for (const p of ['explore', 'merge']) assert.match(read(`prompts/${p}.md`), /cannot ask/, `${p}.md`);
});

test('explore answers skill questions and permissions in writeup', () => {
  const t = read('prompts/explore.md');
  assert.match(t, /cannot ask.*`writeup`/);
  assert.match(t, /permission.*use your judgement.*`writeup`/s);
  assert.match(t, /write a test or change code, describe it in `writeup` instead/);
});

test('merge lets the agent decide where a skill asks for permission', () => {
  assert.match(read('prompts/merge.md'), /permission.*use your judgement.*`summary`/s);
});

test('explore and merge keep their session marker as the first line', () => {
  for (const p of ['explore', 'merge'])
    assert.equal(read(`prompts/${p}.md`).split('\n')[0], `<!-- session: ${p} -->`);
});

test('each code prompt names its skills', () => {
  const want = {
    implement: ['test-driven-development', 'verification-before-completion'],
    fix: ['systematic-debugging', 'verification-before-completion'],
    rework: ['receiving-code-review', 'systematic-debugging', 'verification-before-completion'],
  };
  for (const [p, names] of Object.entries(want))
    for (const n of names) assert.match(read(`prompts/${p}.md`), new RegExp(`factory:${n}\\b`), `${p}.md names ${n}`);
});

test('every skill a prompt names is vendored', () => {
  for (const f of readdirSync(join(root, 'prompts')).filter((f) => f.endsWith('.md'))) // a sandbox may leave folders here
    for (const [, name] of read(`prompts/${f}`).matchAll(/factory:([a-z-]+)/g))
      assert.ok(existsSync(join(root, 'skills', 'skills', name, 'SKILL.md')), `${f} names factory:${name}, which is not in skills/`);
});

test('code prompts say what to do when a skill says to ask', () => {
  for (const p of ['implement', 'fix', 'rework']) assert.match(read(`prompts/${p}.md`), /cannot ask/);
});

test('review prompt stays without skills', () => assert.ok(!read('prompts/review.md').includes('factory:')));

test('code prompts let the agent decide where a skill asks for permission', () => {
  for (const p of ['implement', 'fix', 'rework'])
    assert.match(read(`prompts/${p}.md`), /permission.*use your judgement.*`summary`/s, `${p}.md`);
});

// The rules tell agents when an existing test may change: when the task says so, and lines added to test support.
describe('test change rules', () => {
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
});
