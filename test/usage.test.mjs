import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageOf, addUp, usageLine } from '../lib/usage.mjs';
import { planLine } from '../lib/usage.mjs';

const real = JSON.stringify({
  type: 'result', num_turns: 4, duration_ms: 26104, total_cost_usd: 0.1752,
  terminal_reason: 'completed', is_error: false,
  usage: { input_tokens: 6, cache_creation_input_tokens: 18763, cache_read_input_tokens: 47151, output_tokens: 785 },
  modelUsage: { 'claude-opus-5-5': { costUSD: 0.1752 } },
  permission_denials: [{ tool_name: 'Bash' }],
});

test('usageOf reads a real result', () => {
  assert.deepEqual(usageOf(`${real}\n--- stderr ---\nsome warning\n`), {
    turns: 4, durationMs: 26104, costUsd: 0.1752, tokensIn: 6 + 18763 + 47151, cachedIn: 47151, tokensOut: 785,
    models: ['claude-opus-5-5'], denials: 1, reason: 'completed',
  });
});

test('usageOf reads text without a stderr part', () => {
  assert.equal(usageOf(real).turns, 4);
});

test('usageOf leaves out missing fields', () => {
  const u = usageOf(`${JSON.stringify({ type: 'result', is_error: false, structured_output: {} })}\n--- stderr ---\n\n`);
  assert.deepEqual(u, { turns: undefined, durationMs: undefined, costUsd: undefined, tokensIn: undefined, cachedIn: undefined, tokensOut: undefined, models: [], denials: 0, reason: undefined });
  assert.equal(usageOf('{"num_turns": 2, "usage": {"input_tokens": 5}}').tokensIn, 5);
});

test('usageOf is null for stdout that is not JSON', () => {
  assert.equal(usageOf('\n--- stderr ---\nkilled after 30 min\n'), null);
  assert.equal(usageOf('Error: something broke\n--- stderr ---\n'), null);
  assert.equal(usageOf('[1, 2]'), null);
  assert.equal(usageOf('null'), null);
  assert.equal(usageOf(''), null);
});

test('addUp sums several and keeps missing fields missing', () => {
  const a = usageOf(real);
  const b = { turns: 19, durationMs: 1000, costUsd: 0.5, tokensIn: 100, cachedIn: 50, tokensOut: 15, models: ['claude-sonnet-5-5'], denials: 1, reason: 'max_turns' };
  const c = usageOf('{}');
  const s = addUp([a, b, c, null]);
  assert.equal(s.turns, 23);
  assert.equal(s.durationMs, 27104);
  assert.ok(Math.abs(s.costUsd - 0.6752) < 1e-9);
  assert.equal(s.tokensIn, 65920 + 100);
  assert.equal(s.cachedIn, 47201);
  assert.equal(s.tokensOut, 800);
  assert.deepEqual(s.models, ['claude-opus-5-5', 'claude-sonnet-5-5']);
  assert.equal(s.denials, 2);
  assert.equal(addUp([c]).turns, undefined);
  assert.equal(addUp([]).costUsd, undefined);
});

test('usageLine shows every part', () => {
  const u = { turns: 23, durationMs: 252_000, costUsd: 0.84, tokensIn: 1_300_000, cachedIn: 1_222_000, tokensOut: 18_000, models: [], denials: 0 };
  assert.equal(usageLine(u), '23 turns · 4m12s · 1.3M in (94% cached) · 18k out · ≈ $0.84');
  assert.equal(usageLine({ ...u, denials: 2 }), '23 turns · 4m12s · 1.3M in (94% cached) · 18k out · ≈ $0.84 · 2 denied');
});

test('usageLine leaves out what is missing', () => {
  assert.equal(usageLine(usageOf('{}')), '');
  assert.equal(usageLine(null), '');
  assert.equal(usageLine({ turns: 1, costUsd: 0.1752 }), '1 turn · ≈ $0.18');
  assert.equal(usageLine({ tokensIn: 812, tokensOut: 5 }), '812 in · 5 out');
  assert.equal(usageLine({ tokensIn: 0, cachedIn: 0 }), '0 in');
});

test('usageLine formats numbers and durations', () => {
  const n = (x) => usageLine({ tokensOut: x });
  assert.equal(n(812), '812 out');
  assert.equal(n(1500), '1.5k out');
  assert.equal(n(18_000), '18k out');
  assert.equal(n(18_400), '18k out');
  assert.equal(n(999_999), '1M out');
  assert.equal(n(1_300_000), '1.3M out');
  assert.equal(n(25_000_000), '25M out');
  const d = (ms) => usageLine({ durationMs: ms });
  assert.equal(d(45_000), '45s');
  assert.equal(d(252_000), '4m12s');
  assert.equal(d(60_000), '1m00s');
  assert.equal(d(3_780_000), '1h03m');
});

test('usageLine on a local run says local instead of a cost', () => {
  const u = { turns: 3, durationMs: 45_000, costUsd: 0.42, tokensIn: 1000, cachedIn: 900, tokensOut: 18_000, models: [], denials: 0 };
  assert.equal(usageLine(u, { local: true }), '3 turns · 45s · 1k in (90% cached) · 18k out · local');
});

test('usageLine on a local run says plainly when the server gave no token counts', () => {
  const u = { turns: 3, durationMs: 45_000, costUsd: 0, tokensIn: 0, cachedIn: 0, tokensOut: 0, models: [], denials: 1 };
  assert.equal(usageLine(u, { local: true }), '3 turns · 45s · local, no token counts · 1 denied');
});

test('planLine shows both windows and the 5-hour reset', () => {
  const r = Date.parse('2026-11-24T14:30:00Z'), d = new Date(r), pad = (x) => String(x).padStart(2, '0');
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  assert.equal(planLine({ fiveHour: 42, fiveHourResetsAt: r, week: 18 }), `plan 5h 42% (resets ${hhmm}) · week 18%`);
});

test('planLine leaves out what is missing', () => {
  assert.equal(planLine({ fiveHour: 42 }), 'plan 5h 42%');
  assert.equal(planLine({ week: 18 }), 'plan week 18%');
  assert.equal(planLine(null), '');
  assert.equal(planLine(undefined), '');
});
