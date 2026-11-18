import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countPullRequests, stopLabel, groupStops, formatStats } from '../stats.mjs';

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
