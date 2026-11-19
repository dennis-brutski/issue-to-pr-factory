// tick also merges the base branch into the factory's own pull requests that conflict, without a label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config as defaults } from '../config.mjs';
import { tick } from '../lib/loop.mjs';

const config = { ...defaults, repo: 'dennis-brutski/gin-rummy-score-pad' };
const T = '2026-11-01T10:00:00Z';
const issue = (number, o = {}) => ({
  number, kind: 'issue', title: `Issue ${number}`, body: '', author: 'dennis-brutski', bodyEditedAt: null,
  labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }],
  comments: [], headRef: null, headRepo: null, mergeable: null, ...o,
});
const pr = (number, issueNumber, o = {}) => issue(number, {
  kind: 'pr', labels: [], labelEvents: [], headRef: `factory/issue-${issueNumber}`,
  headRepo: 'dennis-brutski/gin-rummy-score-pad', mergeable: 'CONFLICTING', ...o,
});

function fakes({ candidates = [], pulls = [], pullsFail = false, cfg = config } = {}) {
  const d = { started: [], logs: [] };
  d.deps = {
    cfg, log: (m) => d.logs.push(m),
    runItem: async (item, stage) => { d.started.push([item.number, stage]); return { outcome: 'done' }; },
    gh: {
      listCandidates: async () => candidates,
      listPullRequests: async () => { if (pullsFail) throw new Error('GitHub is down'); return pulls; },
      addLabel: async () => {}, removeLabel: async () => {}, comment: async () => {},
    },
  };
  return d;
}
const ticked = async (d, running = new Map()) => {
  const started = await tick(d.deps, running);
  await Promise.all(running.values());
  return started;
};

test('a conflicting factory pull request without a label gets a merge run', async () => {
  const d = fakes({ pulls: [pr(10, 3)] });
  assert.deepEqual(await ticked(d), [10]);
  assert.deepEqual(d.started, [[10, 'merge']]);
});
test('a pull request that does not conflict is left alone', async () => {
  const d = fakes({ pulls: [pr(10, 3, { mergeable: 'MERGEABLE' }), pr(11, 4, { mergeable: 'UNKNOWN' })] });
  assert.deepEqual(await ticked(d), []);
});
test('conflict runs count towards maxParallel, oldest first', async () => {
  const d = fakes({ candidates: [issue(12)], pulls: [pr(10, 3), pr(11, 4)] });
  assert.deepEqual(await ticked(d), [10, 11]);
  assert.deepEqual(d.started, [[10, 'merge'], [11, 'merge']]);
});
test('a conflict run waits while its issue is running', async () => {
  const d = fakes({ pulls: [pr(10, 3)] });
  const running = new Map([[3, new Promise(() => {})]]);
  assert.deepEqual(await tick(d.deps, running), []);
  assert.deepEqual(d.started, []);
});
test('a pull request and its issue in the same tick share one slot', async () => {
  const d = fakes({ candidates: [issue(3)], pulls: [pr(10, 3)] });
  assert.deepEqual(await ticked(d), [3]);
});
test('a labelled pull request that also conflicts starts once, by its label', async () => {
  const merge = pr(10, 3, { labels: ['agent:merge'], labelEvents: [{ label: 'agent:merge', actor: 'dennis-brutski', at: T }] });
  const review = pr(11, 4, { labels: ['agent:review'], labelEvents: [{ label: 'agent:review', actor: 'dennis-brutski', at: T }] });
  const d = fakes({ candidates: [merge, review], pulls: [merge, review], cfg: { ...config, maxParallel: 5 } });
  assert.deepEqual(await ticked(d), [10, 11]);
  assert.deepEqual(d.started, [[10, 'merge'], [11, 'review']]);
});
test('a pull request listing failure is logged and labelled runs still start', async () => {
  const d = fakes({ candidates: [issue(3)], pullsFail: true });
  assert.deepEqual(await ticked(d), [3]);
  assert.ok(d.logs.some((l) => /could not list pull requests: GitHub is down/.test(l)));
});
