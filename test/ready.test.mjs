import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config as defaults } from './fixtures/config.mjs';
import { readiness } from '../lib/ready.mjs';

const cfg = { ...defaults, repo: 'example/web-app', baseBranch: 'master' };
const issue = (o = {}) => ({ number: 5, title: 'Fix undo', url: 'u', body: 'Do it.', labels: [], blockedBy: [],
  subIssues: { total: 0, completed: 0 }, pullRequests: [], ...o });

test('ready when nothing holds it back', () =>
  assert.equal(readiness(issue(), cfg, [5]), null));

test('an issue with a trigger or state label is not ready', () => {
  assert.equal(readiness(issue({ labels: ['bug', 'agent:implement'] }), cfg, [5]), 'has agent:implement');
  assert.equal(readiness(issue({ labels: ['agent:done'] }), cfg, [5]), 'has agent:done');
});

test('an issue that waits for another is not ready', () => {
  assert.equal(readiness(issue({ body: '## Depends on\n- #3\n' }), cfg, [3, 5]), 'waits for #3');
  assert.equal(readiness(issue({ blockedBy: [{ number: 4, repo: 'o/other', open: true }] }), cfg, [5]), 'waits for o/other#4');
});

test('an issue with open sub-issues is not ready', () =>
  assert.equal(readiness(issue({ subIssues: { total: 13, completed: 10 } }), cfg, [5]), 'has 3 open sub-issues'));

test('ready when every sub-issue is closed', () =>
  assert.equal(readiness(issue({ subIssues: { total: 13, completed: 13 } }), cfg, [5]), null));

test('an issue with an open pull request is not ready', () =>
  assert.equal(readiness(issue({ pullRequests: [{ number: 6, open: false }, { number: 7, open: true }] }), cfg, [5]),
    'has an open pull request: #7'));

test('ready when its pull request is closed', () =>
  assert.equal(readiness(issue({ pullRequests: [{ number: 6, open: false }] }), cfg, [5]), null));
