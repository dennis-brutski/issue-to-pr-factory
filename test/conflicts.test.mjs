import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config as defaults } from './fixtures/config.mjs';
import { conflictToResolve } from '../lib/conflicts.mjs';

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
