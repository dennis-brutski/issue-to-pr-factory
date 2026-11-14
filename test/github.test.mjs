import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run } from '../lib/exec.mjs';
import { toItems } from '../lib/github.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/graphql-items.json', import.meta.url)));

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
  assert.equal(pr.headRepo, 'dennis-brutski/gin-rummy-score-pad');
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
