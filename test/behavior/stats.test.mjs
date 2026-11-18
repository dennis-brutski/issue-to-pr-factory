// node stats.mjs <target> against the fake gh: the printed numbers are right, and nothing changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../lib/exec.mjs';
import { world, FAKES_BIN } from './world.mjs';

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
