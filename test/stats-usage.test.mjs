import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { groupAgentUse, formatAgentUse, agentUseSection, readSessions } from '../stats.mjs';
import { count } from '../lib/usage.mjs';

const u = (turns, tokensIn, cachedIn, tokensOut, extra = {}) => ({ turns, durationMs: 1000, costUsd: 1, tokensIn, cachedIn, tokensOut, models: [], denials: 0, reason: 'completed', ...extra });
const s = (issue, stage, usage, at = Date.parse('2026-11-10T10:00:00Z')) => ({ issue, stage, at, usage });

test('count is exported from lib/usage.mjs', () => {
  assert.equal(count(180000), '180k');
  assert.equal(count(12_400_000), '12M');
});

test('groupAgentUse adds up sessions by stage, in the order the stages run', () => {
  const g = groupAgentUse([
    s(1, 'review', u(5, 1000, 900, 100)),
    s(1, 'implement', u(20, 10000, 9000, 2000)),
    s(2, 'implement', u(10, 5000, 5000, 1000)),
    s(2, 'gate', u(2, 500, 0, 50)),
    s(2, 'custom', u(1, 10, 0, 1)),
  ]);
  assert.deepEqual(g.stages.map(([name, x]) => [name, x.sessions, x.turns, x.tokensIn, x.cachedIn, x.tokensOut]), [
    ['gate', 1, 2, 500, 0, 50],
    ['implement', 2, 30, 15000, 14000, 3000],
    ['review', 1, 5, 1000, 900, 100],
    ['custom', 1, 1, 10, 0, 1],
  ]);
  assert.deepEqual([g.total.sessions, g.total.turns, g.total.tokensOut], [5, 38, 3151]);
});

test('groupAgentUse ranks the top 3 issues by cost', () => {
  const g = groupAgentUse([
    s(1, 'implement', u(1, 1, 0, 100, { costUsd: 1 })), s(1, 'review', u(1, 1, 0, 100, { costUsd: 1 })),
    s(2, 'implement', u(1, 1, 0, 10, { costUsd: 5 })),
    s(3, 'implement', u(1, 1, 0, 500, { costUsd: 0.5 })),
    s(4, 'implement', u(1, 1, 0, 10, { costUsd: 0.25 })),
    s(5, 'implement', u(1, 1, 0, 10, { costUsd: undefined })),
  ]);
  assert.deepEqual(g.top, [[2, 5], [1, 2], [3, 0.5]]);
});

test('groupAgentUse counts early stops by reason, unreadable sessions and refused tool calls', () => {
  const g = groupAgentUse([
    s(1, 'implement', u(1, 1, 0, 1, { reason: 'max_turns', denials: 2 })),
    s(1, 'review', u(1, 1, 0, 1, { reason: 'max_turns' })),
    s(2, 'implement', u(1, 1, 0, 1, { reason: 'prompt_too_long', denials: 3 })),
    s(2, 'review', u(1, 1, 0, 1, { reason: undefined })), // missing counts as completed
    s(3, 'implement', u(1, 1, 0, 1)),
    s(3, 'fix', null),
    s(3, 'fix', null),
  ]);
  assert.deepEqual(g.early, [['max_turns', 2], ['prompt_too_long', 1]]);
  assert.equal(g.unreadable, 2);
  assert.equal(g.denials, 5);
  assert.equal(g.stages.find(([name]) => name === 'fix')[1].sessions, 2);
});

test('groupAgentUse with since leaves out older sessions', () => {
  const g = groupAgentUse([
    s(1, 'implement', u(1, 1, 0, 1), Date.parse('2026-11-01T23:59:59Z')),
    s(2, 'implement', u(3, 1, 0, 1), Date.parse('2026-11-02T00:00:00Z')),
  ], '2026-11-02');
  assert.equal(g.total.sessions, 1);
  assert.equal(g.total.turns, 3);
  assert.equal(groupAgentUse([s(1, 'gate', u(1, 1, 0, 1), 0)], '2026-11-02').total.sessions, 0);
});

test('formatAgentUse prints the table and the summary lines', () => {
  const g = groupAgentUse([
    s(21, 'implement', u(200, 12_000_000, 11_280_000, 170_000, { reason: 'max_turns', denials: 4, costUsd: 6.1 })),
    s(12, 'review', u(41, 2_100_000, 2_037_000, 22_000, { denials: 1, costUsd: 3.1 })),
    s(12, 'gate', null),
  ]);
  assert.equal(formatAgentUse(g), [
    'agent use (from session logs; ≈ cost is an estimate at API list price, not your bill)',
    '  stage       sessions   turns   tokens in (cached)      out   ≈ cost',
    '  gate               1       -                    -        -        -',
    '  implement          1     200            12M (94%)     170k    $6.10',
    '  review             1      41           2.1M (97%)      22k    $3.10',
    '  total              3     241            14M (94%)     192k    $9.20',
    '  most used: #21 ≈ $6.10 · #12 ≈ $3.10',
    '  stopped early: 1 max_turns · 1 unreadable (timed out or crashed)',
    '  tool calls refused: 5',
  ].join('\n'));
});

test('formatAgentUse says when there are no logs, or none since the date', () => {
  assert.equal(formatAgentUse(null), 'agent use: no session logs yet');
  assert.equal(formatAgentUse(groupAgentUse([])), 'agent use: no session logs yet');
  assert.equal(formatAgentUse(groupAgentUse([], '2026-11-02'), '2026-11-02'), 'agent use: no sessions since 2026-11-02');
  const quiet = formatAgentUse(groupAgentUse([s(1, 'gate', u(1, 10, 0, 5))]));
  assert.match(quiet, /\n {2}stopped early: none\n {2}tool calls refused: 0$/);
});

const result = (extra = {}) => JSON.stringify({ num_turns: 3, usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 50 }, total_cost_usd: 0.25, permission_denials: [], terminal_reason: 'completed', ...extra });

test('agentUseSection reads the log folders of a run', () => {
  const root = mkdtempSync(join(tmpdir(), 'stats-usage-'));
  const logs = join(root, 'logs');
  mkdirSync(join(logs, 'issue-7'), { recursive: true });
  mkdirSync(join(logs, 'issue-8'), { recursive: true });
  mkdirSync(join(logs, 'not-an-issue'), { recursive: true });
  const at = Date.parse('2026-11-10T10:00:00Z');
  writeFileSync(join(logs, 'issue-7', `${at}-1-gate.json`), `${result()}\n--- stderr ---\nsome warning\n`);
  writeFileSync(join(logs, 'issue-7', `${at + 1}-2-implement.json`), result({ num_turns: 40, terminal_reason: 'max_turns', permission_denials: [{}, {}] }));
  writeFileSync(join(logs, 'issue-8', `${at}-1-implement.json`), '\n--- stderr ---\nkilled after 45 min\n'); // not JSON
  writeFileSync(join(logs, 'issue-8', 'notes.txt'), 'not a log');
  writeFileSync(join(logs, 'issue-8', 'checks-smoke.json'), result()); // not a session log name
  writeFileSync(join(logs, 'not-an-issue', `${at}-1-gate.json`), result());
  writeFileSync(join(logs, 'stray.json'), result());

  const sessions = readSessions(logs);
  assert.deepEqual(sessions.map((x) => [x.issue, x.stage, x.at, x.usage === null]).sort(), [
    [7, 'gate', at, false], [7, 'implement', at + 1, false], [8, 'implement', at, true],
  ].sort());

  const out = agentUseSection(logs);
  assert.match(out, /^agent use \(from session logs; ≈ cost is an estimate at API list price, not your bill\)\n/);
  assert.match(out, /\n {2}gate\s+1\s+3\s+1k \(90%\)\s+50\s+\$0\.25\n/);
  assert.match(out, /\n {2}implement\s+2\s+40\s/);
  assert.match(out, /\n {2}total\s+3\s+43\s/);
  assert.match(out, /most used: #7 ≈ \$0\.50\n/);
  assert.match(out, /stopped early: 1 max_turns · 1 unreadable \(timed out or crashed\)\n/);
  assert.match(out, /tool calls refused: 2$/);

  assert.equal(agentUseSection(logs, '2026-12-01'), 'agent use: no sessions since 2026-12-01');
  assert.equal(agentUseSection(join(root, 'missing')), 'agent use: no session logs yet');
  assert.equal(readSessions(join(root, 'missing')), null);
});
