// attachBranch puts a worktree whose HEAD an agent detached back on its branch, but only when HEAD builds on it.
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
const commitFile = async (dir, name) => { writeFileSync(join(dir, name), name); await git(dir, 'add', '-A'); await git(dir, 'commit', '-q', '-m', `add ${name}`); };

let root;
beforeEach(async () => {
  const base = mkdtempSync(join(tmpdir(), 'factory-attach-'));
  const origin = join(base, 'origin.git'), seed = join(base, 'seed');
  root = join(base, 'factory');
  await run('git', ['init', '-q', '--bare', '-b', 'master', origin]);
  await run('git', ['init', '-q', '-b', 'master', seed]);
  await commitFile(seed, 'a.txt');
  await git(seed, 'remote', 'add', 'origin', origin); await git(seed, 'push', '-q', 'origin', 'master');
  await ws.ensureClone(root, origin);
});

test('a detached HEAD on top of the branch is put back on the branch', async () => {
  const { dir } = await ws.ensureWorktree(root, 7, 'master');
  await git(dir, 'checkout', '-q', '--detach');
  await commitFile(dir, 'work.txt');
  const head = (await ws.headInfo(dir)).sha;
  assert.equal(await ws.attachBranch(dir, 'factory/issue-7'), true);
  assert.equal(await ws.currentBranch(dir), 'factory/issue-7');
  assert.equal((await ws.headInfo(dir)).sha, head);
});

test('a detached HEAD that does not contain the branch tip stays as it is', async () => {
  const { dir } = await ws.ensureWorktree(root, 7, 'master');
  await commitFile(dir, 'on-branch.txt');
  await git(dir, 'checkout', '-q', '--detach', 'HEAD~1');
  await commitFile(dir, 'elsewhere.txt');
  assert.equal(await ws.attachBranch(dir, 'factory/issue-7'), false);
  assert.equal(await ws.currentBranch(dir), null);
});

test('a worktree already on a branch is left alone', async () => {
  const { dir } = await ws.ensureWorktree(root, 7, 'master');
  await git(dir, 'checkout', '-q', '-b', 'other');
  assert.equal(await ws.attachBranch(dir, 'factory/issue-7'), false);
  assert.equal(await ws.currentBranch(dir), 'other');
});
