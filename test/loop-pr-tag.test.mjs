import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.mjs';
import scorePad from '../targets/gin-rummy-score-pad.mjs';
import { tick, recover } from '../lib/loop.mjs';
import { runItem } from '../lib/stages.mjs';
import { fakeWorkspace } from './fakes/workspace.mjs';

const T = '2026-11-01T10:00:00Z';
const pr = (number, headRef) => ({
  number, kind: 'pr', title: `PR ${number}`, body: '', author: 'dennis-brutski', bodyEditedAt: null,
  labels: ['agent:review'], labelEvents: [{ label: 'agent:review', actor: 'dennis-brutski', at: T }],
  comments: [{ author: 'dennis-brutski', body: 'is this right?', at: '2026-11-02T10:00:00Z' }], headRef, headRepo: scorePad.repo,
});

async function logsOf(item, outcome = { outcome: 'done' }) {
  const logs = [];
  const deps = {
    cfg: { ...config, ...scorePad }, root: '/f', log: (m) => logs.push(m),
    runItem: async () => outcome,
    gh: { listCandidates: async () => [item], listPullRequests: async () => [], addLabel: async () => {}, removeLabel: async () => {}, comment: async () => {} },
    ws: fakeWorkspace({}),
  };
  const running = new Map();
  await tick(deps, running);
  await Promise.all(running.values());
  return logs;
}

test('lines about a factory pull request carry its issue number and name the pull request', async () => {
  const logs = await logsOf(pr(12, 'factory/issue-4'));
  assert.deepEqual(logs, ['#4 review started on PR #12 (PR 12)', '#4 review done']);
});

async function sessionLogsOf(item) {
  const logs = [];
  const deps = {
    cfg: { ...config, ...scorePad }, root: '/f', log: (m) => logs.push(m),
    gh: { addLabel: async () => {}, removeLabel: async () => {}, comment: async () => {} },
    ws: fakeWorkspace({}),
    runSetup: async () => ({ ok: true, failed: null, output: '' }),
    runAgent: async () => ({ ok: false, reason: 'boom' }),
  };
  const r = await runItem(item, 'review', deps, 1);
  logs.push(`outcome: ${r.outcome} ${r.detail ?? ''}`);
  return logs;
}

test('session lines about a factory pull request carry its issue number', async () => {
  const logs = await sessionLogsOf(pr(12, 'factory/issue-4'));
  assert.ok(logs.includes('#4 rework session started'), logs.join('\n'));
  for (const l of logs.slice(0, -1)) assert.match(l, /^#4 /);
});

test('a pull request that is not on a factory branch is tagged with its own number', async () => {
  const logs = await sessionLogsOf(pr(12, 'feature/x'));
  assert.ok(logs.includes('#12 rework session started'), logs.join('\n'));
  for (const l of logs.slice(0, -1)) assert.match(l, /^#12 /);
});

function tickDeps(item, o = {}) {
  const logs = [];
  const deps = {
    cfg: { ...config, ...scorePad }, root: '/f', log: (m) => logs.push(m),
    runItem: async () => ({ outcome: 'done' }),
    gh: { listCandidates: async () => [item], listPullRequests: async () => [], addLabel: async () => {}, removeLabel: async () => {}, comment: async () => {} },
    ws: fakeWorkspace({}),
    ...o,
  };
  return { deps, logs };
}

test('a parked factory pull request is logged with its issue number', async () => {
  const { deps, logs } = tickDeps(pr(12, 'factory/issue-4'), { classify: () => ({ action: 'park', reason: 'needs a look' }) });
  await tick(deps, new Map());
  assert.deepEqual(logs, ['#4 parked: needs a look']);
});

test('a factory pull request that cannot be parked is logged with its issue number', async () => {
  const { deps, logs } = tickDeps(pr(12, 'factory/issue-4'), { classify: () => ({ action: 'park', reason: 'needs a look' }) });
  deps.gh.comment = async () => { throw new Error('GitHub is down'); };
  await tick(deps, new Map());
  assert.deepEqual(logs, ['#4 could not be parked: GitHub is down', '#4 parked: needs a look']);
});

test('a crashed run on a factory pull request is logged with its issue number', async () => {
  const { deps, logs } = tickDeps(pr(12, 'factory/issue-4'), { runItem: async () => { throw new Error('kaboom'); } });
  const running = new Map();
  await tick(deps, running);
  await Promise.all(running.values());
  assert.deepEqual(logs, ['#4 review started on PR #12 (PR 12)', '#4 review crashed: kaboom']);
});

test('an orphaned factory pull request is re-queued under its issue number', async () => {
  const orphan = { ...pr(12, 'factory/issue-4'), labels: ['agent:review', config.states.inProgress] };
  const removed = [];
  const { deps, logs } = tickDeps(orphan);
  deps.gh.removeLabel = async (c, n, l) => { removed.push(`${n}:${l}`); };
  assert.deepEqual(await recover(deps), [12]);
  assert.deepEqual(removed, [`12:${config.states.inProgress}`]);
  assert.deepEqual(logs, ['#4 re-queued after an interrupted run']);
});
