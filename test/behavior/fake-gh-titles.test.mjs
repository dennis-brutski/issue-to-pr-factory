// The fake gh lists every pull request with its title, as the auto-merge stats need; checked against the real adapter.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../../config.mjs';
import * as gh from '../../lib/github.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), 'fakes', 'bin');
const cfg = { ...config, repo: 'dennis-brutski/demo', baseBranch: 'master' };
const T = '2026-11-01T10:00:00Z';
let stateFile;
const pr = (number, state, title, extra = {}) => ({ number, kind: 'pr', title, body: '', author: 'dennis-brutski', state,
  labels: [], labelEvents: [], comments: [], headRefName: `factory/issue-${number}`, headRepo: 'dennis-brutski/demo', createdAt: T, ...extra });

beforeEach(() => {
  if (!existsSync(join(BIN, 'gh'))) throw new Error(`fake gh missing at ${BIN}/gh`);
  stateFile = join(mkdtempSync(join(tmpdir(), 'fake-gh-')), 'state.json');
  writeFileSync(stateFile, JSON.stringify({ login: 'dennis-brutski', nextNumber: 5, calls: [], items: [
    { number: 1, kind: 'issue', title: 'an issue', body: '', author: 'dennis-brutski', state: 'OPEN', labels: [], labelEvents: [], comments: [] },
    pr(2, 'MERGED', 'Fix undo'),
    pr(3, 'MERGED', 'Revert "Fix undo"', { headRefName: 'revert-2-factory/issue-2' }),
    pr(4, 'OPEN', 'From a fork', { headRepo: 'mallory/demo' }),
  ] }));
  process.env.FAKE_GH_STATE = stateFile;
  if (!process.env.PATH.startsWith(BIN)) process.env.PATH = `${BIN}:${process.env.PATH}`;
});

test('listAllPullRequestTitles returns every pull request with its title, head repo and whether it was merged', async () => {
  assert.deepEqual(await gh.listAllPullRequestTitles(cfg), [
    { number: 2, title: 'Fix undo', repo: 'dennis-brutski/demo', merged: true },
    { number: 3, title: 'Revert "Fix undo"', repo: 'dennis-brutski/demo', merged: true },
    { number: 4, title: 'From a fork', repo: 'mallory/demo', merged: false },
  ]);
});

test('listAllPullRequestTitles only reads, all pages', async () => {
  const before = JSON.parse(readFileSync(stateFile, 'utf8')).items;
  await gh.listAllPullRequestTitles(cfg);
  const s = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.deepEqual(s.items, before);
  assert.ok(s.calls.every((c) => c[0] === 'api' && !c.includes('-X') && c.includes('--paginate')));
});
