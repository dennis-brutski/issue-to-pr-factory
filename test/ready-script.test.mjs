import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runReady } from '../ready.mjs';
import { tempDir } from './fakes/tmp.mjs';

const script = fileURLToPath(new URL('../ready.mjs', import.meta.url));

function root(targets) {
  const r = tempDir('factory-ready-');
  mkdirSync(join(r, 'targets'));
  for (const [name, repo] of Object.entries(targets))
    writeFileSync(join(r, 'targets', `${name}.mjs`), `export default ${JSON.stringify({ repo, owner: 'me', baseBranch: 'main' })};\n`);
  return r;
}
const open = (number, o = {}) => ({ number, title: `Issue ${number}`, url: `u${number}`, body: '', labels: [], blockedBy: [],
  subIssues: { total: 0, completed: 0 }, pullRequests: [], ...o });
const fakeGh = (byRepo) => ({
  listOpenIssues: async (cfg) => {
    if (!byRepo[cfg.repo]) throw new Error('gh cannot reach the repo');
    return byRepo[cfg.repo];
  },
});
const remote = (url) => async () => url;

test('every target: its ready issues, and the skipped ones with why', async () => {
  const r = root({ one: 'me/one', two: 'me/two' });
  const gh = fakeGh({ 'me/one': [open(1), open(2, { labels: ['agent:done'] }), open(3, { body: '## Depends on\n- #1\n' })], 'me/two': [] });
  const { ok, report } = await runReady([], { factoryRoot: r, gh, remote: remote('') });
  assert.equal(ok, true);
  assert.deepEqual(report, [
    { target: 'one', repo: 'me/one', ready: [{ number: 1, title: 'Issue 1', url: 'u1' }],
      skipped: [{ number: 2, title: 'Issue 2', url: 'u2', reason: 'has agent:done' }, { number: 3, title: 'Issue 3', url: 'u3', reason: 'waits for #1' }] },
    { target: 'two', repo: 'me/two', ready: [], skipped: [] },
  ]);
});

test('one target failing still reports the others', async () => {
  const r = root({ one: 'me/one', two: 'me/two' });
  const { ok, report } = await runReady([], { factoryRoot: r, gh: fakeGh({ 'me/two': [open(4)] }), remote: remote('') });
  assert.equal(ok, false);
  assert.deepEqual(report[0], { target: 'one', error: 'gh cannot reach the repo' });
  assert.equal(report[1].ready[0].number, 4);
});

test('a named target reports only that one', async () => {
  const r = root({ one: 'me/one', two: 'me/two' });
  const { report } = await runReady(['two'], { factoryRoot: r, gh: fakeGh({ 'me/two': [] }), remote: remote('') });
  assert.deepEqual(report.map((t) => t.target), ['two']);
});

test('--current picks the target of the folder\'s remote, whatever its case', async () => {
  const r = root({ one: 'me/one', two: 'me/two' });
  const { report } = await runReady(['--current'], { factoryRoot: r, gh: fakeGh({ 'me/two': [] }), remote: remote('git@github.com:Me/Two.git') });
  assert.deepEqual(report.map((t) => t.target), ['two']);
});

test('--current outside a target stops and says so', async () => {
  const r = root({ one: 'me/one' });
  await assert.rejects(runReady(['--current'], { factoryRoot: r, gh: fakeGh({}), remote: remote('https://github.com/me/other.git') }),
    /this folder is not a target: https:\/\/github.com\/me\/other.git/);
});

test('run as a script with an unknown target, it fails and says why', () => {
  const r = spawnSync(process.execPath, [script, 'no-such-target'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ready cannot run: unknown target "no-such-target"/);
});
