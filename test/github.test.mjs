import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run } from '../lib/exec.mjs';
import { toItems, listPullRequests, listCandidates } from '../lib/github.mjs';
import { config } from '../config.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/graphql-items.json', import.meta.url), 'utf8'));

test('toItems maps issues and pull requests to the Item shape', () => {
  const items = toItems(fixture);
  const issue = items.find((i) => i.number === 1);
  assert.equal(issue.kind, 'issue');
  assert.equal(issue.author, 'dennis-brutski');
  assert.deepEqual(issue.labels, ['agent:implement', 'bug']);
  assert.deepEqual(issue.labelEvents[0], { label: 'agent:implement', actor: 'dennis-brutski', at: '2026-11-01T10:00:00Z' });
  assert.deepEqual(issue.comments, [{ author: 'dennis-brutski', body: 'keep it small', at: '2026-11-01T10:05:00Z' }]);
  assert.equal(issue.headRef, null);
  const pr = items.find((i) => i.number === 4);
  assert.equal(pr.kind, 'pr');
  assert.equal(pr.headRef, 'factory/issue-1');
  assert.equal(pr.headRepo, 'example/web-app');
});
test('bodyEditedAt carries lastEditedAt', () =>
  assert.equal(toItems(fixture).find((i) => i.number === 2).bodyEditedAt, '2026-11-02T12:00:00Z'));
test('review-thread comments are folded into comments, with their file', () => {
  const c = toItems(fixture).find((i) => i.number === 4).comments.find((x) => x.body.includes('rename this helper'));
  assert.ok(c);
  assert.match(c.body, /src\/state\.js/);
});
test('review summaries are folded in and empty ones dropped', () => {
  const bodies = toItems(fixture).find((i) => i.number === 4).comments.map((x) => x.body);
  assert.ok(bodies.includes('overall fine'));
  assert.ok(!bodies.includes(''));
});
test('a deleted author becomes an empty login, never the owner', () => {
  const ghost = toItems(fixture).find((i) => i.number === 3);
  assert.equal(ghost.author, '');
  assert.equal(ghost.labelEvents[0].actor, '');
  assert.equal(ghost.comments[0].author, '');
});
test('a pull request whose fork was deleted has an empty headRepo', () =>
  assert.equal(toItems(fixture).find((i) => i.number === 5).headRepo, ''));
test('run reports a non-zero exit without throwing', async () =>
  assert.equal((await run('node', ['-e', 'process.exit(3)'])).code, 3));
test('run captures stdout and stderr', async () => {
  const r = await run('node', ['-e', 'console.log("out"); console.error("err")']);
  assert.equal(r.stdout.trim(), 'out'); assert.equal(r.stderr.trim(), 'err');
});
test('run passes input on stdin', async () =>
  assert.equal((await run('cat', [], { input: 'hello' })).stdout, 'hello'));
test('run kills on timeout', async () => {
  const r = await run('node', ['-e', 'setTimeout(()=>{}, 60000)'], { timeoutMs: 200 });
  assert.equal(r.timedOut, true);
});
test('run reports a missing program without throwing', async () =>
  assert.notEqual((await run('definitely-not-a-program-xyz', [])).code, 0));
test('renames carry who changed the title and when', () => {
  const data = { data: { repository: { issues: { nodes: [{ number: 1, title: 't', renames: { nodes: [{ createdAt: '2026-11-02T12:00:00Z', actor: { login: 'mallory' } }, null] } }] } } } };
  assert.deepEqual(toItems(data)[0].renames, [{ actor: 'mallory', at: '2026-11-02T12:00:00Z' }]);
});

const cfg = { ...config, repo: 'dennis-brutski/demo' };
const node = (number, o = {}) => ({ number, title: `#${number}`, body: '', author: { login: 'dennis-brutski' }, ...o });

test('toItems gives a pull request its mergeable state', () => {
  const items = toItems({ data: { repository: { issues: { nodes: [node(1)] },
    pullRequests: { nodes: [node(2, { mergeable: 'CONFLICTING' }), node(3)] } } } });
  assert.deepEqual(items.map((i) => [i.number, i.mergeable]), [[1, null], [2, 'CONFLICTING'], [3, null]]);
});
test('listPullRequests pages all open pull requests with their mergeable state', async () => {
  const pages = {
    '': { nodes: [node(4, { mergeable: 'MERGEABLE' })], pageInfo: { hasNextPage: true, endCursor: 'p1' } },
    p1: { nodes: [node(5, { mergeable: 'CONFLICTING' })], pageInfo: { hasNextPage: false, endCursor: 'p2' } },
  };
  const asked = [];
  const items = await listPullRequests(cfg, async (query, after) => { asked.push([query, after]); return pages[after ?? '']; });
  assert.deepEqual(items.map((i) => [i.kind, i.number, i.mergeable]), [['pr', 4, 'MERGEABLE'], ['pr', 5, 'CONFLICTING']]);
  assert.deepEqual(asked, [['conflicts', null], ['conflicts', 'p1']]);
});

describe('pages', () => {
  const node = (number) => ({ number, title: `#${number}`, body: '', author: { login: 'dennis-brutski' } });

  test('listCandidates merges two pages of issues and of pull requests in order', async () => {
    const pages = {
      issues: { '': { nodes: [node(1), node(2)], pageInfo: { hasNextPage: true, endCursor: 'i1' } },
        i1: { nodes: [node(3)], pageInfo: { hasNextPage: false, endCursor: 'i2' } } },
      pullRequests: { '': { nodes: [node(4)], pageInfo: { hasNextPage: true, endCursor: 'p1' } },
        p1: { nodes: [node(5), node(6)], pageInfo: { hasNextPage: false, endCursor: 'p2' } } },
    };
    const asked = [];
    const fetchPage = async (kind, after) => { asked.push([kind, after]); return pages[kind][after ?? '']; };
    const items = await listCandidates(cfg, fetchPage);
    assert.deepEqual(items.map((i) => [i.kind, i.number]), [['issue', 1], ['issue', 2], ['issue', 3], ['pr', 4], ['pr', 5], ['pr', 6]]);
    assert.deepEqual(asked, [['issues', null], ['issues', 'i1'], ['pullRequests', null], ['pullRequests', 'p1']]);
  });
  test('a page without nodes or pageInfo ends the listing without failing', async () => {
    const items = await listCandidates(cfg, async (kind) => (kind === 'issues' ? { nodes: [node(1)] } : {}));
    assert.deepEqual(items.map((i) => [i.kind, i.number]), [['issue', 1]]);
  });
});
