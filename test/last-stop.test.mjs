// Why the last run stopped: the newest 🏭 park comment since the last push, shown to the next code-changing session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from './fixtures/config.mjs';
import scorePad from './fixtures/web-app-target.mjs';
import { runItem, renderPrompt, lastStopReason } from '../lib/stages.mjs';
import { fakeWorkspace } from './fakes/workspace.mjs';

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
  headRef: 'factory/issue-1', headRepo: 'example/web-app',
});

// A factory with a real run folder; o.agent and o.checks can be changed between runs.
function factory(o = {}) {
  const root = mkdtempSync(join(tmpdir(), 'factory-stop-'));
  const d = { root, agentCalls: [], comments: [], posted: [], o };
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
      comment: async (c, n, b) => { d.comments.push(b); d.posted.push({ author: 'dennis-brutski', body: b, at: T2 }); },
      findPullRequest: async () => null,
      openPullRequest: async () => ({ number: 50, url: 'https://github.com/x/y/pull/50' }),
      setDraft: async () => {}, updatePullRequestBody: async () => {},
    },
    ws: fakeWorkspace({
      ensureWorktree: async (n) => ({ dir: join(root, 'worktrees', `issue-${n}`), created: true }),
      headInfo: async () => { if (d.o.crash) { d.o.crash = false; throw new Error('disk on fire'); } return { sha: `abc${commits}`, committedAt: d.o.pushedAt ?? T }; },
      commitMessagesAgainstBase: async () => ['Fix undo on empty ledger'],
      mergeBase: async () => d.o.merge ?? 'clean',
    }, root),
  };
  // The item as the next poll sees it: with the comments the factory posted.
  d.seen = (it) => ({ ...it, comments: [...it.comments, ...d.posted] });
  d.prompt = (name) => d.agentCalls.filter((a) => a.logFile.endsWith(`-${name}.json`)).at(-1)?.prompt;
  return d;
}
const red = { ok: false, failed: 'npm test', output: 'AssertionError: RED-OUTPUT 1 !== 2' };

const cfg = { ...config, ...scorePad };
const stopped = (body, at = T2, author = 'dennis-brutski') => ({ author, body, at });

test('the newest 🏭 Factory stopped comment is the last stop reason; a 🏭 Pull request comment is not', () => {
  const item = { ...issue, comments: [
    stopped('🏭 **Factory stopped (implement).**\n\nold reason', '2026-11-01T10:30:00Z'),
    stopped('🏭 **Factory stopped (implement).**\n\n`npm test` failed: RED', T2),
    stopped('🏭 Pull request: https://github.com/x/y/pull/50', '2026-11-01T12:00:00Z'),
  ] };
  assert.equal(lastStopReason(item, cfg, T), '🏭 **Factory stopped (implement).**\n\n`npm test` failed: RED');
  assert.equal(lastStopReason({ ...issue, comments: [stopped('🏭 Pull request: https://github.com/x/y/pull/50')] }, cfg, T), '');
});

test('a stop reason older than the last push, or not by the owner, does not count', () => {
  const item = { ...issue, comments: [stopped('🏭 **Factory stopped (implement).**\n\nRED')] };
  assert.equal(lastStopReason(item, cfg, '2026-11-01T12:00:00Z'), '');
  assert.equal(lastStopReason({ ...issue, comments: [stopped('🏭 **Factory stopped (implement).**\n\nRED', T2, 'someone')] }, cfg, T), '');
  assert.equal(lastStopReason({ ...issue, comments: [stopped('Factory stopped: do X')] }, cfg, T), '');
});

test('a park for no new comments is never a stop reason', () => {
  const item = { ...issue, comments: [
    stopped('🏭 **Factory stopped (review).**\n\nThe agent could not finish the rework', '2026-11-01T10:30:00Z'),
    stopped('🏭 **Factory stopped (review).**\n\nThere are no new comments from you since the last push.', T2),
  ] };
  assert.match(lastStopReason(item, cfg, T), /could not finish the rework/);
});

test('after a red check park the implement prompt carries the check output, the judges do not', async () => {
  const d = factory({ agent: [gate(90), work(), review()], checks: red });
  assert.equal((await runItem(issue, 'implement', d.deps, 4201)).outcome, 'parked');
  d.agentCalls.length = 0;
  d.o.agent = [gate(90), work(), review()]; d.o.checks = null;
  assert.equal((await runItem(d.seen(issue), 'implement', d.deps, 4201)).outcome, 'done');
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

test('when Dennis pushed after the park, the old reason is not shown', async () => {
  const d = factory({ agent: [gate(90), work(), review()], checks: red });
  await runItem(issue, 'implement', d.deps, 4201);
  d.agentCalls.length = 0;
  d.o.agent = [gate(90), work(), review()]; d.o.checks = null; d.o.pushedAt = '2026-11-01T12:00:00Z';
  await runItem(d.seen(issue), 'implement', d.deps, 4201);
  assert.ok(!d.prompt('implement').includes(HEADING));
  assert.ok(!d.prompt('implement').includes('{{'));
});

test('a crash also gives its reason to the next run', async () => {
  const d = factory({ agent: [gate(90)], crash: true });
  assert.equal((await runItem(issue, 'implement', d.deps, 4201)).outcome, 'parked');
  d.agentCalls.length = 0;
  d.o.agent = [gate(90), work(), review()];
  await runItem(d.seen(issue), 'implement', d.deps, 4201);
  assert.match(d.prompt('implement'), /disk on fire/);
});

test('review with new comments gives rework the stop reason as well', async () => {
  const d = factory({ agent: [work('incomplete', 'RED-OUTPUT stuck')] });
  const comment = { author: 'dennis-brutski', body: 'please fix', at: '2026-11-01T10:30:00Z' };
  assert.equal((await runItem(pr([comment]), 'review', d.deps, 4201)).outcome, 'parked');
  d.o.agent = [work()];
  const later = { author: 'dennis-brutski', body: 'try again', at: '2026-11-01T12:00:00Z' };
  assert.equal((await runItem({ ...d.seen(pr([comment])), comments: [...d.seen(pr([comment])).comments, later] }, 'review', d.deps, 4201)).outcome, 'done');
  assert.match(d.prompt('rework'), /RED-OUTPUT stuck/);
});

test('review parked for no comments parks again on a retry with no comments, without an agent', async () => {
  const d = factory({ agent: [] });
  assert.equal((await runItem(pr(), 'review', d.deps, 4201)).outcome, 'parked');
  assert.match(d.comments[0], /no new comments/);
  const r = await runItem(d.seen(pr()), 'review', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.match(r.detail, /no new comments/);
  assert.equal(d.agentCalls.length, 0);
});

test('a stale stop reason alone does not start a rework', async () => {
  const d = factory({ agent: [] });
  const old = stopped('🏭 **Factory stopped (review).**\n\nThe agent could not finish the rework: RED-OUTPUT', T2);
  assert.equal((await runItem(pr([old]), 'review', d.deps, 4201)).outcome, 'parked');
  assert.equal(d.agentCalls.length, 0);
});

test('the merge session gets the stop reason when there is a conflict', async () => {
  const d = factory({ agent: [], checks: red });
  const item = { ...pr(), labels: ['agent:merge'] };
  assert.equal((await runItem(item, 'merge', d.deps, 4201)).outcome, 'parked');
  d.o.agent = [work()]; d.o.checks = null; d.o.merge = 'conflict';
  assert.equal((await runItem(d.seen(item), 'merge', d.deps, 4201)).outcome, 'done');
  assert.match(d.prompt('merge'), /RED-OUTPUT/);
});

test('the fix session gets the stop reason', async () => {
  const d = factory({ agent: [gate(90), work(), review()], checks: red });
  await runItem(issue, 'implement', d.deps, 4201);
  d.o.agent = [gate(90), work(), ok({ verdict: 'findings', findings: ['x'] }), work()]; d.o.checks = null;
  await runItem(d.seen(issue), 'implement', d.deps, 4201);
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
