// The fake gh lists every pull request and issue comment, as the stats need; checked against the real adapter.
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
const pr = (number, state, extra = {}) => ({ number, kind: 'pr', title: `#${number}`, body: '', author: 'dennis-brutski', state,
  labels: [], labelEvents: [], comments: [], headRefName: `factory/issue-${number}`, headRepo: 'dennis-brutski/demo', createdAt: T, ...extra });

beforeEach(() => {
  if (!existsSync(join(BIN, 'gh'))) throw new Error(`fake gh missing at ${BIN}/gh`);
  stateFile = join(mkdtempSync(join(tmpdir(), 'fake-gh-')), 'state.json');
  writeFileSync(stateFile, JSON.stringify({ login: 'dennis-brutski', nextNumber: 5, calls: [], items: [
    { number: 1, kind: 'issue', title: 'a', body: '', author: 'dennis-brutski', state: 'CLOSED', labels: [], labelEvents: [],
      comments: [{ author: 'dennis-brutski', body: 'first\nline', at: T }, { author: 'mallory', body: 'hi', at: '2026-11-02T10:00:00Z' }] },
    pr(2, 'MERGED', { comments: [{ author: 'dennis-brutski', body: 'on the pr', at: T }, { author: 'dennis-brutski', body: 'review note', at: T, path: 'a.js' }] }),
    pr(3, 'CLOSED', { headRepo: 'mallory/demo' }),
    pr(4, 'OPEN', { headRepo: null }),
  ] }));
  process.env.FAKE_GH_STATE = stateFile;
  if (!process.env.PATH.startsWith(BIN)) process.env.PATH = `${BIN}:${process.env.PATH}`;
});

test('listAllPullRequests returns every pull request, open or closed, with its head and outcome', async () => {
  assert.deepEqual(await gh.listAllPullRequests(cfg), [
    { number: 2, ref: 'factory/issue-2', repo: 'dennis-brutski/demo', state: 'closed', merged: true, at: T },
    { number: 3, ref: 'factory/issue-3', repo: 'mallory/demo', state: 'closed', merged: false, at: T },
    { number: 4, ref: 'factory/issue-4', repo: null, state: 'open', merged: false, at: T },
  ]);
});

test('listAllIssueComments returns the comments of every issue and pull request, not review comments', async () => {
  assert.deepEqual(await gh.listAllIssueComments(cfg), [
    { author: 'dennis-brutski', body: 'first\nline', at: T },
    { author: 'mallory', body: 'hi', at: '2026-11-02T10:00:00Z' },
    { author: 'dennis-brutski', body: 'on the pr', at: T },
  ]);
});

test('the stats calls only read', async () => {
  const before = JSON.parse(readFileSync(stateFile, 'utf8')).items;
  await gh.listAllPullRequests(cfg);
  await gh.listAllIssueComments(cfg);
  const s = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.deepEqual(s.items, before);
  assert.ok(s.calls.every((c) => c[0] === 'api' && !c.includes('-X')));
});
