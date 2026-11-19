import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArgs, interpret } from '../lib/agent.mjs';
import { stopLabel } from '../stats.mjs';
import { stopped } from '../lib/comments.mjs';

const base = { schema: { type: 'object' }, settings: { sandbox: { enabled: true } }, maxTurns: 150, model: null, readOnly: false };

test('a budget adds --max-budget-usd and keeps --disallowedTools last', () => {
  const a = buildArgs({ ...base, maxBudgetUsd: 2 });
  assert.equal(a[a.indexOf('--max-budget-usd') + 1], '2');
  assert.equal(a.at(-2), '--disallowedTools');
});

test('no budget, or zero, leaves the arguments as they were', () => {
  for (const maxBudgetUsd of [null, undefined, 0]) assert.deepEqual(buildArgs({ ...base, maxBudgetUsd }), buildArgs(base));
});

// What claude -p --output-format json printed for a session stopped by --max-budget-usd 0.0001 (CLI, 2026-11-19).
const spent = {
  code: 0, timedOut: false, stderr: '',
  stdout: JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, terminal_reason: 'budget_exhausted', result: null, total_cost_usd: 2.0134, session_id: 's1' }),
};

test('a session that spent its budget fails with a reason that says so', () => {
  const r = interpret(spent, 45);
  assert.equal(r.ok, false);
  assert.match(r.reason, /spent its budget \(≈ \$2\.01\)/);
});

test('stats labels a budget stop as budget cap', () => {
  const reason = `The implement step failed: ${interpret(spent, 45).reason}`;
  assert.equal(stopLabel(stopped('implement', reason, 'agent:needs-human')), 'budget cap');
});
