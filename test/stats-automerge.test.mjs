// npm run stats: how many pull requests were handed to auto-merge, and how many of those were reverted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countAutoMerges, formatAutoMerges } from '../stats.mjs';
import { autoMerged, autoMergeFailed } from '../lib/comments.mjs';

const cfg = { repo: 'dennis-brutski/demo', owner: 'dennis-brutski' };
const url = (n) => `https://github.com/dennis-brutski/demo/pull/${n}`;
const c = (body, extra = {}) => ({ author: 'dennis-brutski', body, at: '2026-11-10T10:00:00Z', ...extra });
const handed = (n, extra) => c(autoMerged(url(n), { reviewed: 'clean', lines: 12 }), extra);
// GitHub's revert button opens a branch revert-<number>-<head branch>.
const pr = (number, ref, merged, extra = {}) => ({ number, ref, repo: 'dennis-brutski/demo', state: merged ? 'closed' : 'open', merged, at: '2026-11-11T10:00:00Z', ...extra });

test('countAutoMerges counts the owner\'s Auto-merge comments and the merged reverts of those pull requests', () => {
  const comments = [
    handed(10), handed(11), handed(12),
    c(autoMergeFailed(url(13), 'not allowed')), // never handed over
    handed(14, { author: 'mallory' }), // not the owner
    c(`🏭 Pull request: ${url(15)}`),
  ];
  const prs = [
    pr(10, 'factory/issue-1', true), pr(11, 'factory/issue-2', true), pr(12, 'factory/issue-3', true),
    pr(20, 'revert-10-factory/issue-1', true), // reverted
    pr(21, 'revert-11-factory/issue-2', false), // revert opened, not merged
    pr(22, 'revert-14-factory/issue-5', true), // revert of a pull request not counted
    pr(23, 'revert-12-factory/issue-3', true, { repo: 'mallory/demo' }), // a fork
  ];
  assert.deepEqual(countAutoMerges(comments, prs, cfg), { autoMerged: 3, reverted: 1 });
});

test('countAutoMerges with since leaves out older Auto-merge comments', () => {
  const comments = [handed(10, { at: '2026-11-01T10:00:00Z' }), handed(11, { at: '2026-11-02T00:00:00Z' })];
  const prs = [pr(20, 'revert-10-factory/issue-1', true)];
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
  const gh = { listAllPullRequests: async () => [pr(20, 'revert-10-factory/issue-1', true)], listAllIssueComments: async () => [handed(10), handed(11)] };
  const lines = [];
  assert.equal(await runStats(['demo'], { factoryRoot: root, gh, log: (s) => lines.push(s) }), true);
  assert.match(lines.join('\n'), /^auto-merged: 2 · reverted: 1$/m);
});
