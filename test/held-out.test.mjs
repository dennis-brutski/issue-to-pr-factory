// Checks kept outside the agents' reach: the factory runs them, agents never read them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.mjs';
import { runChecks } from '../lib/checks.mjs';
import { agentSettings } from '../lib/agent.mjs';
import { runItem } from '../lib/stages.mjs';
import { fakeWorkspace } from './fakes/workspace.mjs';

const bwrapWorks = (() => { try { execFileSync('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-net', 'true'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const real = { skip: bwrapWorks ? false : 'bwrap probe failed on this machine' };

function setupDirs(script) {
  const base = mkdtempSync(join(tmpdir(), 'factory-held-'));
  const runDir = join(base, 'run'), dir = join(runDir, 'worktrees', 'issue-1'), held = join(base, 'held');
  mkdirSync(dir, { recursive: true }); mkdirSync(held);
  writeFileSync(join(held, 'check.sh'), script);
  return { dir, held, cfg: { ...config, runDir, checks: [], heldOutDir: held, heldOutChecks: [['sh', ['{heldOut}/check.sh']]] } };
}

test('held-out checks run after the checks, with their folder readable', real, async () => {
  const { dir, cfg } = setupDirs('test -d "$PWD" && echo HELD-RAN && exit 1\n');
  const r = await runChecks(dir, cfg, 4321);
  assert.equal(r.ok, false); assert.equal(r.heldOut, true); assert.match(r.output, /HELD-RAN/);
});

test('passing held-out checks pass', real, async () => {
  const { dir, cfg } = setupDirs('exit 0\n');
  assert.equal((await runChecks(dir, cfg, 4321)).ok, true);
});

test('a held-out folder inside the run folder is refused: agents can read it there', async () => {
  const { dir, cfg } = setupDirs('exit 0\n');
  const r = await runChecks(dir, { ...cfg, heldOutDir: join(cfg.runDir, 'held') }, 4321);
  assert.equal(r.ok, false); assert.equal(r.heldOut, undefined); assert.match(r.output, /inside the run folder/);
});

test('agents cannot read the held-out folder', () => {
  const s = agentSettings('/r/worktrees/issue-1', { ...config, runDir: '/r', heldOutDir: '/h' });
  assert.ok(!JSON.stringify(s).includes('"/h'));
});

test('a failed held-out check parks without its output; the output goes to the terminal log', async () => {
  const T = '2026-11-01T10:00:00Z', lines = [], comments = [];
  const ok = (output) => ({ ok: true, output, reason: '', sessionId: 's' });
  const queue = [ok({ confidence: 90, questions: [] }), ok({ status: 'complete', summary: 'Done.', detail: '' }), ok({ verdict: 'clean', findings: [] })];
  const d = {
    cfg: { ...config, repo: 'x/y', baseBranch: 'main' }, root: '/f', log: (l) => lines.push(l),
    runSetup: async () => ({ ok: true, failed: null, output: '' }),
    runAgent: async () => queue.shift(),
    runChecks: async () => ({ ok: false, failed: 'sh /h/check.sh', output: 'SECRET-ASSERTION', heldOut: true }),
    gh: { addLabel: async () => {}, removeLabel: async () => {}, comment: async (c, n, b) => comments.push(b), findPullRequest: async () => null },
    ws: fakeWorkspace({ changesAgainstBase: async () => [{ status: 'M', path: 'src/a.js' }] }),
  };
  const issue = { number: 1, kind: 'issue', title: 'T', body: 'B', author: 'dennis-brutski', bodyEditedAt: null, labels: ['agent:implement'],
    labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }], comments: [], headRef: null, headRepo: null };
  const r = await runItem(issue, 'implement', d, 4201);
  assert.equal(r.outcome, 'parked');
  assert.match(r.detail, /held-out check failed/);
  assert.ok(!comments.join('\n').includes('SECRET-ASSERTION'));
  assert.ok(!r.detail.includes('SECRET-ASSERTION'));
  assert.ok(lines.join('\n').includes('SECRET-ASSERTION'));
});
