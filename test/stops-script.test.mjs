import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInbox } from '../stops.mjs';
import { stopped } from '../lib/comments.mjs';
import { tempDir } from './fakes/tmp.mjs';

const script = fileURLToPath(new URL('../stops.mjs', import.meta.url));

function root(targets) {
  const r = tempDir('factory-stops-');
  mkdirSync(join(r, 'targets'));
  for (const [name, repo] of Object.entries(targets))
    writeFileSync(join(r, 'targets', `${name}.mjs`), `export default ${JSON.stringify({ repo, owner: 'me', baseBranch: 'main' })};\n`);
  return r;
}
const STOP = stopped('implement', 'A check failed.', 'agent:needs-human');
const item = (number, o = {}) => ({ number, kind: 'issue', title: `Item ${number}`, body: `Body ${number}`, labels: ['agent:needs-human'], headRef: null,
  comments: [{ author: 'me', body: STOP, at: '2026-11-01T10:00:00Z' }], ...o });
const fakeGh = (byRepo) => ({
  listCandidates: async (cfg) => {
    if (!byRepo[cfg.repo]) throw new Error('gh cannot reach the repo');
    return byRepo[cfg.repo];
  },
});
const remote = (url) => async () => url;

test('every target: its stops, with the worktree when it exists', async () => {
  const r = root({ one: 'me/one', two: 'me/two' });
  mkdirSync(join(r, 'runs', 'one', 'worktrees', 'issue-1'), { recursive: true });
  const gh = fakeGh({ 'me/one': [item(1), item(2, { labels: ['agent:implement'] })], 'me/two': [] });
  const { ok, report } = await runInbox([], { factoryRoot: r, gh, remote: remote('') });
  assert.equal(ok, true);
  assert.deepEqual(report, [
    { target: 'one', repo: 'me/one', stops: [{ number: 1, kind: 'issue', title: 'Item 1', url: 'https://github.com/me/one/issues/1',
      body: 'Body 1', stop: STOP, answers: [], worktree: join(r, 'runs', 'one', 'worktrees', 'issue-1') }] },
    { target: 'two', repo: 'me/two', stops: [] },
  ]);
});

test('one target failing still reports the others', async () => {
  const r = root({ one: 'me/one', two: 'me/two' });
  const { ok, report } = await runInbox([], { factoryRoot: r, gh: fakeGh({ 'me/two': [item(4)] }), remote: remote('') });
  assert.equal(ok, false);
  assert.deepEqual(report[0], { target: 'one', error: 'gh cannot reach the repo' });
  assert.equal(report[1].stops[0].number, 4);
});

test('a named target reports only that one', async () => {
  const r = root({ one: 'me/one', two: 'me/two' });
  const { report } = await runInbox(['two'], { factoryRoot: r, gh: fakeGh({ 'me/two': [] }), remote: remote('') });
  assert.deepEqual(report.map((t) => t.target), ['two']);
});

test('--current picks the target of the folder\'s remote', async () => {
  const r = root({ one: 'me/one', two: 'me/two' });
  const { report } = await runInbox(['--current'], { factoryRoot: r, gh: fakeGh({ 'me/two': [] }), remote: remote('https://github.com/me/two.git') });
  assert.deepEqual(report.map((t) => t.target), ['two']);
});

test('--current outside a target stops and says so', async () => {
  const r = root({ one: 'me/one' });
  await assert.rejects(runInbox(['--current'], { factoryRoot: r, gh: fakeGh({}), remote: remote('https://github.com/me/other.git') }),
    /this folder is not a target: https:\/\/github.com\/me\/other.git/);
});

test('run as a script with an unknown target, it fails and says why', () => {
  const r = spawnSync(process.execPath, [script, 'no-such-target'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /inbox cannot run: unknown target "no-such-target"/);
});
