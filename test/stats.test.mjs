import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { countPullRequests, stopLabel, groupStops, formatStats, runStats, countAutoMerges, formatAutoMerges, groupAgentUse, formatAgentUse, agentUseSection, readSessions } from '../stats.mjs';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoMerged, autoMergeFailed, stopped, reasons } from '../lib/comments.mjs';
import { count } from '../lib/usage.mjs';

describe('counts and stop reasons', () => {
  const cfg = { repo: 'dennis-brutski/demo', owner: 'dennis-brutski', states: { needsHuman: 'agent:needs-human' } };
  const pr = (ref, state, extra = {}) => ({ number: 1, ref, repo: 'dennis-brutski/demo', state, merged: state === 'merged', at: '2026-11-10T10:00:00Z', ...extra });

  test('countPullRequests counts factory branches of the target repo by outcome', () => {
    const prs = [
      pr('factory/issue-1', 'merged'), pr('factory/issue-2', 'merged'), pr('factory/issue-3', 'closed'),
      pr('factory/issue-4', 'open'),
      pr('feature/x', 'merged'), // not a factory branch
      pr('factory/issue-5', 'merged', { repo: 'mallory/demo' }), // a fork
      pr('factory/issue-6', 'open', { repo: null }), // a deleted fork
    ];
    assert.deepEqual(countPullRequests(prs, cfg), { opened: 4, merged: 2, closedUnmerged: 1, open: 1 });
  });

  test('countPullRequests with since leaves out older pull requests', () => {
    const prs = [pr('factory/issue-1', 'merged', { at: '2026-11-01T23:59:59Z' }), pr('factory/issue-2', 'open', { at: '2026-11-02T00:00:00Z' })];
    assert.deepEqual(countPullRequests(prs, cfg, '2026-11-02'), { opened: 1, merged: 0, closedUnmerged: 0, open: 1 });
  });

  // One real reason per label, as lib/stages.mjs and lib/loop.mjs write them.
  const stopped = (reason, stage = 'implement') => `🏭 **Factory stopped (${stage}).**\n\n${reason}\n\nRemove the \`agent:needs-human\` label to try again.`;
  const notStarted = (reason) => `🏭 **Factory did not start.**\n\nThe ${reason}. Check it, then remove the \`agent:needs-human\` label to approve it again.`;
  const REAL = [
    [stopped('This issue is not clear enough to build without guessing (confidence 40 of 100, needs 70).\n\nQuestions:\n- Which?\n\nAnswer in a comment, then remove the label.'), 'not clear enough'],
    [stopped('This needs your decision: it is not clearly easy to undo and small in reach. To build it anyway, replace `agent:explore` with `agent:implement`.', 'explore'), 'needs a decision (explore)'],
    [stopped('`npm test` failed when the factory ran the checks:\n\n```\nnot ok 1\n```'), 'a check failed'],
    [stopped("A held-out check failed: `node --test held/`. Its output is in the factory's terminal, not here, so agents do not learn the held-out tests."), 'a held-out check failed'],
    [stopped('`npm ci` failed in the worktree (setup):\n```\nerr\n```'), 'setup failed'],
    [stopped('The pull request https://github.com/dennis-brutski/demo/pull/3 is a draft because it touches protected files:\n- package.json'), 'protected files (draft)'],
    [stopped('The rework was pushed, but it touches protected files, so the pull request is now a draft:\n- package.json', 'review'), 'protected files (draft)'],
    [stopped('The branch changes CI workflow files, so the factory did not push it. Read the change and push it yourself if it is right:\n- .github/workflows/ci.yml'), 'workflow files'],
    [notStarted('issue text was edited after it was approved'), 'edited after approval'],
    [notStarted('issue title was changed after it was approved'), 'edited after approval'],
    [stopped('The agent could not finish:\n\nMissing a fixture.'), 'agent could not finish'],
    [stopped('The agent could not fix the review findings:\n\nNo.'), 'agent could not finish'],
    [stopped('The agent produced no changes.'), 'no changes'],
    [stopped('The implement step failed: timed out after 45 min'), 'timed out / max turns / usage limit'],
    [stopped('The implement step failed: the agent session stopped: max_turns'), 'timed out / max turns / usage limit'],
    [stopped("The gate step failed: the agent session failed: You've hit your usage limit"), 'timed out / max turns / usage limit'],
    [stopped('The worktree has uncommitted changes, probably from a run that was killed. Commit or discard them in `runs/demo/worktrees/issue-1`, then remove the label.'), 'worktree dirty'],
    [stopped('The branch `factory/issue-1` conflicts with the latest `master`. Merge it by hand in `runs/demo/worktrees/issue-1`, then remove the label.'), 'conflicts with base'],
    [stopped('The factory hit an error: gh api failed'), 'factory error'],
  ];

  test('stopLabel maps each known stop reason to its short label', () => {
    for (const [body, label] of REAL) assert.equal(stopLabel(body), label, body);
  });

  test('stopLabel shows an unknown reason by its first 60 characters', () => {
    const reason = 'Something entirely new happened here, and it is described in a long sentence.';
    assert.equal(stopLabel(stopped(reason)), `other: ${reason.slice(0, 60)}`);
  });

  const c = (body, extra = {}) => ({ author: 'dennis-brutski', body, at: '2026-11-10T10:00:00Z', ...extra });

  test('groupStops counts the owner\'s stop comments by label, most first', () => {
    const comments = [
      c(stopped('The agent produced no changes.')),
      c(stopped('`npm test` failed when the factory ran the checks:\n\n```\nx\n```')),
      c(stopped('`npm test` failed when the factory ran the checks:\n\n```\ny\n```')),
      c(stopped('There are no new comments from you since the last push.', 'review')), // says nothing about the code
      c(stopped('The agent produced no changes.'), { author: 'mallory' }), // not the owner
      c('🏭 Pull request: https://github.com/dennis-brutski/demo/pull/3'), // not a stop
      c(notStarted('issue text was edited after it was approved'), { author: 'Dennis-Brutski' }),
    ];
    assert.deepEqual(groupStops(comments, cfg), [['a check failed', 2], ['edited after approval', 1], ['no changes', 1]]);
  });

  test('groupStops with since leaves out older comments', () => {
    const comments = [c(stopped('The agent produced no changes.'), { at: '2026-11-01T10:00:00Z' }), c(stopped('The agent produced no changes.'), { at: '2026-11-02T00:00:00Z' })];
    assert.deepEqual(groupStops(comments, cfg, '2026-11-02'), [['no changes', 1]]);
  });

  test('formatStats prints the counts and the stops', () => {
    const out = formatStats({ opened: 3, merged: 1, closedUnmerged: 1, open: 1 }, [['a check failed', 12], ['no changes', 3]]);
    assert.equal(out, [
      'pull requests from factory/issue-* branches: 3 opened · 1 merged · 1 closed unmerged · 1 open',
      'stops (agent:needs-human comments, by first line of the reason):',
      '  12  a check failed',
      '   3  no changes',
    ].join('\n'));
    assert.match(formatStats({ opened: 0, merged: 0, closedUnmerged: 0, open: 0 }, []), /stops .*:\n {3}none$/);
  });
});

// stats.mjs with no target: every target in targets/, one after another.
function root(targets) {
  const r = mkdtempSync(join(tmpdir(), 'factory-stats-all-'));
  mkdirSync(join(r, 'targets'));
  for (const [name, repo] of Object.entries(targets)) {
    writeFileSync(join(r, 'targets', `${name}.mjs`), `export default ${JSON.stringify({ repo, owner: 'me', baseBranch: 'main' })};\n`);
  }
  return r;
}
const fakeGh = (failing = []) => {
  const calls = [];
  const answer = (list) => async (cfg) => {
    calls.push(cfg.repo);
    if (failing.includes(cfg.repo)) throw new Error('gh cannot reach the repo');
    return list;
  };
  return { calls, listAllPullRequests: answer([]), listAllIssueComments: answer([]) };
};
async function stats(r, args, gh) {
  const lines = [];
  const ok = await runStats(args, { factoryRoot: r, gh, log: (s) => lines.push(s) });
  return { ok, out: lines.join('\n') };
}

test('no target prints every target under its own heading, in name order, one blank line apart', async () => {
  const r = root({ zeta: 'me/zeta-repo', alpha: 'me/alpha-repo' });
  const { ok, out } = await stats(r, [], fakeGh());
  assert.equal(ok, true);
  const a = out.indexOf('me/alpha-repo\n'), z = out.indexOf('me/zeta-repo\n');
  assert.ok(a === 0 && z > a, out);
  assert.match(out, /none\n\nme\/zeta-repo\n/);
  assert.equal(out.match(/opened/g).length, 2);
});

test('--since applies to every target', async () => {
  const r = root({ one: 'me/one', two: 'me/two' });
  const { out } = await stats(r, ['--since', '2026-11-01'], fakeGh());
  assert.match(out, /^me\/one since 2026-11-01\n/m);
  assert.match(out, /^me\/two since 2026-11-01\n/m);
});

test('one target failing still prints the others and reports failure', async () => {
  const r = root({ one: 'me/one', two: 'me/two' });
  const { ok, out } = await stats(r, [], fakeGh(['me/one']));
  assert.equal(ok, false);
  assert.match(out, /^one: could not read stats: gh cannot reach the repo$/m);
  assert.match(out, /^me\/two\n/m);
  assert.match(out, /opened/);
});

test('a target whose settings do not load is reported, the others still print', async () => {
  const r = root({ one: 'me/one' });
  writeFileSync(join(r, 'targets', 'broken.mjs'), 'export default { repo: "x/y" };\n');
  const { ok, out } = await stats(r, [], fakeGh());
  assert.equal(ok, false);
  assert.match(out, /^broken: could not read stats: target broken: repo and baseBranch are required$/m);
  assert.match(out, /^me\/one\n/m);
});

test('with a target only that target prints', async () => {
  const r = root({ one: 'me/one', two: 'me/two' });
  const gh = fakeGh();
  const { ok, out } = await stats(r, ['two'], gh);
  assert.equal(ok, true);
  assert.match(out, /^me\/two\n/);
  assert.deepEqual([...new Set(gh.calls)], ['me/two']);
});

test('no targets at all is an error', async () => {
  await assert.rejects(runStats([], { factoryRoot: root({}), gh: fakeGh(), log: () => {} }), /no targets/);
});

// npm run stats: how many pull requests were handed to auto-merge, and how many of those were reverted.
const cfg = { repo: 'dennis-brutski/demo', owner: 'dennis-brutski' };
const url = (n) => `https://github.com/dennis-brutski/demo/pull/${n}`;
const c = (body, extra = {}) => ({ author: 'dennis-brutski', body, at: '2026-11-10T10:00:00Z', ...extra });
const handed = (n, extra) => c(autoMerged(url(n), { reviewed: 'clean', lines: 12 }), extra);
// GitHub's revert button opens a pull request titled Revert "<title>".
const pr = (number, title, merged, extra = {}) => ({ number, title, repo: 'dennis-brutski/demo', merged, ...extra });

test('countAutoMerges counts the owner\'s Auto-merge comments and the merged reverts of those pull requests', () => {
  const comments = [
    handed(10), handed(11), handed(12),
    c(autoMergeFailed(url(13), 'not allowed')), // never handed over
    handed(14, { author: 'mallory' }), // not the owner
    c(`🏭 Pull request: ${url(15)}`),
  ];
  const prs = [
    pr(10, 'Fix undo', true), pr(11, 'Add redo', true), pr(12, 'Show score', true), pr(14, 'Rename it', true),
    pr(20, 'Revert "Fix undo"', true), // reverted
    pr(21, 'Revert "Add redo"', false), // revert opened, not merged
    pr(22, 'Revert "Rename it"', true), // revert of a pull request not counted
    pr(23, 'Revert "Show score"', true, { repo: 'mallory/demo' }), // a fork
    pr(24, 'Revert "Fix undo" again', true), // not the revert title
  ];
  assert.deepEqual(countAutoMerges(comments, prs, cfg), { autoMerged: 3, reverted: 1 });
});

test('countAutoMerges with since leaves out older Auto-merge comments', () => {
  const comments = [handed(10, { at: '2026-11-01T10:00:00Z' }), handed(11, { at: '2026-11-02T00:00:00Z' })];
  const prs = [pr(10, 'Fix undo', true), pr(11, 'Add redo', true), pr(20, 'Revert "Fix undo"', true)];
  assert.deepEqual(countAutoMerges(comments, prs, cfg, '2026-11-02'), { autoMerged: 1, reverted: 0 });
});

test('formatAutoMerges prints one line', () => {
  assert.equal(formatAutoMerges({ autoMerged: 3, reverted: 1 }), 'auto-merged: 3 · reverted: 1');
});

test('the stats of a target show the auto-merge line', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { runStats } = await import('../stats.mjs');
  const root = mkdtempSync(join(tmpdir(), 'factory-stats-automerge-'));
  mkdirSync(join(root, 'targets'));
  writeFileSync(join(root, 'targets', 'demo.mjs'), `export default ${JSON.stringify({ ...cfg, baseBranch: 'main' })};\n`);
  const gh = {
    listAllPullRequests: async () => [],
    listAllPullRequestTitles: async () => [pr(10, 'Fix undo', true), pr(11, 'Add redo', true), pr(20, 'Revert "Fix undo"', true)],
    listAllIssueComments: async () => [handed(10), handed(11)],
  };
  const lines = [];
  assert.equal(await runStats(['demo'], { factoryRoot: root, gh, log: (s) => lines.push(s) }), true);
  assert.match(lines.join('\n'), /^auto-merged: 2 · reverted: 1$/m);
});

// Stats counts draft stops by their new wording as well as the old.
const list = '- existing test changed (M): test/readme.test.mjs';

test('a stop comment with the new draft wording counts as protected files (draft)', () => {
  const bodies = [
    stopped('implement', reasons.draft('https://github.com/x/y/pull/90', list), 'agent:needs-human', 'factory/issue-88'),
    stopped('review', reasons.reworkDraft(list), 'agent:needs-human'),
    stopped('merge', reasons.mergeDraft(list), 'agent:needs-human'),
  ];
  for (const body of bodies) {
    assert.doesNotMatch(body, /touches protected files/);
    assert.equal(stopLabel(body), 'protected files (draft)');
  }
});

describe('session usage', () => {
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

  test('a session log that cannot be read counts as an unreadable session, the others still count', () => {
    const logs = join(mkdtempSync(join(tmpdir(), 'stats-unreadable-')), 'logs');
    const at = Date.parse('2026-11-10T10:00:00Z');
    mkdirSync(join(logs, 'issue-7'), { recursive: true });
    writeFileSync(join(logs, 'issue-7', `${at}-1-gate.json`), result());
    mkdirSync(join(logs, 'issue-7', `${at + 1}-2-implement.json`)); // a folder: reading it fails
    assert.deepEqual(readSessions(logs).map((x) => [x.issue, x.stage, x.at, x.usage === null]).sort(), [
      [7, 'gate', at, false], [7, 'implement', at + 1, true],
    ].sort());
    const out = agentUseSection(logs);
    assert.match(out, /\n {2}total\s+2\s+3\s/);
    assert.match(out, /\n {2}stopped early: 1 unreadable \(timed out or crashed\)\n/);
  });

  test('formatAgentUse has no most used line when no session has a cost', () => {
    const g = groupAgentUse([s(1, 'gate', u(1, 10, 0, 5, { costUsd: undefined })), s(2, 'implement', null)]);
    assert.deepEqual(g.top, []);
    assert.equal(formatAgentUse(g), [
      'agent use (from session logs; ≈ cost is an estimate at API list price, not your bill)',
      '  stage       sessions   turns   tokens in (cached)      out   ≈ cost',
      '  gate               1       1              10 (0%)        5        -',
      '  implement          1       -                    -        -        -',
      '  total              2       1              10 (0%)        5        -',
      '  stopped early: 1 unreadable (timed out or crashed)',
      '  tool calls refused: 0',
    ].join('\n'));
  });

  test('formatAgentUse shows no cached percentage without cachedIn or with no tokens in', () => {
    const g = groupAgentUse([s(1, 'gate', u(1, 0, 0, 5)), s(2, 'review', u(1, 2000, undefined, 5))]);
    const rows = formatAgentUse(g).split('\n').slice(2, 5);
    assert.deepEqual(rows, [
      '  gate               1       1                    0        5    $1.00',
      '  review             1       1                   2k        5    $1.00',
      '  total              2       2              2k (0%)       10    $2.00', // the gate's cachedIn 0 counts in the total
    ]);
  });
});
