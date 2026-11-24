// A stop for a draft tells the owner to read the flagged changes, not to try again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from './fixtures/config.mjs';
import scorePad from './fixtures/web-app-target.mjs';
import { runItem } from '../lib/stages.mjs';
import { fakeWorkspace } from './fakes/workspace.mjs';

const ok = (output) => ({ ok: true, output, reason: '', sessionId: 's' });
const issue = {
  number: 7, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
  labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: '2026-11-01T10:00:00Z' }],
  comments: [], headRef: null, headRepo: null,
};
const pr = { ...issue, kind: 'pr', headRef: 'factory/issue-7', labels: ['agent:merge'] };

function deps() {
  const opened = [], comments = [];
  const queue = [ok({ confidence: 87, questions: [] }), ok({ status: 'complete', summary: 'Changed undo.', detail: '' }), ok({ verdict: 'clean', findings: [] })];
  let sessions = 0;
  const d = {
    cfg: { ...config, ...scorePad, target: 'web-app', model: 'opus-test', gateModel: 'opus-test' }, root: '/f', log: () => {},
    runSetup: async () => ({ ok: true, failed: null, output: '' }),
    runAgent: async (a) => { if (!a.readOnly) sessions++; return queue.shift(); },
    runChecks: async () => ({ ok: true, failed: null, output: '' }),
    gh: {
      addLabel: async () => {}, removeLabel: async () => {}, comment: async (c, n, body) => { comments.push(body); },
      findPullRequest: async () => null,
      openPullRequest: async (c, a) => { opened.push(a); return { number: 50, url: 'https://github.com/x/y/pull/50' }; },
      setDraft: async () => {}, updatePullRequestBody: async () => {},
    },
    ws: fakeWorkspace({
      ensureWorktree: async (n) => ({ dir: `/f/worktrees/issue-${n}`, created: true }),
      headInfo: async () => ({ sha: `abc${sessions}`, committedAt: '2026-11-01T10:00:00Z' }),
      changesAgainstBase: async () => [{ status: 'M', path: 'test/unit/scoring.test.js' }],
      commitMessagesAgainstBase: async () => ['Fix undo'],
      isClean: async () => true, diffAgainstBase: async () => '', mergeBase: async () => 'clean',
      push: async () => {}, currentBranch: async () => 'factory/issue-7',
    }),
  };
  return { d, opened, comments };
}

function assertDraftStop(body) {
  assert.match(body, /^🏭 \*\*Factory stopped \(/);
  assert.doesNotMatch(body, /touches protected files/);
  assert.doesNotMatch(body, /try again/);
  assert.doesNotMatch(body, /local branch/);
  assert.match(body, /mark it ready/);
  assert.match(body, /`agent:review`/);
  assert.match(body, /test\/unit\/scoring\.test\.js/);
}

test('an implement draft stop says to read the changes, not to try again', async () => {
  const { d, comments, opened } = deps();
  const r = await runItem(issue, 'implement', d, 4201);
  assert.equal(r.outcome, 'parked');
  assertDraftStop(comments.at(-1));
  assert.doesNotMatch(opened[0].body, /touches protected files/);
  assert.match(opened[0].body, /^> ⚠ This pull request changes files you should check:/);
});

test('a rework draft stop says to read the changes, not to try again', async () => {
  const asked = { ...pr, labels: ['agent:review'], comments: [{ author: 'dennis-brutski', body: 'Rename it.', at: '2026-11-05T10:00:00Z' }] };
  const { d, comments } = deps();
  d.runAgent = async () => ok({ status: 'complete', summary: 'Renamed.', detail: '' });
  let n = 0;
  d.ws.headInfo = async () => ({ sha: `abc${n++}`, committedAt: '2026-11-01T10:00:00Z' });
  const r = await runItem(asked, 'review', d, 4201);
  assert.equal(r.outcome, 'parked');
  assertDraftStop(comments.at(-1));
});

test('a merge draft stop says to read the changes, not to try again', async () => {
  const { d, comments } = deps();
  const r = await runItem(pr, 'merge', d, 4201);
  assert.equal(r.outcome, 'parked');
  assertDraftStop(comments.at(-1));
});
