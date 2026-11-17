// What the branch changes is measured against the base commit on the remote,
// never against the clone's origin ref, which agents can move.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../lib/exec.mjs';
import * as ws from '../lib/workspace.mjs';

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid'];
const git = async (dir, ...args) => {
  const r = await run('git', ['-C', dir, ...ID, ...args]);
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const commitFile = async (dir, name, content = 'x', message = `add ${name}`) => {
  writeFileSync(join(dir, name), content);
  await git(dir, 'add', '-A'); await git(dir, 'commit', '-q', '-m', message);
};

let root, origin, seed;
beforeEach(async () => {
  const base = mkdtempSync(join(tmpdir(), 'factory-wsb-'));
  origin = join(base, 'origin.git'); seed = join(base, 'seed'); root = join(base, 'factory');
  await run('git', ['init', '-q', '--bare', '-b', 'master', origin]);
  await run('git', ['init', '-q', '-b', 'master', seed]);
  writeFileSync(join(seed, 'a.txt'), 'one\n');
  await git(seed, 'add', '-A'); await git(seed, 'commit', '-q', '-m', 'init');
  await git(seed, 'remote', 'add', 'origin', origin); await git(seed, 'push', '-q', 'origin', 'master');
  await run('mkdir', ['-p', root]);
  await ws.ensureClone(root, origin);
});

test('a moved origin ref does not hide what the branch changes', async () => {
  const { dir } = await ws.ensureWorktree(root, 7, 'master');
  await commitFile(dir, 'b.txt', 'x', 'Add b\n\nCo-Authored-By: x <x@example.invalid>');
  await git(dir, 'update-ref', 'refs/remotes/origin/master', 'HEAD');
  assert.deepEqual(await ws.changesAgainstBase(dir, 'master'), [{ status: 'A', path: 'b.txt' }]);
  assert.match(await ws.diffAgainstBase(dir, 'master', 'b.txt'), /\+x/);
  assert.equal((await ws.commitMessagesAgainstBase(dir, 'master')).length, 1);
});

test('the base is the remote commit, even one the clone has not fetched', async () => {
  const { dir } = await ws.ensureWorktree(root, 7, 'master');
  await commitFile(seed, 'later.txt'); await git(seed, 'push', '-q', 'origin', 'master');
  const sha = await git(seed, 'rev-parse', 'HEAD');
  assert.equal(await ws.remoteBase(dir, 'master'), sha);
  // The branch does not have later.txt, so against the new base nothing is added.
  assert.deepEqual(await ws.changesAgainstBase(dir, 'master'), []);
});

test('remoteBase fails when the remote has no such branch', async () => {
  const { dir } = await ws.ensureWorktree(root, 7, 'master');
  await assert.rejects(ws.remoteBase(dir, 'nope'), /nope/);
});

test('a local read uses the clone\'s ref and never asks the remote', async () => {
  const { dir } = await ws.ensureWorktree(root, 7, 'master');
  await commitFile(dir, 'b.txt');
  await git(join(root, 'repo'), 'remote', 'set-url', 'origin', join(root, 'missing.git'));
  assert.equal((await ws.commitMessagesAgainstBase(dir, 'master', { local: true })).length, 1);
});

test('checkCloneConfig refuses a changed fetch refspec', async () => {
  await git(join(root, 'repo'), 'config', 'remote.origin.fetch', '+refs/heads/x:refs/remotes/origin/x');
  await assert.rejects(ws.checkCloneConfig(root, origin), /remote\.origin\.fetch/);
});

test('checkCloneConfig refuses an extra fetch refspec', async () => {
  await git(join(root, 'repo'), 'config', '--add', 'remote.origin.fetch', '+refs/heads/master:refs/heads/elsewhere');
  await assert.rejects(ws.checkCloneConfig(root, origin), /remote\.origin\.fetch/);
});

test('checkCloneConfig accepts a plain clone\'s fetch refspec', async () => {
  assert.equal(await git(join(root, 'repo'), 'config', 'remote.origin.fetch'), '+refs/heads/*:refs/remotes/origin/*');
  await ws.checkCloneConfig(root, origin);
});
