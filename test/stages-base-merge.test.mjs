// The latest base branch is merged into a reused worktree before explore and implement.
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
    ws: fakeWorkspace({
      ensureWorktree: async (n) => ({ dir: `/f/worktrees/issue-${n}`, created: false }),
      mergeBase: async (dir) => { d.events.push(`mergeBase ${dir}`); return merge; },
      abortMerge: async (dir) => { d.events.push(`abortMerge ${dir}`); },
      push: async () => { d.events.push('push'); },
    }),
  };
  return d;
}

for (const stage of ['implement', 'explore']) {
  test(`${stage}: the base branch is merged in before the first session`, async () => {
    const d = fakes('clean');
    await runItem({ ...issue, labels: [`agent:${stage}`] }, stage, d.deps, 4201);
    const merged = d.events.indexOf('mergeBase /f/worktrees/issue-1');
    assert.ok(merged >= 0, d.events.join(', '));
    assert.ok(merged < d.events.indexOf('agent'), d.events.join(', '));
  });

  test(`${stage}: a conflict with the base runs a merge session after setup and does not park`, async () => {
    const d = fakes('conflict');
    const queue = stage === 'explore'
      ? [ok({ status: 'complete', summary: 'Merged.', detail: '' }), ok({ writeup: 'Fine.', easy_to_undo: true, small_reach: true })]
      : [ok({ status: 'complete', summary: 'Merged.', detail: '' }), ok({ confidence: 90, questions: [] }),
        ok({ status: 'complete', summary: 'Changed it.', detail: '' }), ok({ verdict: 'clean', findings: [] })];
    const sessions = [];
    d.deps.runAgent = async (a) => { sessions.push(a.prompt.split('\n')[0]); d.events.push('agent'); return queue.shift(); };
    const r = await runItem({ ...issue, labels: [`agent:${stage}`] }, stage, d.deps, 4201);
    assert.notEqual(r.outcome, 'parked', r.detail);
    assert.equal(sessions[0], '<!-- session: merge -->');
    assert.equal(sessions.filter((s) => s === '<!-- session: merge -->').length, 1);
    assert.ok(sessions.length > 1, sessions.join(', '));
    assert.ok(d.events.indexOf('setup') < d.events.indexOf('agent'), d.events.join(', '));
    assert.ok(!d.comments.some((c) => /Merge it by hand/.test(c)));
  });
}

test('review does not merge the base branch', async () => {
  const d = fakes('clean');
  const pr = { ...issue, number: 4, kind: 'pr', labels: ['agent:review'], headRef: 'factory/issue-1', headRepo: 'example/web-app' };
  await runItem(pr, 'review', d.deps, 4201);
  assert.ok(!d.events.some((e) => e.startsWith('mergeBase')));
});
