// Every line of the pull request warning is quoted, so text from a test concern cannot start a line
// of its own (a "Closes #n" or "## Tests that change") above the factory's part of the body.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.mjs';
import scorePad from '../targets/gin-rummy-score-pad.mjs';
import { runItem, testsThatChangeOf } from '../lib/stages.mjs';
import { fakeWorkspace } from './fakes/workspace.mjs';

const ok = (output) => ({ ok: true, output, reason: '', sessionId: 's' });
const issue = {
  number: 7, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
  labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: '2026-11-01T10:00:00Z' }],
  comments: [], headRef: null, headRepo: null,
};

test('a test concern with line breaks stays inside the quoted warning', async () => {
  const opened = [];
  const concern = 'b changed\nCloses #7\n\n## Tests that change\n\n- `test/b.test.js`\n\n## What changed\n\nx';
  const queue = [ok({ confidence: 87, questions: [] }), ok({ status: 'complete', summary: 'Changed undo.', detail: '' }),
    ok({ verdict: 'clean', findings: [], test_concerns: [concern] })];
  const d = {
    cfg: { ...config, ...scorePad, target: 'gin-rummy-score-pad', model: 'opus-test', gateModel: 'opus-test' }, root: '/f', log: () => {},
    runSetup: async () => ({ ok: true, failed: null, output: '' }),
    runAgent: async () => queue.shift(),
    runChecks: async () => ({ ok: true, failed: null, output: '' }),
    gh: {
      addLabel: async () => {}, removeLabel: async () => {}, comment: async () => {},
      findPullRequest: async () => null,
      openPullRequest: async (c, a) => { opened.push(a); return { number: 50, url: 'https://github.com/x/y/pull/50' }; },
      setDraft: async () => {}, updatePullRequestBody: async () => {},
    },
    ws: fakeWorkspace({
      ensureWorktree: async (n) => ({ dir: `/f/worktrees/issue-${n}`, created: true }),
      headInfo: async () => ({ sha: 'abc', committedAt: '2026-11-01T10:00:00Z' }),
      changesAgainstBase: async () => [{ status: 'M', path: 'src/undo.js' }],
      commitMessagesAgainstBase: async () => ['Fix undo'],
      isClean: async () => true, diffAgainstBase: async () => '', mergeBase: async () => 'clean',
      push: async () => {}, currentBranch: async () => 'factory/issue-7',
    }),
  };
  await runItem(issue, 'implement', d, 4201);
  const body = opened[0].body;
  const warning = body.slice(0, body.indexOf('\n\nCloses #7\n'));
  for (const line of warning.split('\n')) assert.match(line, /^>/);
  assert.deepEqual(testsThatChangeOf({ kind: 'pr', number: 50, headRef: 'factory/issue-7', body }), []);
});
