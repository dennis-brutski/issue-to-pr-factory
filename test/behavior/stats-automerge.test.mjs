// node stats.mjs <target> against the fake gh: an auto-merged pull request undone by a merged
// pull request titled Revert "<its title>" counts as reverted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../lib/exec.mjs';
import { autoMerged } from '../../lib/comments.mjs';
import { world, FAKES_BIN } from './world.mjs';

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
