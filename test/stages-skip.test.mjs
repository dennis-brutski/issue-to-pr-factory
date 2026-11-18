import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.mjs';
import scorePad from '../targets/gin-rummy-score-pad.mjs';
import { paths } from '../lib/workspace.mjs';
import { runItem } from '../lib/stages.mjs';

const T = '2026-11-01T10:00:00Z';
const ok = (output) => ({ ok: true, output, reason: '', sessionId: 's' });
const issue = {
  number: 1, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
  labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }],
  comments: [], headRef: null, headRepo: null,
};

function deps(testDiff) {
  const opened = [], diffs = [];
  const queue = [ok({ confidence: 90, questions: [] }), ok({ status: 'complete', summary: 'Done.', detail: '' }), ok({ verdict: 'clean', findings: [] })];
  const d = {
    cfg: { ...config, ...scorePad }, root: '/f', log: () => {},
    runSetup: async () => ({ ok: true, failed: null, output: '' }),
    runAgent: async () => queue.shift() ?? (() => { throw new Error('unexpected agent call'); })(),
    runChecks: async () => ({ ok: true, failed: null, output: '' }),
    gh: {
      addLabel: async () => {}, removeLabel: async () => {}, comment: async () => {}, findPullRequest: async () => null,
      openPullRequest: async (cfg, pr) => { opened.push(pr); return { number: 50, url: 'https://github.com/x/y/pull/50' }; },
      setDraft: async () => {}, updatePullRequestBody: async () => {},
    },
    ws: {
      paths,
      ensureWorktree: async (root, n) => ({ dir: `/f/worktrees/issue-${n}`, created: true }),
      headInfo: async () => ({ sha: 'abc', committedAt: T }),
      changesAgainstBase: async () => [{ status: 'A', path: 'test/undo.test.js' }],
      commitMessagesAgainstBase: async () => ['Fix undo'],
      isClean: async () => true,
      diffAgainstBase: async (dir, base, pathspec) => { diffs.push(pathspec); return testDiff; },
      mergeBase: async () => 'clean', mergeResolved: async () => true, push: async () => {},
      currentBranch: async () => 'factory/issue-1', checkCloneConfig: async () => {}, checkGitLink: async () => {},
    },
  };
  return { d, opened, diffs };
}

test('a skipped test in the test folders makes the pull request a draft', async () => {
  const { d, opened, diffs } = deps("+++ b/test/undo.test.js\n+test.skip('undo', () => {})");
  const r = await runItem(issue, 'implement', d, 4201);
  assert.equal(opened[0].draft, true);
  assert.match(opened[0].body, /test skipped or singled out/);
  assert.match(r.detail, /test skipped or singled out/);
  assert.deepEqual(diffs.at(-1), scorePad.testDirs);
});

test('new tests without skips open a ready pull request', async () => {
  const { d, opened } = deps("+++ b/test/undo.test.js\n+test('undo', () => {})");
  const r = await runItem(issue, 'implement', d, 4201);
  assert.equal(r.outcome, 'done');
  assert.equal(opened[0].draft, false);
});
