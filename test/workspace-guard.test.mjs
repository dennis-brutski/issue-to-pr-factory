// The workspace handle checks the clone before every git command it runs:
// agents can write the clone's config and a worktree's .git link.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../lib/exec.mjs';
import * as ws from '../lib/workspace.mjs';
import { workspace } from '../lib/workspace.mjs';
import { fakeWorkspace } from './fakes/workspace.mjs';

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
  const base = mkdtempSync(join(tmpdir(), 'factory-wsg-'));
  origin = join(base, 'origin.git'); seed = join(base, 'seed'); root = join(base, 'factory');
  await run('git', ['init', '-q', '--bare', '-b', 'master', origin]);
  await run('git', ['init', '-q', '-b', 'master', seed]);
  writeFileSync(join(seed, 'a.txt'), 'one\n');
  await git(seed, 'add', '-A'); await git(seed, 'commit', '-q', '-m', 'init');
  await git(seed, 'remote', 'add', 'origin', origin); await git(seed, 'push', '-q', 'origin', 'master');
  await run('mkdir', ['-p', root]);
  await ws.ensureClone(root, origin);
});

const handle = () => workspace({ root, url: origin, base: 'master' });
const plant = () => git(join(root, 'repo'), 'config', 'credential.helper', '!touch /tmp/pwned');

test('the handle binds root, url and base: callers pass only the issue or worktree', async () => {
  const h = handle();
  const { dir } = await h.ensureWorktree(7);
  assert.equal(dir, h.paths(7).worktree);
  await commitFile(dir, 'b.txt');
  assert.deepEqual(await h.changesAgainstBase(dir), [{ status: 'A', path: 'b.txt' }]);
  assert.match(await h.diffAgainstBase(dir, ['b.txt']), /\+x/);
  assert.equal((await h.commitMessagesAgainstBase(dir)).length, 1);
  assert.equal(await h.currentBranch(dir), 'factory/issue-7');
  assert.deepEqual(await h.listWorktrees(), [7]);
});

test('planted clone config stops every git command, worktree removal included', async () => {
  const h = handle();
  const { dir } = await h.ensureWorktree(7);
  await plant();
  for (const [name, call] of [['ensureWorktree', () => h.ensureWorktree(8)], ['headInfo', () => h.headInfo(dir)], ['isClean', () => h.isClean(dir)],
    ['changesAgainstBase', () => h.changesAgainstBase(dir)], ['mergeBase', () => h.mergeBase(dir)], ['push', () => h.push(dir, 'factory/issue-7', 'abc')],
    ['removeWorktree', () => h.removeWorktree(7)], ['ensureClone', () => h.ensureClone()], ['checkClone', () => h.checkClone()]])
    await assert.rejects(call, /credential\.helper/, name);
});

test('a changed .git link stops git in that worktree', async () => {
  const h = handle();
  const { dir } = await h.ensureWorktree(7);
  writeFileSync(join(dir, '.git'), 'gitdir: /tmp/elsewhere\n');
  await assert.rejects(() => h.headInfo(dir), /\.git link/);
  await assert.rejects(() => h.removeWorktree(7), /\.git link/);
});

test('a folder that is not one of the factory\'s worktrees is refused', async () => {
  const h = handle();
  await h.ensureWorktree(7);
  await assert.rejects(() => h.headInfo(join(root, 'repo')), /not one of the factory's worktrees/);
});

test('the in-memory fake has exactly the methods of the real handle', () => {
  assert.deepEqual(Object.keys(fakeWorkspace()).sort(), Object.keys(handle()).sort());
});
