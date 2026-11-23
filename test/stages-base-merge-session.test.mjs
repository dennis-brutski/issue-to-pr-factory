// explore and implement resolve a conflict with the base with a merge session, as the merge stage does.
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

function fakes({ merge = 'conflict', resolved = true, before = { park: null, flags: [] } } = {}) {
  const d = { events: [], comments: [], sessions: [] };
  d.deps = {
    cfg: { ...config, ...scorePad }, root: '/f', log: () => {},
    runSetup: async () => { d.events.push('setup'); return { ok: true, failed: null, output: '' }; },
    runAgent: async (a) => {
      const name = a.prompt.split('\n')[0].replace(/<!-- session: (\w+) -->/, '$1');
      d.sessions.push(name); d.events.push(`session ${name}`);
      return ok({ status: 'complete', summary: 'Merged.', detail: 'Could not decide.' });
    },
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
      mergeBase: async () => { d.events.push('mergeBase'); return merge; },
      abortMerge: async () => { d.events.push('abortMerge'); },
      mergeResolved: async () => { d.events.push('mergeResolved'); return resolved; },
    }),
  };
  return d;
}

for (const stage of ['implement', 'explore']) {
  test(`${stage}: a merge session that leaves the merge unresolved parks and runs no other session`, async () => {
    const d = fakes({ resolved: false });
    const r = await runItem({ ...issue, labels: [`agent:${stage}`] }, stage, d.deps, 4201);
    assert.equal(r.outcome, 'parked');
    assert.deepEqual(d.sessions, ['merge']);
    assert.match(d.comments.at(-1), /The merge is still unresolved\. The worktree is left mid-merge\.\n\nCould not decide\./);
  });

  test(`${stage}: the merge session runs after setup, on a fresh merge`, async () => {
    const d = fakes();
    await runItem({ ...issue, labels: [`agent:${stage}`] }, stage, d.deps, 4201);
    const setup = d.events.indexOf('setup');
    assert.ok(setup >= 0, d.events.join(', '));
    assert.equal(d.events[setup + 1], 'mergeBase', d.events.join(', '));
    assert.equal(d.events[setup + 2], 'session merge', d.events.join(', '));
    assert.equal(d.events[setup + 3], 'mergeResolved', d.events.join(', '));
  });

  test(`${stage}: setup does not run on a half-merged tree`, async () => {
    const d = fakes();
    await runItem({ ...issue, labels: [`agent:${stage}`] }, stage, d.deps, 4201);
    const setup = d.events.indexOf('setup');
    assert.ok(d.events.slice(0, setup).lastIndexOf('abortMerge') > d.events.slice(0, setup).lastIndexOf('mergeBase'), d.events.join(', '));
  });

  test(`${stage}: a clean merge with the base runs no merge session`, async () => {
    const d = fakes({ merge: 'clean' });
    await runItem({ ...issue, labels: [`agent:${stage}`] }, stage, d.deps, 4201);
    assert.ok(!d.sessions.includes('merge'), d.sessions.join(', '));
  });
}

test('review runs no merge session', async () => {
  const d = fakes();
  const pr = { ...issue, number: 4, kind: 'pr', labels: ['agent:review'], headRef: 'factory/issue-1', headRepo: 'dennis-brutski/gin-rummy-score-pad' };
  await runItem(pr, 'review', d.deps, 4201);
  assert.ok(!d.sessions.includes('merge'), d.sessions.join(', '));
  assert.ok(!d.events.includes('mergeBase'));
});
