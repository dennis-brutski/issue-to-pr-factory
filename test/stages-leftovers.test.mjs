// Sandbox leftovers from this run's sessions are cleared before the factory looks at the worktree and runs the checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.mjs';
import scorePad from './fixtures/web-app-target.mjs';
import { runItem } from '../lib/stages.mjs';
import { fakeWorkspace } from './fakes/workspace.mjs';

const T = '2026-11-01T10:00:00Z';
const ok = (output) => ({ ok: true, output, reason: '', sessionId: 's' });
const issue = {
  number: 1, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
  labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }],
  comments: [], headRef: null, headRepo: null,
};

test('leftovers are removed before the clean check and the checks', async () => {
  const order = [];
  const queue = [ok({ confidence: 90, questions: [] }), ok({ status: 'complete', summary: 'Done.', detail: '' }), ok({ verdict: 'clean', findings: [] })];
  let sessionsDone = false;
  const d = {
    cfg: { ...config, ...scorePad }, root: '/f', log: () => {},
    runSetup: async () => ({ ok: true, failed: null, output: '' }),
    runAgent: async () => { const r = queue.shift(); if (!queue.length) sessionsDone = true; return r; },
    runChecks: async () => { order.push('checks'); return { ok: true, failed: null, output: '' }; },
    gh: {
      addLabel: async () => {}, removeLabel: async () => {}, comment: async () => {}, findPullRequest: async () => null,
      openPullRequest: async () => ({ number: 50, url: 'https://github.com/x/y/pull/50' }),
      setDraft: async () => {}, updatePullRequestBody: async () => {},
    },
    ws: fakeWorkspace({
      removeSandboxLeftovers: async () => { if (sessionsDone) order.push('leftovers'); },
      isClean: async () => { if (sessionsDone) order.push('clean?'); return true; },
    }),
  };
  const r = await runItem(issue, 'implement', d, 4201);
  assert.equal(r.outcome, 'done', r.detail);
  assert.deepEqual(order.slice(-3), ['leftovers', 'clean?', 'checks']); // earlier: the review's read-only check
});
