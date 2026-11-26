// node stats.mjs <target> against the fake gh: the printed numbers are right, and nothing changes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../lib/exec.mjs';
import { world, FAKES_BIN } from './world.mjs';
import { autoMerged } from '../../lib/comments.mjs';

const STATS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'stats.mjs');
const OWNER = 'dennis-brutski', REPO = `${OWNER}/demo`;
const stopped = (reason) => `🏭 **Factory stopped (implement).**\n\n${reason}\n\nRemove the \`agent:needs-human\` label to try again.`;
const NOT_CLEAR = stopped('This issue is not clear enough to build without guessing (confidence 30 of 100, needs 70).\n\nQuestions:\n- What?');
const CHECK = stopped('`npm test` failed when the factory ran the checks:\n\n```\nnot ok\n```');

function seed(w) {
  const file = join(w.dir, 'gh.json');
  const s = JSON.parse(readFileSync(file, 'utf8'));
  const issue = (number, comments, state = 'OPEN') => ({ number, kind: 'issue', title: `#${number}`, body: '', author: OWNER, state,
    labels: [], labelEvents: [], comments });
  const pr = (number, issueNo, state, at, headRepo = REPO, headRefName = `factory/issue-${issueNo}`) => ({ number, kind: 'pr', title: `#${number}`,
    body: '', author: OWNER, state, labels: [], labelEvents: [], comments: [], headRefName, headRepo, createdAt: at });
  const c = (body, at = '2026-11-10T10:00:00Z', author = OWNER) => ({ author, body, at });
  s.items.push(
    issue(1, [c(NOT_CLEAR, '2026-10-01T10:00:00Z'), c(NOT_CLEAR)], 'CLOSED'),
    issue(2, [c(CHECK), c(NOT_CLEAR, '2026-11-10T10:00:00Z', 'mallory')]),
    issue(3, [c('🏭 **Factory did not start.**\n\nThe issue text was edited after it was approved. Check it, then remove the label.')]),
    pr(10, 1, 'MERGED', '2026-10-01T10:00:00Z'),
    pr(11, 2, 'MERGED', '2026-11-10T10:00:00Z'),
    pr(12, 3, 'CLOSED', '2026-11-10T10:00:00Z'),
    pr(13, 4, 'OPEN', '2026-11-10T10:00:00Z'),
    pr(14, 5, 'MERGED', '2026-11-10T10:00:00Z', 'mallory/demo'), // a fork
    pr(15, 0, 'MERGED', '2026-11-10T10:00:00Z', REPO, 'fix-typo'), // not a factory branch
  );
  s.items.find((i) => i.number === 11).comments.push(c(stopped('There are no new comments from you since the last push.')), c(CHECK));
  writeFileSync(file, JSON.stringify(s));
  return file;
}

const stats = (w, file, args = []) => {
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  return run(process.execPath, [STATS, w.settingsFile, ...args], { env: { ...env, PATH: `${FAKES_BIN}:${env.PATH}`, FAKE_GH_STATE: file }, timeoutMs: 20000 });
};

test('stats prints pull request counts and stops by reason, and changes nothing', async () => {
  const w = await world();
  try {
    const file = seed(w);
    const before = JSON.parse(readFileSync(file, 'utf8')).items;
    const r = await stats(w, file);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /factory\/issue-\* branches: 4 opened · 2 merged · 1 closed unmerged · 1 open/);
    assert.match(r.stdout, /:\n {3}2 {2}a check failed\n {3}2 {2}not clear enough\n {3}1 {2}edited after approval\n$/);
    const after = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(after.items, before);
    assert.ok(after.calls.every((c) => c[0] === 'api' && !c.includes('-X')), JSON.stringify(after.calls));
  } finally { w.close(); }
});

test('stats --since counts only pull requests and comments from that day on', async () => {
  const w = await world();
  try {
    const file = seed(w);
    const r = await stats(w, file, ['--since', '2026-11-01']);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /since 2026-11-01/);
    assert.match(r.stdout, /: 3 opened · 1 merged · 1 closed unmerged · 1 open/);
    assert.match(r.stdout, /:\n {3}2 {2}a check failed\n {3}1 {2}edited after approval\n {3}1 {2}not clear enough\n$/);
  } finally { w.close(); }
});

test('stats refuses a --since that is not a date', async () => {
  const w = await world();
  try {
    const r = await stats(w, seed(w), ['--since', 'yesterday']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /--since needs a date/);
  } finally { w.close(); }
});

// node stats.mjs <target> against the fake gh: an auto-merged pull request undone by a merged
// pull request titled Revert "<its title>" counts as reverted.
describe('automerge', () => {
  const STATS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'stats.mjs');
  const OWNER = 'dennis-brutski', REPO = `${OWNER}/demo`;

  test('stats counts auto-merged pull requests and the ones a merged Revert "<title>" undid', async () => {
    const w = await world();
    try {
      const file = join(w.dir, 'gh.json');
      const s = JSON.parse(readFileSync(file, 'utf8'));
      const pr = (number, title, state, headRefName) => ({ number, kind: 'pr', title, body: '', author: OWNER, state, labels: [], labelEvents: [],
        comments: [], headRefName, headRepo: REPO, createdAt: '2026-11-10T10:00:00Z' });
      const handed = (n) => ({ author: OWNER, body: autoMerged(`https://github.com/${REPO}/pull/${n}`, { reviewed: 'clean', lines: 12 }), at: '2026-11-10T10:00:00Z' });
      s.items.push(
        { number: 1, kind: 'issue', title: 'Fix undo', body: '', author: OWNER, state: 'CLOSED', labels: [], labelEvents: [], comments: [handed(10)] },
        { number: 2, kind: 'issue', title: 'Add redo', body: '', author: OWNER, state: 'CLOSED', labels: [], labelEvents: [], comments: [handed(11)] },
        pr(10, 'Fix undo', 'MERGED', 'factory/issue-1'),
        pr(11, 'Add redo', 'MERGED', 'factory/issue-2'),
        pr(12, 'Revert "Fix undo"', 'MERGED', 'undo-the-undo-fix'), // any branch: the title is what counts
      );
      writeFileSync(file, JSON.stringify(s));
      const { NODE_TEST_CONTEXT, ...env } = process.env;
      const r = await run(process.execPath, [STATS, w.settingsFile], { env: { ...env, PATH: `${FAKES_BIN}:${env.PATH}`, FAKE_GH_STATE: file }, timeoutMs: 20000 });
      assert.equal(r.code, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /^auto-merged: 2 · reverted: 1$/m);
    } finally { w.close(); }
  });
});

// node stats.mjs <target> reads the session logs in the target's run folder.
describe('session usage', () => {
  const STATS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'stats.mjs');

  const stats = (w, args = []) => {
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    return run(process.execPath, [STATS, w.settingsFile, ...args], { env: { ...env, PATH: `${FAKES_BIN}:${env.PATH}`, FAKE_GH_STATE: join(w.dir, 'gh.json') }, timeoutMs: 20000 });
  };

  test('stats says when there are no session logs yet', async () => {
    const w = await world();
    try {
      const r = await stats(w);
      assert.equal(r.code, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /\nagent use: no session logs yet\n/);
    } finally { w.close(); }
  });

  test('stats prints agent use from the session logs, and --since applies to them', async () => {
    const w = await world();
    try {
      const dir = join(w.runDir, 'logs', 'issue-4');
      mkdirSync(dir, { recursive: true });
      const at = Date.parse('2026-11-10T10:00:00Z');
      const json = JSON.stringify({ num_turns: 12, usage: { input_tokens: 1000, cache_read_input_tokens: 3000, output_tokens: 2500 }, total_cost_usd: 1.5, permission_denials: [{}], terminal_reason: 'max_turns' });
      writeFileSync(join(dir, `${at}-1-implement.json`), `${json}\n--- stderr ---\n`);
      writeFileSync(join(dir, `${at + 1}-2-review.json`), 'Killed\n--- stderr ---\n');
      const r = await stats(w);
      assert.equal(r.code, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /\nagent use \(from session logs; ≈ cost is an estimate at API list price, not your bill\)\n/);
      assert.match(r.stdout, /\n {2}implement +1 +12 +4k \(75%\) +2\.5k +\$1\.50\n/);
      assert.match(r.stdout, /\n {2}most used: #4 ≈ \$1\.50\n/);
      assert.match(r.stdout, /\n {2}stopped early: 1 max_turns · 1 unreadable \(timed out or crashed\)\n/);
      assert.match(r.stdout, /\n {2}tool calls refused: 1\n/);
      const later = await stats(w, ['--since', '2026-11-11']);
      assert.match(later.stdout, /\nagent use: no sessions since 2026-11-11\n/);
    } finally { w.close(); }
  });
});

// node stats.mjs <target> against the fake gh: reworks and stops per merged pull request, and the median wait to merge.
describe('review load', () => {
  const pr = (number, issueNo, createdAt, mergedAt, comments = []) => ({ number, kind: 'pr', title: `#${number}`, body: '', author: OWNER, state: 'MERGED',
    labels: [], labelEvents: [], comments, headRefName: `factory/issue-${issueNo}`, headRepo: REPO, createdAt, mergedAt });
  const c = (body, at = '2026-11-10T10:00:00Z') => ({ author: OWNER, body, at });
  const REWORK = '🏭 **Rework**\n\nRenamed a';

  function seedLoad(w) {
    const file = join(w.dir, 'gh.json');
    const s = JSON.parse(readFileSync(file, 'utf8'));
    s.items.push(
      { number: 1, kind: 'issue', title: '#1', body: '', author: OWNER, state: 'CLOSED', labels: [], labelEvents: [], comments: [c(NOT_CLEAR, '2026-10-01T10:00:00Z')] },
      pr(10, 1, '2026-10-20T10:00:00Z', '2026-10-21T12:00:00Z', [c(REWORK), c(CHECK)]), // 26h, 3 steps
      pr(11, 2, '2026-11-10T10:00:00Z', '2026-11-10T10:30:00Z'), // 30m, none
      pr(12, 3, '2026-11-10T10:00:00Z', '2026-11-10T14:00:00Z', [c(REWORK)]), // 4h, 1 step
    );
    writeFileSync(file, JSON.stringify(s));
    return file;
  }

  test('stats prints the review load line', async () => {
    const w = await world();
    try {
      const r = await stats(w, seedLoad(w));
      assert.equal(r.code, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /^review load: 1\.3 reworks or stops per merged PR · median 4h to merge$/m);
    } finally { w.close(); }
  });

  test('stats --since counts merged pull requests opened from that day on', async () => {
    const w = await world();
    try {
      const r = await stats(w, seedLoad(w), ['--since', '2026-11-01']);
      assert.equal(r.code, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /^review load: 0\.5 reworks or stops per merged PR · median 2h to merge$/m);
    } finally { w.close(); }
  });

  test('stats with no merged pull requests shows - in the review load line', async () => {
    const w = await world();
    try {
      const r = await stats(w, join(w.dir, 'gh.json'));
      assert.equal(r.code, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /^review load: - reworks or stops per merged PR · median - to merge$/m);
    } finally { w.close(); }
  });
});

// node stats.mjs <target> against the fake gh: closed factory pull requests by the gate confidence in their footer.
describe('gate calibration', () => {
  const footer = (n) => `Closes #1\n\n---\n🏭 Built by issue-to-pr-factory abc · model opus · gate confidence ${n} · checks: x`;
  const pr = (number, issueNo, state, body, comments = []) => ({ number, kind: 'pr', title: `#${number}`, body, author: OWNER, state,
    labels: [], labelEvents: [], comments, headRefName: `factory/issue-${issueNo}`, headRepo: REPO, createdAt: '2026-11-10T10:00:00Z', mergedAt: '2026-11-10T12:00:00Z' });
  const c = (body) => ({ author: OWNER, body, at: '2026-11-10T10:00:00Z' });
  const CONTRADICTS = stopped('This issue is not clear enough to build without guessing (confidence 90 of 100, needs 70).\n\nContradictions:\n\n- A; not A\n\nQuestions:\n\n- Which?');

  test('stats prints the gate section after the review load line and before the stops list', async () => {
    const w = await world();
    try {
      const file = join(w.dir, 'gh.json');
      const s = JSON.parse(readFileSync(file, 'utf8'));
      s.items.push(
        { number: 1, kind: 'issue', title: '#1', body: '', author: OWNER, state: 'OPEN', labels: [], labelEvents: [], comments: [c(NOT_CLEAR), c(CONTRADICTS)] },
        { number: 3, kind: 'issue', title: '#3', body: '', author: OWNER, state: 'CLOSED', labels: [], labelEvents: [], comments: [c('🏭 **Rework**\n\nRenamed a')] },
        pr(10, 2, 'MERGED', footer(75)),
        pr(11, 3, 'MERGED', footer(85)), // reworked on its issue
        pr(12, 4, 'MERGED', footer(92)),
        pr(13, 5, 'CLOSED', footer(96)),
        pr(14, 6, 'MERGED', 'no footer'),
        pr(15, 7, 'OPEN', footer(90)), // open: left out
      );
      writeFileSync(file, JSON.stringify(s));
      const r = await stats(w, file);
      assert.equal(r.code, 0, r.stderr + r.stdout);
      assert.match(r.stdout, new RegExp(['^review load: [^\\n]+',
        'gate confidence of factory pull requests: merged without rework · merged after rework · closed unmerged',
        '   70–79  1 · 0 · 0',
        '   80–89  0 · 1 · 0',
        '     90\\+  1 · 0 · 1',
        '   other  1 · 0 · 0',
        'gate stops \\(not clear enough\\): 2',
        'pull requests from factory/issue-\\* branches: [^\\n]+',
        'stops \\(agent:needs-human comments, by first line of the reason\\):',
        ' {3}2 {2}not clear enough\\n$'].join('\\n'), 'm'));
    } finally { w.close(); }
  });
});
