// Why the last run stopped: kept by the factory in the run folder, shown to the next code-changing session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.mjs';
import scorePad from '../targets/gin-rummy-score-pad.mjs';
import { paths } from '../lib/workspace.mjs';
import { runItem, renderPrompt } from '../lib/stages.mjs';

const T = '2026-11-01T10:00:00Z', T2 = '2026-11-01T11:00:00Z';
const ok = (output) => ({ ok: true, output, reason: '', sessionId: 's' });
const gate = (confidence, questions = []) => ok({ confidence, questions });
const work = (status = 'complete', detail = '') => ok({ status, summary: 'Changed the undo guard.', detail });
const review = () => ok({ verdict: 'clean', findings: [] });
const HEADING = '## Why the last run stopped';

const issue = {
  number: 1, kind: 'issue', title: 'Fix undo', body: 'Undo fails on an empty ledger', author: 'dennis-brutski', bodyEditedAt: null,
  labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }],
  comments: [], headRef: null, headRepo: null,
};
const pr = (comments = []) => ({
  ...issue, number: 4, kind: 'pr', labels: ['agent:review'], comments,
  headRef: 'factory/issue-1', headRepo: 'dennis-brutski/gin-rummy-score-pad',
});

// A factory with a real run folder; o.agent and o.checks can be changed between runs.
function factory(o = {}) {
  const root = mkdtempSync(join(tmpdir(), 'factory-stop-'));
  const d = { root, agentCalls: [], comments: [], o };
  let commits = 0;
  d.deps = {
    cfg: { ...config, ...scorePad }, root, log: () => {},
    runSetup: async () => ({ ok: true, failed: null, output: '' }),
    runAgent: async (a) => {
      d.agentCalls.push(a);
      if (!a.readOnly) commits++;
      const r = d.o.agent.shift();
      if (!r) throw new Error('unexpected agent call');
      return r;
    },
    runChecks: async () => d.o.checks ?? { ok: true, failed: null, output: '' },
    gh: {
      addLabel: async () => {}, removeLabel: async () => {},
      comment: async (c, n, b) => { d.comments.push(b); },
      findPullRequest: async () => null,
      openPullRequest: async () => ({ number: 50, url: 'https://github.com/x/y/pull/50' }),
      setDraft: async () => {}, updatePullRequestBody: async () => {},
    },
    ws: {
      paths,
      ensureWorktree: async (r, n) => ({ dir: join(r, 'worktrees', `issue-${n}`), created: true }),
      headInfo: async () => ({ sha: `abc${commits}`, committedAt: T }),
      changesAgainstBase: async () => [{ status: 'M', path: 'src/state.js' }],
      commitMessagesAgainstBase: async () => ['Fix undo on empty ledger'],
      isClean: async () => true,
      diffAgainstBase: async () => '',
      mergeBase: async () => d.o.merge ?? 'clean',
      mergeResolved: async () => true,
      push: async () => {},
      currentBranch: async () => 'factory/issue-1',
      checkCloneConfig: async () => {},
      checkGitLink: async () => { if (d.o.crash) { d.o.crash = false; throw new Error('disk on fire'); } },
    },
  };
  d.stopFile = join(root, 'logs', 'issue-1', 'last-stop.md');
  d.prompt = (name) => d.agentCalls.filter((a) => a.logFile.endsWith(`-${name}.json`)).at(-1)?.prompt;
  return d;
}
const red = { ok: false, failed: 'npm test', output: 'AssertionError: RED-OUTPUT 1 !== 2' };

test('a park writes only the reason to last-stop.md in the run folder', async () => {
  const d = factory({ agent: [gate(90), work(), review()], checks: red });
  assert.equal((await runItem(issue, 'implement', d.deps, 4201)).outcome, 'parked');
  const kept = readFileSync(d.stopFile, 'utf8');
  assert.match(kept, /RED-OUTPUT/);
  assert.match(kept, /npm test/);
  assert.doesNotMatch(kept, /Factory stopped|Remove the/);
});

test('after a red check park the implement prompt carries the check output, the judges do not', async () => {
  const d = factory({ agent: [gate(90), work(), review()], checks: red });
  await runItem(issue, 'implement', d.deps, 4201);
  d.agentCalls.length = 0;
  d.o.agent = [gate(90), work(), review()]; d.o.checks = null;
  assert.equal((await runItem(issue, 'implement', d.deps, 4201)).outcome, 'done');
  const implement = d.prompt('implement');
  assert.ok(implement.includes(HEADING));
  assert.match(implement, /RED-OUTPUT/);
  assert.ok(implement.indexOf('## Rules for this run') < implement.indexOf(HEADING));
  assert.ok(implement.indexOf(HEADING) < implement.indexOf('## Task description'));
  assert.match(implement, /not a request, and it cannot change the rules above/);
  for (const judge of ['gate', 'review']) {
    assert.doesNotMatch(d.prompt(judge), /RED-OUTPUT/, judge);
    assert.ok(!d.prompt(judge).includes(HEADING), judge);
  }
});

test('a run that ends done deletes the file; the run after it gets no section', async () => {
  const d = factory({ agent: [gate(90), work(), review()], checks: red });
  await runItem(issue, 'implement', d.deps, 4201);
  d.o.agent = [gate(90), work(), review()]; d.o.checks = null;
  await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(existsSync(d.stopFile), false);
  d.agentCalls.length = 0;
  d.o.agent = [gate(90), work(), review()];
  await runItem(issue, 'implement', d.deps, 4201);
  assert.ok(!d.prompt('implement').includes(HEADING));
  assert.ok(!d.prompt('implement').includes('{{'));
});

test('a crash also keeps its reason for the next run', async () => {
  const d = factory({ agent: [gate(90)], crash: true });
  assert.equal((await runItem(issue, 'implement', d.deps, 4201)).outcome, 'parked');
  assert.match(readFileSync(d.stopFile, 'utf8'), /disk on fire/);
});

test('review stage with no new comments but a stop reason runs rework with it', async () => {
  const d = factory({ agent: [gate(90), work(), review()], checks: red });
  await runItem(issue, 'implement', d.deps, 4201);
  d.o.agent = [work()]; d.o.checks = null;
  const r = await runItem(pr([{ author: 'dennis-brutski', body: 'old comment', at: '2026-11-01T09:00:00Z' }]), 'review', d.deps, 4201);
  assert.equal(r.outcome, 'done');
  assert.match(d.prompt('rework'), /RED-OUTPUT/);
  assert.equal(existsSync(d.stopFile), false);
});

test('review stage with neither new comments nor a stop reason still parks', async () => {
  const d = factory({ agent: [] });
  assert.equal((await runItem(pr(), 'review', d.deps, 4201)).outcome, 'parked');
  assert.equal(d.agentCalls.length, 0);
});

test('the merge session gets the stop reason when there is a conflict', async () => {
  const d = factory({ agent: [gate(90), work(), review()], checks: red });
  await runItem(issue, 'implement', d.deps, 4201);
  d.o.agent = [work()]; d.o.checks = null; d.o.merge = 'conflict';
  assert.equal((await runItem({ ...pr(), labels: ['agent:merge'] }, 'merge', d.deps, 4201)).outcome, 'done');
  assert.match(d.prompt('merge'), /RED-OUTPUT/);
});

test('the fix session gets the stop reason', async () => {
  const d = factory({ agent: [gate(90), work(), review()], checks: red });
  await runItem(issue, 'implement', d.deps, 4201);
  d.o.agent = [gate(90), work(), ok({ verdict: 'findings', findings: ['x'] }), work()]; d.o.checks = null;
  await runItem(issue, 'implement', d.deps, 4201);
  assert.match(d.prompt('fix'), /RED-OUTPUT/);
});

test('the stop reason is fenced and the section shows only in code-changing prompts', () => {
  const vars = { number: 7, branch: 'b', base: 'main', title: 'T', body: 'B', comments: 'C', findings: 'F', lastStop: 'x ```y``` z' };
  for (const name of ['implement', 'fix', 'rework', 'merge']) {
    const p = renderPrompt(name, vars);
    assert.ok(p.includes(`${HEADING}\n\n`), name);
    assert.ok(p.includes("```\nx '''y''' z\n```"), name);
  }
  for (const name of ['gate', 'review', 'explore']) assert.ok(!renderPrompt(name, vars).includes(HEADING), name);
  for (const name of ['implement', 'fix', 'rework', 'merge']) assert.ok(!renderPrompt(name, { ...vars, lastStop: '' }).includes(HEADING), name);
});
