// An agent that left HEAD detached on top of its branch does not cost the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.mjs';
import scorePad from '../targets/gin-rummy-score-pad.mjs';
import { runItem } from '../lib/stages.mjs';
import { fakeWorkspace } from './fakes/workspace.mjs';

const T = '2026-11-01T10:00:00Z';
const ok = (output) => ({ ok: true, output, reason: '', sessionId: 's' });
const issue = {
  number: 1, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
  labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }],
  comments: [], headRef: null, headRepo: null,
};

function deps(branchAfter, attaches) {
  const pushed = [], logs = [], attached = [];
  let onBranch = true;
  const queue = [ok({ confidence: 90, questions: [] }), ok({ status: 'complete', summary: 'Done.', detail: '' }), ok({ verdict: 'clean', findings: [] })];
  const d = {
    cfg: { ...config, ...scorePad }, root: '/f', log: (m) => logs.push(m),
    runSetup: async () => ({ ok: true, failed: null, output: '' }),
    runAgent: async () => { const r = queue.shift(); if (!queue.length) onBranch = false; return r; },
    runChecks: async () => ({ ok: true, failed: null, output: '' }),
    gh: {
      addLabel: async () => {}, removeLabel: async () => {}, comment: async () => {}, findPullRequest: async () => null,
      openPullRequest: async () => ({ number: 50, url: 'https://github.com/x/y/pull/50' }),
      setDraft: async () => {}, updatePullRequestBody: async () => {},
    },
    ws: fakeWorkspace({
      currentBranch: async () => (onBranch ? 'factory/issue-1' : branchAfter),
      attachBranch: async (dir, branch) => { attached.push(branch); if (attaches) onBranch = true; return attaches; },
      push: async (dir, branch, sha) => { pushed.push([branch, sha]); },
    }),
  };
  return { d, pushed, logs, attached };
}

test('detached on top of the branch: the branch is moved, then pushed', async () => {
  const { d, pushed, logs, attached } = deps(null, true);
  const r = await runItem(issue, 'implement', d, 4201);
  assert.equal(r.outcome, 'done', r.detail);
  assert.deepEqual(attached, ['factory/issue-1']);
  assert.deepEqual(pushed, [['factory/issue-1', 'abc']]);
  assert.ok(logs.some((m) => /#1 HEAD was detached; moved factory\/issue-1 to abc/.test(m)), logs.join('\n'));
});

test('detached somewhere else: parks as before, no push', async () => {
  const { d, pushed } = deps(null, false);
  const r = await runItem(issue, 'implement', d, 4201);
  assert.equal(r.outcome, 'parked');
  assert.match(r.detail, /HEAD is detached/);
  assert.deepEqual(pushed, []);
});

test('on another branch: parks as before and does not try to move anything', async () => {
  const { d, pushed, attached } = deps('main', true);
  const r = await runItem(issue, 'implement', d, 4201);
  assert.equal(r.outcome, 'parked');
  assert.match(r.detail, /HEAD is on `main`/);
  assert.deepEqual([pushed, attached], [[], []]);
});
