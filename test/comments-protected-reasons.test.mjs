// Stop reasons written in protected files keep their text there; these tests tie each one to its stats label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.mjs';
import scorePad from '../targets/gin-rummy-score-pad.mjs';
import { verifyBranch } from '../lib/verify.mjs';
import { interpret } from '../lib/agent.mjs';
import { classify } from '../lib/eligibility.mjs';
import { reasons, stopped, didNotStart, stopLabel } from '../lib/comments.mjs';
import { fakeWorkspace } from './fakes/workspace.mjs';

const cfg = { ...config, ...scorePad };
const label = (reason, stage = 'implement') => stopLabel(stopped(stage, reason, 'agent:needs-human'));
const dir = '/f/worktrees/issue-1';

// lib/verify.mjs
test('protected files before setup get their own label', async () => {
  const ws = fakeWorkspace({ changesAgainstBase: async () => [{ status: 'M', path: 'package.json' }] });
  const { park } = await verifyBranch(ws, cfg, dir, { before: 'setup' });
  assert.equal(label(park), 'protected files (before setup)');
});

test('attribution lines get their own label', async () => {
  const ws = fakeWorkspace({ commitMessagesAgainstBase: async () => ['Fix undo\n\nCo-Authored-By: someone'] });
  const { park } = await verifyBranch(ws, cfg, dir);
  assert.equal(label(park), 'attribution lines');
});

test('CI workflow files are labelled workflow files', async () => {
  const ws = fakeWorkspace({ changesAgainstBase: async () => [{ status: 'M', path: '.github/workflows/ci.yml' }] });
  const { park } = await verifyBranch(ws, cfg, dir);
  assert.equal(label(park), 'workflow files');
});

// lib/agent.mjs, as the stages wrap it: "The <step> step failed: <reason>"
const session = (r, code = 0) => ({ code, timedOut: false, stderr: '', stdout: JSON.stringify({ type: 'result', session_id: 's1', ...r }) });
const failed = (exec) => label(reasons.stepFailed('implement', interpret(exec, 45).reason));

test('a timed-out session is labelled timed out', () => {
  assert.equal(failed({ code: null, timedOut: true, stderr: '', stdout: '' }), 'timed out / max turns / usage limit');
});

test('a session that spent its budget is labelled budget cap', () => {
  assert.equal(failed(session({ is_error: true, terminal_reason: 'budget_exhausted', total_cost_usd: 2 })), 'budget cap');
});

test('a session stopped at max turns is labelled max turns', () => {
  assert.equal(failed(session({ is_error: true, terminal_reason: 'max_turns' })), 'timed out / max turns / usage limit');
});

test('a session that hit the usage limit is labelled usage limit', () => {
  assert.equal(failed(session({ is_error: true, result: "You've hit your usage limit" }, 1)), 'timed out / max turns / usage limit');
});

test('a session that failed for another reason is labelled agent session failed', () => {
  assert.equal(failed(session({ is_error: true, result: 'API error' }, 1)), 'agent session failed');
});

test('a session whose output is not JSON is labelled agent session failed', () => {
  assert.equal(failed({ code: 1, timedOut: false, stderr: 'boom', stdout: '' }), 'agent session failed');
});

test('a session without a status report is labelled no status report', () => {
  assert.equal(failed(session({ is_error: false, structured_output: null })), 'no status report');
});

// lib/eligibility.mjs, written by lib/loop.mjs as a did-not-start comment
const T = '2026-11-01T10:00:00Z', LATER = '2026-11-01T11:00:00Z';
const issue = (o) => ({
  number: 1, kind: 'issue', title: 't', body: 'b', author: 'mallory', bodyEditedAt: null,
  labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: config.owner, at: T }],
  comments: [], renames: [], headRef: null, headRepo: null, ...o,
});
const parked = (item) => {
  const c = classify(item, cfg);
  assert.equal(c.action, 'park');
  return c.reason;
};

test('an issue edited after approval is labelled edited after approval', () => {
  const reason = parked(issue({ bodyEditedAt: LATER }));
  assert.equal(stopLabel(didNotStart(reason, 'agent:needs-human')), 'edited after approval');
  assert.equal(label(reason), 'edited after approval');
});

test('an issue renamed after approval is labelled edited after approval', () => {
  const reason = parked(issue({ renames: [{ actor: 'mallory', at: LATER }] }));
  assert.equal(stopLabel(didNotStart(reason, 'agent:needs-human')), 'edited after approval');
  assert.equal(label(reason), 'edited after approval');
});
