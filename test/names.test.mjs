// One rule for issue number ↔ branch ↔ worktree folder, used by every module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchFor, issueOfBranch, worktreeFor, issueOfWorktree, issueOf } from '../lib/names.mjs';
import { paths } from '../lib/workspace.mjs';
import { classify } from '../lib/eligibility.mjs';
import { config } from '../config.mjs';

test('branch and worktree names round-trip', () => {
  assert.equal(branchFor(7), 'factory/issue-7');
  assert.equal(issueOfBranch('factory/issue-7'), 7);
  assert.equal(worktreeFor(7), 'issue-7');
  assert.equal(issueOfWorktree('issue-7'), 7);
});

test('names that are not the factory\'s give null', () => {
  for (const ref of ['main', 'factory/issue-', 'factory/issue-7x', 'x/factory/issue-7', '', null, undefined]) assert.equal(issueOfBranch(ref), null, String(ref));
  assert.equal(issueOfWorktree('issue-7.bak'), null);
});

test('an item maps to its issue: a pull request through its branch', () => {
  assert.equal(issueOf({ kind: 'issue', number: 3 }), 3);
  assert.equal(issueOf({ kind: 'pr', number: 9, headRef: 'factory/issue-3' }), 3);
  assert.equal(issueOf({ kind: 'pr', number: 9, headRef: 'feature' }), 9);
});

test('workspace paths use the same names', () => {
  const p = paths('/r', 7);
  assert.equal(p.branch, branchFor(7));
  assert.ok(p.worktree.endsWith(`/worktrees/${worktreeFor(7)}`));
});

test('branchPattern is gone from the settings, and pull requests are still recognised', () => {
  assert.equal('branchPattern' in config, false);
  const T = '2026-11-01T10:00:00Z';
  const pr = { number: 9, kind: 'pr', title: 't', body: '', author: config.owner, bodyEditedAt: null, labels: ['agent:merge'],
    labelEvents: [{ label: 'agent:merge', actor: config.owner, at: T }], comments: [], headRef: 'factory/issue-3', headRepo: 'x/y' };
  assert.equal(classify(pr, { ...config, repo: 'x/y' }).action, 'run');
  assert.equal(classify({ ...pr, headRef: 'feature' }, { ...config, repo: 'x/y' }).action, 'skip');
});
