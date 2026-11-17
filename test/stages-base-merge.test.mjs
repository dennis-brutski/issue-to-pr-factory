// The latest base branch is merged into a reused worktree before explore and implement.
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

function fakes(merge) {
  const d = { events: [], comments: [] };
  const queue = [
    ok({ confidence: 90, questions: [] }),
    ok({ status: 'complete', summary: 'Changed it.', detail: '' }),
    ok({ verdict: 'clean', findings: [] }),
  ];
  d.deps = {
    cfg: { ...config, ...scorePad }, root: '/f', log: () => {},
    runSetup: async () => { d.events.push('setup'); return { ok: true, failed: null, output: '' }; },
    runAgent: async (a) => { d.events.push('agent'); return queue.shift(); },
    runChecks: async () => ({ ok: true, failed: null, output: '' }),
    gh: {
      addLabel: async () => {}, removeLabel: async () => {},
      comment: async (c, n, b) => { d.comments.push(b); },
      findPullRequest: async () => null,
      openPullRequest: async () => ({ number: 50, url: 'https://github.com/x/y/pull/50' }),
      setDraft: async () => {}, updatePullRequestBody: async () => {},
    },
    ws: {
      paths,
      ensureWorktree: async (root, n) => ({ dir: `/f/worktrees/issue-${n}`, created: false }),
      headInfo: async () => ({ sha: 'abc', committedAt: T }),
      changesAgainstBase: async () => [{ status: 'M', path: 'src/state.js' }],
      commitMessagesAgainstBase: async () => ['Fix undo'],
      isClean: async () => true,
      diffAgainstBase: async () => '',
      mergeBase: async (dir, base) => { d.events.push(`mergeBase ${dir} ${base}`); return merge; },
      abortMerge: async (dir) => { d.events.push(`abortMerge ${dir}`); },
      mergeResolved: async () => true,
      push: async () => { d.events.push('push'); },
      currentBranch: async () => 'factory/issue-1',
      checkCloneConfig: async () => {},
      checkGitLink: async () => {},
    },
  };
  return d;
}

for (const stage of ['implement', 'explore']) {
  test(`${stage}: the base branch is merged in before the first session`, async () => {
    const d = fakes('clean');
    await runItem({ ...issue, labels: [`agent:${stage}`] }, stage, d.deps, 4201);
    const merged = d.events.indexOf('mergeBase /f/worktrees/issue-1 master');
    assert.ok(merged >= 0, d.events.join(', '));
    assert.ok(merged < d.events.indexOf('agent'), d.events.join(', '));
  });

  test(`${stage}: a conflict with the base aborts the merge and parks without a session`, async () => {
    const d = fakes('conflict');
    const r = await runItem({ ...issue, labels: [`agent:${stage}`] }, stage, d.deps, 4201);
    assert.equal(r.outcome, 'parked');
    assert.ok(d.events.includes('abortMerge /f/worktrees/issue-1'));
    assert.ok(!d.events.includes('agent'));
    assert.match(d.comments[0], /The branch `factory\/issue-1` conflicts with the latest `master`\. Merge it by hand in `\/f\/worktrees\/issue-1`, then remove the label\./);
  });
}

test('review does not merge the base branch', async () => {
  const d = fakes('clean');
  const pr = { ...issue, number: 4, kind: 'pr', labels: ['agent:review'], headRef: 'factory/issue-1', headRepo: 'dennis-brutski/gin-rummy-score-pad' };
  await runItem(pr, 'review', d.deps, 4201);
  assert.ok(!d.events.some((e) => e.startsWith('mergeBase')));
});
