// The factory inbox: which open items wait for the owner, and what the owner said since. Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from './fixtures/config.mjs';
import { stopOf, worktreeOf, inboxOf } from '../lib/inbox.mjs';
import { stopped, didNotStart } from '../lib/comments.mjs';

const OWNER = config.owner;
const cfg = { ...config, target: 'web', repo: 'me/web', runDir: '/f/runs/web' };
const at = (h) => `2026-11-01T${String(h).padStart(2, '0')}:00:00Z`;
const says = (body, h, author = OWNER) => ({ author, body, at: at(h) });
const STOP = stopped('implement', 'A check failed.', 'agent:needs-human');
const item = (number, comments = [], o = {}) => ({ number, kind: 'issue', title: `Item ${number}`, labels: ['agent:needs-human'],
  comments, headRef: null, ...o });

test('the stop is the newest stop comment by the owner; the answers are the owner\'s later own comments', () => {
  const older = stopped('plan', 'Old.', 'agent:needs-human');
  const comments = [says(older, 1), says('an old answer', 2), says(STOP, 3), says('do X', 4), says('🏭 **Factory opened', 5),
    says('not the owner', 6, 'someone'), says('and Y', 7)];
  assert.deepEqual(stopOf(comments, OWNER), { stop: STOP, at: at(3), answers: ['do X', 'and Y'] });
});

test('a did-not-start comment counts as a stop; one by someone else does not', () => {
  const dns = didNotStart('issue body changed', 'agent:needs-human');
  assert.equal(stopOf([says(dns, 1), says(STOP, 2, 'someone')], 'Dennis-Brutski').stop, dns);
});

test('no stop comment: the label was set by hand; the answers are all the owner\'s own comments', () => {
  assert.deepEqual(stopOf([says('look at this', 1), says('🏭 **Factory opened', 2)], OWNER),
    { stop: null, at: null, answers: ['look at this'] });
});

test('the worktree of an issue, and of a pull request through its branch', () => {
  assert.equal(worktreeOf(item(7), cfg), '/f/runs/web/worktrees/issue-7');
  assert.equal(worktreeOf(item(30, [], { kind: 'pr', headRef: 'factory/issue-7' }), cfg), '/f/runs/web/worktrees/issue-7');
  assert.equal(worktreeOf(item(31, [], { kind: 'pr', headRef: 'feature' }), cfg), '/f/runs/web/worktrees/issue-31');
});

test('inboxOf: only agent:needs-human items, oldest stop first, hand-set labels last', () => {
  const items = [
    item(1, [says(STOP, 5)]),
    item(2, [says(STOP, 3)], { kind: 'pr', headRef: 'factory/issue-9' }),
    item(3, [says(STOP, 1)], { labels: ['agent:implement'] }),
    item(4, [says('hand', 2)]),
  ];
  const exists = (p) => p.endsWith('issue-9');
  assert.deepEqual(inboxOf(items, cfg, exists), [
    { number: 2, kind: 'pr', title: 'Item 2', url: 'https://github.com/me/web/pull/2', stop: STOP, answers: [], worktree: '/f/runs/web/worktrees/issue-9' },
    { number: 1, kind: 'issue', title: 'Item 1', url: 'https://github.com/me/web/issues/1', stop: STOP, answers: [], worktree: null },
    { number: 4, kind: 'issue', title: 'Item 4', url: 'https://github.com/me/web/issues/4', stop: null, answers: ['hand'], worktree: null },
  ]);
});
