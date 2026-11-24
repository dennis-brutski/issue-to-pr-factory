// The stop reason must survive the base merge at the start of a run: that merge moves HEAD to a newer commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from './fixtures/config.mjs';
import scorePad from './fixtures/web-app-target.mjs';
import { runItem } from '../lib/stages.mjs';
import { fakeWorkspace } from './fakes/workspace.mjs';

const T = '2026-11-01T10:00:00Z', T2 = '2026-11-01T11:00:00Z', T3 = '2026-11-01T12:00:00Z';
const ok = (output) => ({ ok: true, output, reason: '', sessionId: 's' });
const issue = {
  number: 1, kind: 'issue', title: 'Fix undo', body: 'Undo fails on an empty ledger', author: 'dennis-brutski', bodyEditedAt: null,
  labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }],
  comments: [], headRef: null, headRepo: null,
};

test('a base merge after the park does not hide the stop reason from implement', async () => {
  const root = mkdtempSync(join(tmpdir(), 'factory-stop-merge-'));
  const calls = [], posted = [];
  let agent = [ok({ confidence: 90, questions: [] }), ok({ status: 'complete', summary: 's', detail: '' }), ok({ verdict: 'clean', findings: [] })];
  let checks = { ok: false, failed: 'npm test', output: 'AssertionError: RED-OUTPUT 1 !== 2' };
  let committedAt = T;
  const deps = {
    cfg: { ...config, ...scorePad }, root, log: () => {},
    runSetup: async () => ({ ok: true, failed: null, output: '' }),
    runAgent: async (a) => { calls.push(a); const r = agent.shift(); if (!r) throw new Error('unexpected agent call'); return r; },
    runChecks: async () => checks,
    gh: {
      addLabel: async () => {}, removeLabel: async () => {},
      comment: async (c, n, body) => { posted.push({ author: 'dennis-brutski', body, at: T2 }); },
      findPullRequest: async () => null,
      openPullRequest: async () => ({ number: 50, url: 'https://github.com/x/y/pull/50' }),
      setDraft: async () => {}, updatePullRequestBody: async () => {},
    },
    ws: fakeWorkspace({
      ensureWorktree: async (n) => ({ dir: join(root, 'worktrees', `issue-${n}`), created: false }),
      headInfo: async () => ({ sha: `abc-${committedAt}`, committedAt }),
      commitMessagesAgainstBase: async () => ['Fix undo on empty ledger'],
      // main moved while the item waited: merging it makes a merge commit newer than the park comment.
      mergeBase: async () => { if (posted.length) committedAt = T3; return 'clean'; },
    }, root),
  };
  assert.equal((await runItem(issue, 'implement', deps, 4201)).outcome, 'parked');
  calls.length = 0;
  agent = [ok({ confidence: 90, questions: [] }), ok({ status: 'complete', summary: 's', detail: '' }), ok({ verdict: 'clean', findings: [] })];
  checks = { ok: true, failed: null, output: '' };
  assert.equal((await runItem({ ...issue, comments: posted }, 'implement', deps, 4201)).outcome, 'done');
  const implement = calls.find((a) => a.logFile.endsWith('-implement.json')).prompt;
  assert.ok(implement.includes('## Why the last run stopped'));
  assert.match(implement, /RED-OUTPUT/);
});
