import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.mjs';
import scorePad from '../targets/gin-rummy-score-pad.mjs';
import { tick } from '../lib/loop.mjs';
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
