import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.mjs';
import scorePad from './fixtures/web-app-target.mjs';
import { runItem } from '../lib/stages.mjs';
import { fakeWorkspace } from './fakes/workspace.mjs';

const issue = {
  number: 7, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
  labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: '2026-11-01T10:00:00Z' }],
  comments: [], headRef: null, headRepo: null,
};
const result = (output, turns, cost, extra = {}) => JSON.stringify({
  type: 'result', is_error: false, structured_output: output, num_turns: turns, duration_ms: 252_000, total_cost_usd: cost,
  usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 900, output_tokens: 18_000 },
  permission_denials: [], ...extra,
});

function setup(sessions) {
  const root = mkdtempSync(join(tmpdir(), 'stages-usage-'));
  const logs = [], opened = [];
  const d = {
    cfg: { ...config, ...scorePad, target: 'web-app', model: 'opus-test' }, root, log: (m) => logs.push(m),
    factoryCommit: 'f00ba12',
    runSetup: async () => ({ ok: true, failed: null, output: '' }),
    runAgent: async (a) => {
      const s = sessions.shift();
      if (s.stdout !== undefined) { mkdirSync(join(a.logFile, '..'), { recursive: true }); writeFileSync(a.logFile, `${s.stdout}\n--- stderr ---\n\n`); }
      return s.r;
    },
    runChecks: async () => ({ ok: true, failed: null, output: '' }),
    gh: {
      addLabel: async () => {}, removeLabel: async () => {}, comment: async () => {},
      findPullRequest: async () => null,
      openPullRequest: async (c, a) => { opened.push(a); return { number: 50, url: 'https://github.com/x/y/pull/50' }; },
      setDraft: async () => {}, updatePullRequestBody: async () => {},
    },
    ws: fakeWorkspace({ currentBranch: async () => 'factory/issue-7' }, root),
  };
  return { d, logs, opened, root };
}
const ok = (output) => ({ ok: true, output, reason: '', sessionId: 's' });

test('each session logs what it used, and the pull request has the totals of every run', async () => {
  const gate = { confidence: 87, questions: [] }, work = { status: 'complete', summary: 'Changed undo.', detail: '' }, review = { verdict: 'clean', findings: [] };
  const { d, logs, opened, root } = setup([
    { stdout: result(gate, 2, 0.1), r: ok(gate) },
    { stdout: result(work, 20, 0.7, { permission_denials: [{}, {}] }), r: ok(work) },
    { stdout: JSON.stringify({ type: 'result', structured_output: review }), r: ok(review) }, // no usage, as the fake claude
  ]);
  try {
    const logDir = d.ws.paths(7).logs;
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, '1-1-implement.json'), `${result(work, 10, 0.25)}\n--- stderr ---\n\n`); // an earlier run
    writeFileSync(join(logDir, '1-2-implement.json'), 'killed\n--- stderr ---\ntimed out\n'); // a crashed one
    const r = await runItem(issue, 'implement', d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.ok(logs.includes('#7 gate session ended · 2 turns · 4m12s · 1k in (90% cached) · 18k out · ≈ $0.10'), logs.join('\n'));
    assert.ok(logs.includes('#7 implement session ended · 20 turns · 4m12s · 1k in (90% cached) · 18k out · ≈ $0.70 · 2 denied'), logs.join('\n'));
    assert.ok(logs.includes('#7 review session ended'), logs.join('\n'));
    const last = opened[0].body.trimEnd().split('\n').at(-1);
    assert.match(last, / · gate confidence 87 · checks: .+ · agent use so far: 5 sessions · 32 turns · ≈ \$1\.05 · session logs: runs\/web-app\/logs\/issue-7\/$/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a failed session still logs what it used before parking', async () => {
  const { d, logs, root } = setup([{ stdout: result(null, 3, 0.05), r: { ok: false, output: null, reason: 'it hit the turn limit', sessionId: 's' } }]);
  try {
    const r = await runItem(issue, 'implement', d, 4201);
    assert.equal(r.outcome, 'parked');
    const i = logs.findIndex((m) => m.startsWith('#7 gate session ended · 3 turns'));
    assert.ok(i >= 0, logs.join('\n'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a missing log file adds no line and does not park', async () => {
  const gate = { confidence: 87, questions: [] }, work = { status: 'complete', summary: 'Changed undo.', detail: '' }, review = { verdict: 'clean', findings: [] };
  const { d, logs, opened, root } = setup([{ r: ok(gate) }, { r: ok(work) }, { r: ok(review) }]);
  try {
    const r = await runItem(issue, 'implement', d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.ok(!logs.some((m) => m.includes('session ended')), logs.join('\n'));
    assert.doesNotMatch(opened[0].body, /agent use so far/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const zero = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };

test('a local run logs no cost, and says when the server gave no token counts', async () => {
  const gate = { confidence: 87, questions: [] }, work = { status: 'complete', summary: 'Changed undo.', detail: '' }, review = { verdict: 'clean', findings: [] };
  const { d, logs, opened, root } = setup([
    { stdout: result(gate, 2, 0, { usage: zero }), r: ok(gate) },
    { stdout: result(work, 20, 0, { usage: zero }), r: ok(work) },
    { stdout: result(review, 3, 0, { usage: zero }), r: ok(review) },
  ]);
  d.cfg = { ...d.cfg, localRun: true };
  try {
    const r = await runItem(issue, 'implement', d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.ok(logs.includes('#7 gate session ended · 2 turns · 4m12s · local, no token counts'), logs.join('\n'));
    assert.ok(!logs.some((m) => m.includes('≈ $')), logs.join('\n'));
    const last = opened[0].body.trimEnd().split('\n').at(-1);
    assert.match(last, / · agent use so far: 3 sessions · 25 turns · local, no token counts · session logs: /);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a local run whose server counts shows its tokens, not a cost', async () => {
  const gate = { confidence: 87, questions: [] }, work = { status: 'complete', summary: 'Changed undo.', detail: '' }, review = { verdict: 'clean', findings: [] };
  const { d, logs, opened, root } = setup([
    { stdout: result(gate, 2, 0.1), r: ok(gate) },
    { stdout: result(work, 20, 0.7), r: ok(work) },
    { stdout: result(review, 3, 0.2), r: ok(review) },
  ]);
  d.cfg = { ...d.cfg, localRun: true };
  try {
    const r = await runItem(issue, 'implement', d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.ok(logs.includes('#7 gate session ended · 2 turns · 4m12s · 1k in (90% cached) · 18k out · local'), logs.join('\n'));
    const last = opened[0].body.trimEnd().split('\n').at(-1);
    assert.match(last, / · agent use so far: 3 sessions · 25 turns · 3k in · 54k out · local · session logs: /);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
