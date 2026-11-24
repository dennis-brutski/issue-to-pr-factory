// With autoMerge on, a small, simple, cleanly reviewed implement run hands its pull request to GitHub's auto-merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from './fixtures/config.mjs';
import scorePad from './fixtures/web-app-target.mjs';
import { runItem } from '../lib/stages.mjs';
import { fakeWorkspace } from './fakes/workspace.mjs';

const ok = (output) => ({ ok: true, output, reason: '', sessionId: 's' });
const T = '2026-11-01T10:00:00Z';
const issue = {
  number: 7, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
  labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }],
  comments: [], headRef: null, headRepo: null,
};
const pullRequestItem = { ...issue, number: 50, kind: 'pr', labels: ['agent:review'], labelEvents: [{ label: 'agent:review', actor: 'dennis-brutski', at: T }],
  comments: [{ author: 'dennis-brutski', body: 'Rename it.', at: '2026-11-01T11:00:00Z' }], headRef: 'factory/issue-7', headRepo: 'x/y' };
const gate = (difficulty = 'simple') => ({ confidence: 90, questions: [], difficulty, files: ['src/a.js'] });
const work = ok({ status: 'complete', summary: 'Changed undo.', detail: '' });
const clean = ok({ verdict: 'clean', findings: [] });
const findings = ok({ verdict: 'findings', findings: ['Missing test for redo'] });

function deps({ sessions, autoMerge = true, size = { additions: 30, deletions: 10 }, mergeFails = null, protectedChange = false, existing = null } = {}) {
  const calls = [], comments = [], labels = [], seen = [];
  const queue = [...sessions];
  let commits = 0;
  const d = {
    cfg: { ...config, ...scorePad, target: 'web-app', autoMerge }, root: '/f', log: () => {},
    runSetup: async () => ({ ok: true, failed: null, output: '' }),
    runAgent: async (a) => {
      seen.push(a.prompt.match(/<!-- session: (\w+) -->/)[1]);
      if (!a.readOnly) commits++;
      return queue.shift() ?? { ok: false, reason: 'no more scripted sessions' };
    },
    runChecks: async () => ({ ok: true, failed: null, output: '' }),
    gh: {
      addLabel: async (c, n, l) => { labels.push(l); }, removeLabel: async () => {},
      comment: async (c, n, body) => { comments.push(body); },
      findPullRequest: async () => existing,
      openPullRequest: async (c, a) => { calls.push(['open', a.draft]); return { number: 50, url: 'https://github.com/x/y/pull/50' }; },
      setDraft: async () => {}, updatePullRequestBody: async () => {},
      pullRequestSize: async (c, n) => { calls.push(['size', n]); return size; },
      autoMerge: async (c, n) => { calls.push(['merge', n]); if (mergeFails) throw new Error(mergeFails); },
    },
    ws: fakeWorkspace({
      headInfo: async () => ({ sha: `abc${commits}`, committedAt: T }),
      changesAgainstBase: async () => [{ status: 'M', path: protectedChange ? 'package.json' : 'src/state.js' }],
    }),
  };
  return { d, calls, comments, labels, seen };
}

const merges = (x) => x.calls.filter((c) => c[0] === 'merge');

test('all five hold: the pull request is handed to auto-merge and a comment says why', async () => {
  const x = deps({ sessions: [ok(gate()), work, clean] });
  const r = await runItem(issue, 'implement', x.d, 4201);
  assert.equal(r.outcome, 'done', r.detail);
  assert.deepEqual(merges(x), [['merge', 50]]);
  const note = x.comments.find((b) => b.startsWith('🏭 **Auto-merge**'));
  assert.ok(note, x.comments.join('\n---\n'));
  assert.match(note, /simple/);
  assert.match(note, /review clean/);
  assert.match(note, /40 lines/);
  assert.match(note, /not a draft/);
  assert.match(note, /https:\/\/github\.com\/x\/y\/pull\/50/);
  assert.match(r.detail, /^https:\/\/github\.com\/x\/y\/pull\/50 \(handed to auto-merge\)$/);
});

test('a normal issue is not auto-merged, and the log line says why', async () => {
  const x = deps({ sessions: [ok(gate('normal')), work, clean] });
  const r = await runItem(issue, 'implement', x.d, 4201);
  assert.equal(r.outcome, 'done', r.detail);
  assert.deepEqual(merges(x), []);
  assert.match(r.detail, /^https:\/\/github\.com\/x\/y\/pull\/50 \(not auto-merged: not simple \(normal\)\)$/);
  assert.ok(!x.comments.some((b) => b.includes('Auto-merge')));
});

test('100 lines or more is not auto-merged', async () => {
  const x = deps({ sessions: [ok(gate()), work, clean], size: { additions: 60, deletions: 40 } });
  const r = await runItem(issue, 'implement', x.d, 4201);
  assert.equal(r.outcome, 'done', r.detail);
  assert.deepEqual(merges(x), []);
  assert.match(r.detail, /\(not auto-merged: 100 lines changed, needs fewer than 100\)$/);
  assert.ok(!x.comments.some((b) => b.includes('Auto-merge')));
});

test('a draft is not auto-merged', async () => {
  const x = deps({ sessions: [ok(gate()), work, clean], protectedChange: true });
  const r = await runItem(issue, 'implement', x.d, 4201);
  assert.equal(r.outcome, 'parked'); // as today: a draft parks
  assert.deepEqual(x.calls.filter((c) => c[0] !== 'open'), []);
});

test('a pull request left a draft by an earlier run is not auto-merged, and the log line says so', async () => {
  const x = deps({ sessions: [ok(gate()), work, clean], existing: { number: 50, url: 'https://github.com/x/y/pull/50', isDraft: true } });
  const r = await runItem(issue, 'implement', x.d, 4201);
  assert.equal(r.outcome, 'done', r.detail);
  assert.deepEqual(merges(x), []);
  assert.match(r.detail, /\(not auto-merged: draft\)$/);
  assert.ok(!x.comments.some((b) => b.includes('Auto-merge')));
});

test('a review whose findings come back after the fix is not auto-merged; the pull request still opens', async () => {
  const x = deps({ sessions: [ok(gate()), work, findings, ok({ status: 'complete', summary: 'Fixed.', detail: '' }), findings] });
  const r = await runItem(issue, 'implement', x.d, 4201);
  assert.equal(r.outcome, 'done', r.detail);
  assert.deepEqual(x.seen, ['gate', 'implement', 'review', 'fix', 'review']);
  assert.deepEqual(x.calls.filter((c) => c[0] === 'open'), [['open', false]]);
  assert.deepEqual(merges(x), []);
  assert.match(r.detail, /\(not auto-merged: review not clean after the fix\)$/);
  assert.ok(!x.labels.includes('agent:needs-human'));
});

test('findings, a fix, then a clean second review: auto-merged', async () => {
  const x = deps({ sessions: [ok(gate()), work, findings, ok({ status: 'complete', summary: 'Fixed.', detail: '' }), clean] });
  const r = await runItem(issue, 'implement', x.d, 4201);
  assert.equal(r.outcome, 'done', r.detail);
  assert.deepEqual(x.seen, ['gate', 'implement', 'review', 'fix', 'review']);
  assert.deepEqual(merges(x), [['merge', 50]]);
  assert.match(x.comments.find((b) => b.startsWith('🏭 **Auto-merge**')), /review clean after fix/);
});

test('a findings verdict with no findings is not a clean review', async () => {
  const x = deps({ sessions: [ok(gate()), work, ok({ verdict: 'findings', findings: [] })] });
  const r = await runItem(issue, 'implement', x.d, 4201);
  assert.equal(r.outcome, 'done', r.detail);
  assert.deepEqual(merges(x), []);
  assert.match(r.detail, /\(not auto-merged: review not clean\)$/);
});

test('autoMerge off: no second review, no size or merge call, the log line as before', async () => {
  const x = deps({ autoMerge: false, sessions: [ok(gate()), work, findings, ok({ status: 'complete', summary: 'Fixed.', detail: '' })] });
  const r = await runItem(issue, 'implement', x.d, 4201);
  assert.equal(r.outcome, 'done', r.detail);
  assert.deepEqual(x.seen, ['gate', 'implement', 'review', 'fix']);
  assert.deepEqual(x.calls, [['open', false]]);
  assert.equal(r.detail, 'https://github.com/x/y/pull/50');
});

test('autoMerge unset counts as off', async () => {
  const x = deps({ sessions: [ok(gate()), work, clean] });
  delete x.d.cfg.autoMerge;
  const r = await runItem(issue, 'implement', x.d, 4201);
  assert.deepEqual(x.calls, [['open', false]]);
  assert.equal(r.detail, 'https://github.com/x/y/pull/50');
});

test('a failed merge call is reported in a comment, and the run still ends done', async () => {
  const x = deps({ sessions: [ok(gate()), work, clean], mergeFails: 'gh pr merge failed: Auto merge is not allowed for this repository' });
  const r = await runItem(issue, 'implement', x.d, 4201);
  assert.equal(r.outcome, 'done', r.detail);
  assert.ok(!x.labels.includes('agent:needs-human'));
  assert.ok(x.labels.includes('agent:done'));
  const note = x.comments.find((b) => b.includes('Auto merge is not allowed'));
  assert.ok(note, x.comments.join('\n---\n'));
  assert.ok(note.startsWith('🏭'));
  assert.ok(!note.startsWith('🏭 **Auto-merge**'), 'stats must not count a failed hand-over');
  assert.match(note, /merge it by hand/i);
  assert.match(r.detail, /\(not auto-merged: the merge call failed\)$/);
});

test('if the size cannot be read, it is not auto-merged and the run still ends done', async () => {
  const x = deps({ sessions: [ok(gate()), work, clean] });
  x.d.gh.pullRequestSize = async () => { throw new Error('gh pr view failed: boom'); };
  const r = await runItem(issue, 'implement', x.d, 4201);
  assert.equal(r.outcome, 'done', r.detail);
  assert.deepEqual(merges(x), []);
  assert.match(r.detail, /\(not auto-merged: could not read its size: gh pr view failed: boom\)$/);
});

test('a rework run never auto-merges', async () => {
  const x = deps({ sessions: [work] });
  const r = await runItem(pullRequestItem, 'review', x.d, 4201);
  assert.equal(r.outcome, 'done', r.detail);
  assert.deepEqual(x.calls, []);
});

test('a merge run never auto-merges', async () => {
  const x = deps({ sessions: [] });
  const r = await runItem({ ...pullRequestItem, labels: ['agent:merge'] }, 'merge', x.d, 4201);
  assert.equal(r.outcome, 'done', r.detail);
  assert.deepEqual(x.calls, []);
});
