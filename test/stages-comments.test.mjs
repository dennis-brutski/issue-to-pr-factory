import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.mjs';
import scorePad from '../targets/gin-rummy-score-pad.mjs';
import { runItem } from '../lib/stages.mjs';
import { fakeWorkspace } from './fakes/workspace.mjs';

const T = '2026-11-01T10:00:00Z';
const ok = (output) => ({ ok: true, output, reason: '', sessionId: 's' });
const issue = {
  number: 1, kind: 'issue', title: 'Fix undo', body: 'Undo fails on an empty ledger', author: 'dennis-brutski', bodyEditedAt: null,
  labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }],
  comments: [{ author: 'dennis-brutski', body: 'Keep the empty ledger read-only', at: T }], headRef: null, headRepo: null,
};

function deps(agent) {
  const calls = [];
  const queue = [...agent];
  const d = {
    cfg: { ...config, ...scorePad }, root: '/f', log: () => {},
    runSetup: async () => ({ ok: true, failed: null, output: '' }),
    runAgent: async (a) => { calls.push(a); const r = queue.shift(); if (!r) throw new Error('unexpected agent call'); return r; },
    runChecks: async () => ({ ok: true, failed: null, output: '' }),
    gh: {
      addLabel: async () => {}, removeLabel: async () => {}, comment: async () => {},
      findPullRequest: async () => null,
      openPullRequest: async () => ({ number: 50, url: 'https://github.com/x/y/pull/50' }),
      setDraft: async () => {}, updatePullRequestBody: async () => {},
    },
    ws: fakeWorkspace({
      headInfo: async () => ({ sha: `abc${calls.filter((a) => !a.readOnly).length}`, committedAt: T }),
      commitMessagesAgainstBase: async () => ['Fix undo on empty ledger'],
    }),
  };
  return { d, calls };
}

test("review and fix prompts include the owner's comments", async () => {
  const work = ok({ status: 'complete', summary: 'Changed the undo guard.', detail: '' });
  const { d, calls } = deps([ok({ confidence: 90, questions: [] }), work, ok({ verdict: 'findings', findings: ['x'] }), work]);
  const r = await runItem(issue, 'implement', d, 4201);
  assert.equal(r.outcome, 'done');
  assert.equal(calls.length, 4);
  const [, , reviewCall, fixCall] = calls;
  assert.match(reviewCall.prompt, /### Comments from Dennis\n\n- .*Keep the empty ledger read-only/);
  assert.match(fixCall.prompt, /### Comments from Dennis\n\n- .*Keep the empty ledger read-only/);
});
