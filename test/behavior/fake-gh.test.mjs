// The fake gh, checked against the real adapter in lib/github.mjs.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../../config.mjs';
import { run } from '../../lib/exec.mjs';
import * as gh from '../../lib/github.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), 'fakes', 'bin');
const cfg = { ...config, repo: 'dennis-brutski/demo', baseBranch: 'master' };
let stateFile;
const state = () => JSON.parse(readFileSync(stateFile, 'utf8'));
const write = (s) => writeFileSync(stateFile, JSON.stringify(s));
const T = '2026-11-01T10:00:00Z';

beforeEach(() => {
  // Never fall through to the real gh: these tests would then talk to GitHub.
  if (!existsSync(join(BIN, 'gh'))) throw new Error(`fake gh missing at ${BIN}/gh`);
  stateFile = join(mkdtempSync(join(tmpdir(), 'fake-gh-')), 'state.json');
  write({
    login: 'dennis-brutski', nextNumber: 2, calls: [],
    items: [{ number: 1, kind: 'issue', title: 'Fix a', body: 'Do it.', author: 'dennis-brutski', state: 'OPEN',
      labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }], comments: [] }],
  });
  process.env.FAKE_GH_STATE = stateFile;
  if (!process.env.PATH.startsWith(BIN)) process.env.PATH = `${BIN}:${process.env.PATH}`;
});

test('listCandidates sees a labelled open issue and its label event', async () => {
  const items = await gh.listCandidates(cfg);
  assert.equal(items.length, 1);
  assert.equal(items[0].number, 1);
  assert.equal(items[0].labelEvents[0].actor, 'dennis-brutski');
});
test('addLabel, removeLabel and comment change the state', async () => {
  await gh.addLabel(cfg, 1, 'agent:in-progress');
  assert.ok(state().items[0].labels.includes('agent:in-progress'));
  await gh.removeLabel(cfg, 1, 'agent:in-progress');
  assert.ok(!state().items[0].labels.includes('agent:in-progress'));
  await gh.comment(cfg, 1, 'hello');
  assert.deepEqual(state().items[0].comments.map((c) => [c.author, c.body]), [['dennis-brutski', 'hello']]);
});
test('removeLabel of a missing label is not an error', async () => {
  await gh.removeLabel(cfg, 1, 'agent:done');
});
test('openPullRequest, findPullRequest, setDraft and updatePullRequestBody round-trip', async () => {
  const pr = await gh.openPullRequest(cfg, { branch: 'factory/issue-1', title: 't', body: 'b', draft: true });
  assert.deepEqual(pr, { number: 2, url: 'https://github.com/dennis-brutski/demo/pull/2' });
  assert.equal((await gh.findPullRequest(cfg, 'factory/issue-1')).isDraft, true);
  await gh.setDraft(cfg, 2, false);
  assert.equal((await gh.findPullRequest(cfg, 'factory/issue-1')).isDraft, false);
  await gh.updatePullRequestBody(cfg, 2, 'new body');
  assert.equal(state().items.find((i) => i.number === 2).body, 'new body');
});
test('isFinished is true once the pull request is merged', async () => {
  await gh.openPullRequest(cfg, { branch: 'factory/issue-1', title: 't', body: 'b', draft: false });
  assert.equal(await gh.isFinished(cfg, 1), false);
  const s = state(); s.items.find((i) => i.number === 2).state = 'MERGED'; write(s);
  assert.equal(await gh.isFinished(cfg, 1), true);
});
test('authenticatedLogin returns the login', async () => {
  assert.equal(await gh.authenticatedLogin(), 'dennis-brutski');
});
test('an unsupported command fails loudly', async () => {
  const r = await run('gh', ['repo', 'view']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unsupported command/);
});
test('a failed command does not leave the state locked', async () => {
  await run('gh', ['repo', 'view']);
  const r = await run('gh', ['api', 'user', '--jq', '.login'], { timeoutMs: 2000 });
  assert.equal(r.code, 0, r.stderr);
});
test('listLabels and createLabel round-trip', async () => {
  assert.deepEqual(await gh.listLabels(cfg), []);
  await gh.createLabel(cfg, 'agent:implement');
  assert.deepEqual(await gh.listLabels(cfg), ['agent:implement']);
});
