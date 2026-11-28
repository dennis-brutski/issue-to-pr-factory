import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config as defaults } from './fixtures/config.mjs';
import { conflictToResolve, ciFailed } from '../lib/conflicts.mjs';

const config = { ...defaults, repo: 'example/web-app', baseBranch: 'master' };
const pr = (o = {}) => ({
  number: 4, kind: 'pr', title: 'Fix undo', body: '', author: 'dennis-brutski', bodyEditedAt: null,
  labels: [], labelEvents: [], comments: [], headRef: 'factory/issue-1', headRepo: 'example/web-app',
  mergeable: 'CONFLICTING', ...o,
});
const skips = (item) => assert.equal(conflictToResolve(item, config).action, 'skip');

test('a conflicting factory pull request by the owner runs merge', () =>
  assert.deepEqual(conflictToResolve(pr(), config), { action: 'run', stage: 'merge' }));
test('owner and repo are compared ignoring case', () =>
  assert.deepEqual(conflictToResolve(pr({ author: 'Dennis-Brutski', headRepo: 'Example/Web-App' }), config),
    { action: 'run', stage: 'merge' }));
test('a mergeable pull request is skipped', () => skips(pr({ mergeable: 'MERGEABLE' })));
test('an unknown mergeable state is skipped until GitHub works it out', () => skips(pr({ mergeable: 'UNKNOWN' })));
test('a missing mergeable state is skipped', () => skips(pr({ mergeable: null })));
test('an issue is skipped', () => skips(pr({ kind: 'issue', headRef: null, headRepo: null })));
test('a fork is skipped', () => skips(pr({ headRepo: 'mallory/web-app' })));
test('a branch that is not a factory branch is skipped', () => skips(pr({ headRef: 'feature/undo' })));
test('a pull request by someone else is skipped', () => skips(pr({ author: 'mallory' })));
for (const l of ['agent:in-progress', 'agent:needs-human', 'agent:done'])
  test(`a pull request with ${l} is skipped`, () => skips(pr({ labels: [l] })));
for (const l of ['agent:review', 'agent:merge'])
  test(`a pull request with ${l} is left to the label`, () => skips(pr({ labels: [l] })));
test('a skip says why', () =>
  assert.match(conflictToResolve(pr({ mergeable: 'MERGEABLE' }), config).reason, /\S/));

// A factory pull request on auto-merge whose CI failed: the poll turns auto-merge off and parks it.
const failing = (o = {}) => pr({ mergeable: 'MERGEABLE', autoMerge: true, ci: { state: 'FAILURE', failedUrl: 'https://ci/run/7' }, ...o });
test('a factory pull request on auto-merge whose CI failed is found', () => assert.equal(ciFailed(failing(), config), true));
test('a CI error counts as failed', () => assert.equal(ciFailed(failing({ ci: { state: 'ERROR', failedUrl: null } }), config), true));
for (const state of ['PENDING', 'EXPECTED', 'SUCCESS'])
  test(`CI ${state} is left alone`, () => assert.equal(ciFailed(failing({ ci: { state, failedUrl: null } }), config), false));
test('a pull request without checks is left alone', () => assert.equal(ciFailed(failing({ ci: null }), config), false));
test('a failed pull request without auto-merge is left alone', () => assert.equal(ciFailed(failing({ autoMerge: false }), config), false));
test('a failed pull request that is not the factory\'s is left alone', () => {
  assert.equal(ciFailed(failing({ headRef: 'feature/undo' }), config), false);
  assert.equal(ciFailed(failing({ headRepo: 'mallory/web-app' }), config), false);
  assert.equal(ciFailed(failing({ author: 'mallory' }), config), false);
  assert.equal(ciFailed(failing({ kind: 'issue' }), config), false);
});
