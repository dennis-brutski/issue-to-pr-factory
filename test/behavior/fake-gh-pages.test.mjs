// The fake gh pages GraphQL results like GitHub does; checked against the real adapter.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../../config.mjs';
import { run } from '../../lib/exec.mjs';
import * as gh from '../../lib/github.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), 'fakes', 'bin');
const cfg = { ...config, repo: 'dennis-brutski/demo', baseBranch: 'master' };
const T = '2026-11-01T10:00:00Z';
const issue = (number, kind = 'issue') => ({ number, kind, title: `#${number}`, body: '', author: 'dennis-brutski', state: 'OPEN',
  labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }], comments: [],
  ...(kind === 'pr' ? { headRefName: `factory/issue-${number}`, headRepo: 'dennis-brutski/demo' } : {}) });

beforeEach(() => {
  if (!existsSync(join(BIN, 'gh'))) throw new Error(`fake gh missing at ${BIN}/gh`);
  const stateFile = join(mkdtempSync(join(tmpdir(), 'fake-gh-')), 'state.json');
  const items = [];
  for (let n = 1; n <= 120; n++) items.push(issue(n));
  for (let n = 121; n <= 175; n++) items.push(issue(n, 'pr'));
  writeFileSync(stateFile, JSON.stringify({ login: 'dennis-brutski', nextNumber: 176, calls: [], items }));
  process.env.FAKE_GH_STATE = stateFile;
  if (!process.env.PATH.startsWith(BIN)) process.env.PATH = `${BIN}:${process.env.PATH}`;
});

test('listCandidates pages through more than 50 issues and pull requests', async () => {
  const items = await gh.listCandidates(cfg);
  assert.deepEqual(items.map((i) => i.number), Array.from({ length: 175 }, (_, k) => k + 1));
  assert.equal(items.filter((i) => i.kind === 'pr').length, 55);
});

test('the fake gh returns at most the requested page size, with a cursor', async () => {
  const q = 'query($after: String) { repository(owner: "o", name: "n") { issues(states: OPEN, first: 50, after: $after) { pageInfo { hasNextPage endCursor } nodes { number } } } }';
  const page = async (after) => {
    const args = ['api', 'graphql', '-f', `query=${q}`, '-f', 'labels[]=agent:implement'];
    if (after) args.push('-f', `after=${after}`);
    const r = await run('gh', args);
    assert.equal(r.code, 0, r.stderr);
    return JSON.parse(r.stdout).data.repository.issues;
  };
  const first = await page(null);
  assert.equal(first.nodes.length, 50);
  assert.equal(first.pageInfo.hasNextPage, true);
  const last = await page((await page(first.pageInfo.endCursor)).pageInfo.endCursor);
  assert.deepEqual(last.nodes.map((n) => n.number), Array.from({ length: 20 }, (_, k) => k + 101));
  assert.equal(last.pageInfo.hasNextPage, false);
});
