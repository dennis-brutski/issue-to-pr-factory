// The fake gh, checked against the real adapter in lib/github.mjs.
import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../../config.mjs';
import { run } from '../../lib/exec.mjs';
import * as gh from '../../lib/github.mjs';
import { tempDir } from '../fakes/tmp.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), 'fakes', 'bin');
const cfg = { ...config, repo: 'dennis-brutski/demo', baseBranch: 'master' };
const T = '2026-11-01T10:00:00Z';

describe('gh commands', () => {
  let stateFile;
  const state = () => JSON.parse(readFileSync(stateFile, 'utf8'));
  const write = (s) => writeFileSync(stateFile, JSON.stringify(s));

  beforeEach(() => {
    // Never fall through to the real gh: these tests would then talk to GitHub.
    if (!existsSync(join(BIN, 'gh'))) throw new Error(`fake gh missing at ${BIN}/gh`);
    stateFile = join(tempDir('fake-gh-'), 'state.json');
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
  test('listCandidates returns the blocked-by links', async () => {
    const s = state();
    s.items[0].blockedBy = [2];
    s.items.push({ number: 2, kind: 'issue', title: 'First', body: '', author: 'dennis-brutski', state: 'OPEN', labels: [], labelEvents: [], comments: [] });
    write(s);
    const [item] = await gh.listCandidates(cfg);
    assert.deepEqual(item.blockedBy, [{ number: 2, repo: cfg.repo, open: true }]);
  });
  test('listOpenIssues lists every open issue, labelled or not', async () => {
    const s = state();
    const plain = { kind: 'issue', body: '', author: 'dennis-brutski', labels: [], labelEvents: [], comments: [] };
    s.items.push({ ...plain, number: 2, title: 'Plain', state: 'OPEN', subIssues: { total: 2, completed: 1 }, pullRequests: [{ number: 9, state: 'OPEN' }] },
      { ...plain, number: 3, title: 'Closed', state: 'CLOSED' });
    write(s);
    const issues = await gh.listOpenIssues(cfg);
    assert.deepEqual(issues.map((i) => i.number), [1, 2]);
    assert.deepEqual(issues[0].labels, ['agent:implement']);
    assert.deepEqual(issues[1], { number: 2, title: 'Plain', url: `https://github.com/${cfg.repo}/issues/2`, body: '', labels: [], blockedBy: [],
      subIssues: { total: 2, completed: 1 }, pullRequests: [{ number: 9, open: true }] });
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
  test('removeLabel that gh refuses throws with gh\'s message', async () => {
    const s = state(); s.removeLabelError = 'gh: Resource not accessible by integration (HTTP 403)'; write(s);
    await assert.rejects(gh.removeLabel(cfg, 1, 'agent:implement'),
      { message: 'removing label agent:implement from #1 failed: gh: Resource not accessible by integration (HTTP 403)' });
    assert.deepEqual(state().items[0].labels, ['agent:implement']);
  });
  test('isFinished is true for a closed issue, without looking for pull requests', async () => {
    const s = state(); s.items[0].state = 'CLOSED'; write(s);
    assert.equal(await gh.isFinished(cfg, 1), true);
    assert.deepEqual(state().calls, [['api', 'repos/dennis-brutski/demo/issues/1', '--jq', '.state']]);
  });
  test('createLabel gives a label without a style of its own colour ededed and no description', async () => {
    await gh.createLabel(cfg, 'wontfix');
    assert.deepEqual(state().labelStyles, { wontfix: { color: 'ededed', description: '' } });
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
  test('listCandidates sees who renamed an issue', async () => {
    const s = state(); s.items[0].renames = [{ actor: 'mallory', at: T }]; write(s);
    assert.deepEqual((await gh.listCandidates(cfg))[0].renames, [{ actor: 'mallory', at: T }]);
  });
  test('createLabel gives each factory label its colour and description', async () => {
    await gh.createLabel({ ...cfg, baseBranch: 'main' }, 'agent:merge');
    await gh.createLabel(cfg, 'agent:needs-human');
    assert.deepEqual(state().labelStyles, {
      'agent:merge': { color: '1d76db', description: 'Factory: merge main into this branch' },
      'agent:needs-human': { color: 'd93f0b', description: 'Factory stopped; see its comment. Remove to retry' },
    });
  });
  test('pullRequestSize reads additions and deletions of a pull request', async () => {
    await gh.openPullRequest(cfg, { branch: 'factory/issue-1', title: 't', body: 'b', draft: false });
    const s = state(); Object.assign(s.items.find((i) => i.number === 2), { additions: 12, deletions: 3 }); write(s);
    assert.deepEqual(await gh.pullRequestSize(cfg, 2), { additions: 12, deletions: 3 });
    assert.deepEqual(state().calls.at(-1), ['pr', 'view', '2', '--repo', 'dennis-brutski/demo', '--json', 'additions,deletions']);
  });
  test('pullRequestBody reads the current body of a pull request', async () => {
    await gh.openPullRequest(cfg, { branch: 'factory/issue-1', title: 't', body: 'b', draft: false });
    await gh.updatePullRequestBody(cfg, 2, 'edited\nbody');
    assert.equal(await gh.pullRequestBody(cfg, 2), 'edited\nbody');
    assert.deepEqual(state().calls.at(-1), ['pr', 'view', '2', '--repo', 'dennis-brutski/demo', '--json', 'body']);
  });
  test('autoMerge asks for a squash merge once GitHub allows it', async () => {
    await gh.openPullRequest(cfg, { branch: 'factory/issue-1', title: 't', body: 'b', draft: false });
    await gh.autoMerge(cfg, 2);
    assert.deepEqual(state().calls.at(-1), ['pr', 'merge', '2', '--repo', 'dennis-brutski/demo', '--squash', '--auto']);
    assert.equal(state().items.find((i) => i.number === 2).autoMerge, 'squash');
  });
  test('autoMerge fails when the repo does not allow auto-merge', async () => {
    await gh.openPullRequest(cfg, { branch: 'factory/issue-1', title: 't', body: 'b', draft: false });
    const s = state(); s.autoMergeAllowed = false; write(s);
    await assert.rejects(gh.autoMerge(cfg, 2), /Auto merge is not allowed/);
    assert.equal(state().items.find((i) => i.number === 2).autoMerge, undefined);
  });
  test('listPullRequests sees every open pull request, labelled or not, with mergeable', async () => {
    const s = state();
    const pr = (number, o = {}) => ({ number, kind: 'pr', title: 't', body: 'b', author: 'dennis-brutski', state: 'OPEN', labels: [], labelEvents: [],
      comments: [], headRefName: `factory/issue-${number}`, headRepo: 'dennis-brutski/demo', ...o });
    s.items.push(pr(2, { mergeable: 'CONFLICTING' }), pr(3, { labels: ['agent:review'] }), pr(4, { state: 'MERGED', mergeable: 'CONFLICTING' }));
    write(s);
    const items = await gh.listPullRequests(cfg);
    assert.deepEqual(items.map((i) => [i.number, i.kind, i.headRef, i.mergeable]),
      [[2, 'pr', 'factory/issue-2', 'CONFLICTING'], [3, 'pr', 'factory/issue-3', 'MERGEABLE']]);
    assert.equal((await gh.listCandidates(cfg)).find((i) => i.number === 3).mergeable, null);
  });
});

// The fake gh pages GraphQL results like GitHub does; checked against the real adapter.
describe('pages', () => {
  const issue = (number, kind = 'issue') => ({ number, kind, title: `#${number}`, body: '', author: 'dennis-brutski', state: 'OPEN',
    labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }], comments: [],
    ...(kind === 'pr' ? { headRefName: `factory/issue-${number}`, headRepo: 'dennis-brutski/demo' } : {}) });

  beforeEach(() => {
    if (!existsSync(join(BIN, 'gh'))) throw new Error(`fake gh missing at ${BIN}/gh`);
    const stateFile = join(tempDir('fake-gh-'), 'state.json');
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
});

// The fake gh lists every pull request and issue comment, as the stats need; checked against the real adapter.
describe('all pull requests', () => {
  let stateFile;
  const pr = (number, state, extra = {}) => ({ number, kind: 'pr', title: `#${number}`, body: '', author: 'dennis-brutski', state,
    labels: [], labelEvents: [], comments: [], headRefName: `factory/issue-${number}`, headRepo: 'dennis-brutski/demo', createdAt: T, ...extra });

  beforeEach(() => {
    if (!existsSync(join(BIN, 'gh'))) throw new Error(`fake gh missing at ${BIN}/gh`);
    stateFile = join(tempDir('fake-gh-'), 'state.json');
    writeFileSync(stateFile, JSON.stringify({ login: 'dennis-brutski', nextNumber: 5, calls: [], items: [
      { number: 1, kind: 'issue', title: 'a', body: '', author: 'dennis-brutski', state: 'CLOSED', labels: [], labelEvents: [],
        comments: [{ author: 'dennis-brutski', body: 'first\nline', at: T }, { author: 'mallory', body: 'hi', at: '2026-11-02T10:00:00Z' }] },
      pr(2, 'MERGED', { body: 'Closes #1', mergedAt: '2026-11-02T10:00:00Z', comments: [{ author: 'dennis-brutski', body: 'on the pr', at: T }, { author: 'dennis-brutski', body: 'review note', at: T, path: 'a.js' }] }),
      pr(3, 'CLOSED', { headRepo: 'mallory/demo' }),
      pr(4, 'OPEN', { headRepo: null, body: null }),
    ] }));
    process.env.FAKE_GH_STATE = stateFile;
    if (!process.env.PATH.startsWith(BIN)) process.env.PATH = `${BIN}:${process.env.PATH}`;
  });

  test('listAllPullRequests returns every pull request, open or closed, with its head, outcome, merge time, title and body', async () => {
    assert.deepEqual(await gh.listAllPullRequests(cfg), [
      { number: 2, ref: 'factory/issue-2', repo: 'dennis-brutski/demo', state: 'closed', merged: true, at: T, mergedAt: '2026-11-02T10:00:00Z', title: '#2', body: 'Closes #1' },
      { number: 3, ref: 'factory/issue-3', repo: 'mallory/demo', state: 'closed', merged: false, at: T, mergedAt: null, title: '#3', body: '' },
      { number: 4, ref: 'factory/issue-4', repo: null, state: 'open', merged: false, at: T, mergedAt: null, title: '#4', body: null },
    ]);
  });

  test('listAllIssueComments returns the comments of every issue and pull request with the number they are on, not review comments', async () => {
    assert.deepEqual(await gh.listAllIssueComments(cfg), [
      { author: 'dennis-brutski', body: 'first\nline', at: T, on: 1 },
      { author: 'mallory', body: 'hi', at: '2026-11-02T10:00:00Z', on: 1 },
      { author: 'dennis-brutski', body: 'on the pr', at: T, on: 2 },
    ]);
  });

  test('the stats calls only read, all pages', async () => {
    const before = JSON.parse(readFileSync(stateFile, 'utf8')).items;
    await gh.listAllPullRequests(cfg);
    await gh.listAllIssueComments(cfg);
    const s = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.deepEqual(s.items, before);
    assert.ok(s.calls.every((c) => c[0] === 'api' && !c.includes('-X') && c.includes('--paginate')));
  });
});

describe('open issues', () => {
  beforeEach(() => {
    const stateFile = join(tempDir('fake-gh-'), 'state.json');
    const it = (number, kind, state) => ({ number, kind, title: 't', body: '', author: 'dennis-brutski', state, labels: [], labelEvents: [], comments: [] });
    writeFileSync(stateFile, JSON.stringify({ login: 'dennis-brutski', nextNumber: 6, calls: [],
      items: [it(1, 'issue', 'OPEN'), it(2, 'issue', 'CLOSED'), it(3, 'pr', 'OPEN'), it(4, 'issue', 'OPEN'), it(5, 'pr', 'MERGED')] }));
    process.env.FAKE_GH_STATE = stateFile;
    if (!process.env.PATH.startsWith(BIN)) process.env.PATH = `${BIN}:${process.env.PATH}`;
  });

  test('openIssueNumbers returns the open issues, labelled or not, and no pull requests, in one read', async () => {
    assert.deepEqual(await gh.openIssueNumbers(cfg), [1, 4]);
    const { calls } = JSON.parse(readFileSync(process.env.FAKE_GH_STATE, 'utf8'));
    assert.equal(calls.length, 1);
    assert.ok(calls[0][0] === 'api' && !calls[0].includes('-X') && calls[0].includes('--paginate'));
  });
});

