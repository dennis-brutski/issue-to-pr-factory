// inbox.mjs: the factory's open stops, as JSON for the /factory-inbox skill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopped, didNotStart, NO_NEW_COMMENTS, newestPark } from '../lib/comments.mjs';

const NH = 'agent:needs-human';
const c = (author, body, at) => ({ author, body, at });

test('newestPark picks the newest stop and its stage', () => {
  const comments = [
    c('me', stopped('gate', 'The issue is not clear enough to build without guessing.', NH), '2026-11-01T10:00:00Z'),
    c('me', stopped('implement', 'The agent could not finish.', NH), '2026-11-02T10:00:00Z'),
  ];
  const park = newestPark(comments, 'me');
  assert.equal(park.stage, 'implement');
  assert.equal(park.at, '2026-11-02T10:00:00Z');
  assert.equal(park.body, comments[1].body);
});

test('newestPark counts a no-new-comments stop', () => {
  const comments = [c('me', stopped('review', NO_NEW_COMMENTS, NH), '2026-11-03T10:00:00Z')];
  assert.equal(newestPark(comments, 'Me')?.stage, 'review');
});

test('newestPark returns a did-not-start park with no stage', () => {
  const comments = [c('me', didNotStart('issue was edited after it was approved', NH), '2026-11-03T10:00:00Z')];
  const park = newestPark(comments, 'me');
  assert.equal(park.stage, null);
  assert.equal(park.at, '2026-11-03T10:00:00Z');
});

test('newestPark ignores 🏭 comments by others and plain owner comments', () => {
  const comments = [
    c('someone', stopped('gate', 'Fake.', NH), '2026-11-03T10:00:00Z'),
    c('me', 'Please try again.', '2026-11-04T10:00:00Z'),
  ];
  assert.equal(newestPark(comments, 'me'), null);
});

// --- inbox.mjs: toStops and runInbox ---
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toStops, runInbox } from '../inbox.mjs';

const cfg = { repo: 'me/repo', owner: 'me', runDir: '/runs/repo', states: { needsHuman: NH } };
const item = (over = {}) => ({ number: 5, kind: 'issue', title: 'Do a thing', labels: [NH], comments: [], headRef: null, ...over });
const stopAt = (at, stage = 'implement') => c('me', stopped(stage, 'The agent could not finish.', NH), at);

test('toStops keeps only items with agent:needs-human', () => {
  const stops = toStops([item({ number: 1 }), item({ number: 2, labels: ['agent:in-progress'] })], cfg, () => false);
  assert.deepEqual(stops.map((s) => s.number), [1]);
});

test('toStops gives a pull request its issue\'s worktree', () => {
  const [s] = toStops([item({ number: 9, kind: 'pr', headRef: 'factory/issue-7', comments: [stopAt('2026-11-02T10:00:00Z', 'review')] })], cfg, () => true);
  assert.ok(s.worktree.endsWith(join('worktrees', 'issue-7')), s.worktree);
  assert.equal(s.worktreeExists, true);
  assert.equal(s.url, 'https://github.com/me/repo/pull/9');
  assert.equal(s.kind, 'pr');
  assert.equal(s.stage, 'review');
  assert.equal(s.label, 'agent could not finish');
  assert.equal(s.stoppedAt, '2026-11-02T10:00:00Z');
});

test('toStops lists a hand-set needs-human with no factory comment', () => {
  const [s] = toStops([item({ comments: [c('me', 'I set this by hand.', '2026-11-01T10:00:00Z')] })], cfg, () => false);
  assert.equal(s.stop, '');
  assert.equal(s.stoppedAt, null);
  assert.equal(s.stage, null);
  assert.equal(s.label, 'no factory comment');
  assert.equal(s.url, 'https://github.com/me/repo/issues/5');
  assert.ok(s.worktree.endsWith(join('worktrees', 'issue-5')));
  assert.equal(s.worktreeExists, false);
});

test('toStops passes on only the owner\'s own comments after the stop', () => {
  const comments = [
    c('me', 'Before the stop.', '2026-11-01T09:00:00Z'),
    stopAt('2026-11-01T10:00:00Z'),
    c('someone', 'Not the owner.', '2026-11-01T11:00:00Z'),
    c('me', '🏭 Pull request: https://example.com', '2026-11-01T12:00:00Z'),
    c('Me', 'Use the second option.', '2026-11-01T13:00:00Z'),
  ];
  const [s] = toStops([item({ comments })], cfg, () => false);
  assert.deepEqual(s.since, ['Use the second option.']);
});

test('toStops carries the target\'s notebookId, null when unset', () => {
  assert.equal(toStops([item()], cfg, () => false)[0].notebookId, null);
  assert.equal(toStops([item()], { ...cfg, notebookId: 'nb-1' }, () => false)[0].notebookId, 'nb-1');
});

function root(targets) {
  const r = mkdtempSync(join(tmpdir(), 'factory-inbox-'));
  mkdirSync(join(r, 'targets'));
  for (const [name, repo] of Object.entries(targets)) {
    writeFileSync(join(r, 'targets', `${name}.mjs`), `export default ${JSON.stringify({ repo, owner: 'me', baseBranch: 'main' })};\n`);
  }
  return r;
}
const fakeGh = (byRepo, failing = []) => ({
  listCandidates: async (cfg) => {
    if (failing.includes(cfg.repo)) throw new Error('gh cannot reach the repo');
    return byRepo[cfg.repo] ?? [];
  },
});
async function inbox(r, args, gh) {
  const out = [], err = [];
  const ok = await runInbox(args, { factoryRoot: r, gh, log: (s) => out.push(s), warn: (s) => err.push(s) });
  return { ok, out, err };
}

test('runInbox prints every target\'s stops in one array, oldest first', async () => {
  const r = root({ alpha: 'me/alpha', zeta: 'me/zeta' });
  const gh = fakeGh({
    'me/alpha': [item({ number: 1, comments: [stopAt('2026-11-05T10:00:00Z')] })],
    'me/zeta': [item({ number: 2, comments: [stopAt('2026-11-01T10:00:00Z')] }), item({ number: 3 })],
  });
  const { ok, out, err } = await inbox(r, [], gh);
  assert.equal(ok, true);
  assert.deepEqual(err, []);
  assert.equal(out.length, 1);
  const stops = JSON.parse(out[0]);
  assert.deepEqual(stops.map((s) => `${s.repo}#${s.number}`), ['me/zeta#3', 'me/zeta#2', 'me/alpha#1']);
  assert.ok(stops[2].worktree.startsWith(join(r, 'runs', 'alpha', 'worktrees')));
});

test('runInbox with a target lists only that target', async () => {
  const r = root({ alpha: 'me/alpha', zeta: 'me/zeta' });
  const gh = fakeGh({ 'me/alpha': [item({ number: 1 })], 'me/zeta': [item({ number: 2 })] });
  const { ok, out } = await inbox(r, ['zeta'], gh);
  assert.equal(ok, true);
  assert.deepEqual(JSON.parse(out[0]).map((s) => s.repo), ['me/zeta']);
});

test('runInbox keeps going when one target fails and returns false', async () => {
  const r = root({ alpha: 'me/alpha', zeta: 'me/zeta' });
  const gh = fakeGh({ 'me/zeta': [item({ number: 2 })] }, ['me/alpha']);
  const { ok, out, err } = await inbox(r, [], gh);
  assert.equal(ok, false);
  assert.deepEqual(err, ['alpha: could not read the inbox: gh cannot reach the repo']);
  assert.deepEqual(JSON.parse(out[0]).map((s) => s.number), [2]);
});
