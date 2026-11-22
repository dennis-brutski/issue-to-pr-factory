import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reasons, stopped, stopLabel } from '../lib/comments.mjs';

// Sample arguments for every reason function. A new reason without a sample fails the first test.
const SAMPLES = {
  stepFailed: ['implement', 'something new went wrong'],
  readOnlyChanged: ['gate'],
  worktreeDirty: ['runs/demo/worktrees/issue-1'],
  conflictsWithBase: ['factory/issue-1', 'main', 'runs/demo/worktrees/issue-1'],
  setupFailed: ['npm ci', '<details>out</details>'],
  factoryError: ['gh api failed'],
  notOnBranch: ['factory/issue-1', null],
  uncommitted: [],
  heldOutFailed: ['node --test held/'],
  checkFailed: ['npm test', '<details>out</details>'],
  needsDecision: ['agent:explore', 'agent:implement'],
  notClear: [40, 70, '- Which?'],
  couldNotFinish: ['Missing a fixture.'],
  noChanges: [],
  couldNotFix: ['No.'],
  draft: ['https://github.com/x/y/pull/3', '- package.json'],
  couldNotRework: ['No.'],
  reworkDraft: ['- package.json'],
  mergeUnresolved: ['Gave up.'],
  mergeDraft: ['- package.json'],
};

test('every reason function has a label and a sample here', () => {
  assert.deepEqual(Object.keys(reasons).sort(), Object.keys(SAMPLES).sort());
  for (const [name, fn] of Object.entries(reasons)) assert.ok(fn.label && !fn.label.startsWith('other'), name);
});

test('stopLabel gives each reason function its own label, never other', () => {
  for (const [name, fn] of Object.entries(reasons)) {
    const body = stopped('implement', fn(...SAMPLES[name]), 'agent:needs-human', 'factory/issue-1');
    assert.equal(stopLabel(body), fn.label, name);
  }
});

test('the six reasons stats used to show as other get labels of their own', () => {
  const labels = new Set(Object.values(reasons).map((fn) => fn.label));
  for (const name of ['readOnlyChanged', 'notOnBranch', 'uncommitted', 'mergeUnresolved'])
    assert.ok(labels.has(reasons[name].label), name);
  assert.notEqual(reasons.notOnBranch.label, reasons.uncommitted.label);
});

test('the reason texts stay as the owner knows them', () => {
  assert.equal(reasons.uncommitted(), 'The agent left uncommitted changes in the worktree.');
  assert.equal(reasons.notOnBranch('factory/issue-1', null), 'The worktree is not on its branch `factory/issue-1` (HEAD is detached), so the factory did not push.');
  assert.equal(reasons.notOnBranch('factory/issue-1', 'main'), 'The worktree is not on its branch `factory/issue-1` (HEAD is on `main`), so the factory did not push.');
  assert.equal(reasons.readOnlyChanged('gate'), 'The gate step is read-only but changed files in the worktree.');
  assert.equal(reasons.mergeUnresolved('Gave up.'), 'The merge is still unresolved. The worktree is left mid-merge.\n\nGave up.');
  assert.equal(reasons.stepFailed('gate', 'timed out after 45 min'), 'The gate step failed: timed out after 45 min');
});
