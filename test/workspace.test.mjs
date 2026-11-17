import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
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
const commitFile = async (dir, name, content = 'x') => {
  writeFileSync(join(dir, name), content);
  await git(dir, 'add', '-A'); await git(dir, 'commit', '-q', '-m', `add ${name}`);
};

let root, origin, seed;
beforeEach(async () => {
  const base = mkdtempSync(join(tmpdir(), 'factory-ws-'));
  origin = join(base, 'origin.git'); seed = join(base, 'seed'); root = join(base, 'factory');
  await run('git', ['init', '-q', '--bare', '-b', 'master', origin]);
  await run('git', ['init', '-q', '-b', 'master', seed]);
  writeFileSync(join(seed, 'a.txt'), 'one\n');
  await run('mkdir', ['-p', join(seed, 'test/unit')]);
  writeFileSync(join(seed, 'test/unit/stats.test.js'), 'a long enough test file body to be detected as a rename\n'.repeat(5));
  await git(seed, 'add', '-A'); await git(seed, 'commit', '-q', '-m', 'init');
  await git(seed, 'remote', 'add', 'origin', origin); await git(seed, 'push', '-q', 'origin', 'master');
  await run('mkdir', ['-p', root]);
  await ws.ensureClone(root, origin);
});

test('paths are derived from the issue number', () => {
  const p = ws.paths('/f', 7);
  assert.deepEqual(p, { clone: '/f/repo', worktree: '/f/worktrees/issue-7', logs: '/f/logs/issue-7', branch: 'factory/issue-7' });
});
test('ensureClone is idempotent and fetches', async () => {
  await commitFile(seed, 'later.txt'); await git(seed, 'push', '-q', 'origin', 'master');
  await ws.ensureClone(root, origin);
  const { dir } = await ws.ensureWorktree(root, 1, 'master');
  assert.ok(existsSync(join(dir, 'later.txt')));
});
test('ensureWorktree creates the branch from origin/master', async () => {
  const { dir, created } = await ws.ensureWorktree(root, 7, 'master');
  assert.equal(created, true);
  assert.equal(await git(dir, 'branch', '--show-current'), 'factory/issue-7');
  assert.deepEqual(await ws.changesAgainstBase(dir, 'master'), []);
});
test('ensureWorktree reuses an existing worktree and its commits', async () => {
  const a = await ws.ensureWorktree(root, 7, 'master'); await commitFile(a.dir, 'x.txt');
  const b = await ws.ensureWorktree(root, 7, 'master');
  assert.equal(b.created, false);
  assert.deepEqual(await ws.changesAgainstBase(b.dir, 'master'), [{ status: 'A', path: 'x.txt' }]);
});
test('ensureWorktree starts from the remote branch when one exists', async () => {
  await git(seed, 'checkout', '-q', '-b', 'factory/issue-8'); await commitFile(seed, 'earlier.txt');
  await git(seed, 'push', '-q', 'origin', 'factory/issue-8');
  const { dir } = await ws.ensureWorktree(root, 8, 'master');
  assert.ok(existsSync(join(dir, 'earlier.txt')));
});
test('changesAgainstBase reports renames with oldPath', async () => {
  const { dir } = await ws.ensureWorktree(root, 7, 'master');
  await git(dir, 'mv', 'test/unit/stats.test.js', 'moved.js'); await git(dir, 'commit', '-q', '-m', 'mv');
  assert.deepEqual(await ws.changesAgainstBase(dir, 'master'), [{ status: 'R', oldPath: 'test/unit/stats.test.js', path: 'moved.js' }]);
});
test('commitMessagesAgainstBase returns full messages of new commits only', async () => {
  const { dir } = await ws.ensureWorktree(root, 7, 'master');
  writeFileSync(join(dir, 'y.txt'), 'y'); await git(dir, 'add', '-A');
  await git(dir, 'commit', '-q', '-m', 'Subject line', '-m', 'Co-Authored-By: X <x@example.invalid>');
  const msgs = await ws.commitMessagesAgainstBase(dir, 'master');
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /Subject line[\s\S]*Co-Authored-By/);
});
test('isClean notices untracked and modified files', async () => {
  const { dir } = await ws.ensureWorktree(root, 7, 'master');
  assert.equal(await ws.isClean(dir), true);
  writeFileSync(join(dir, 'stray.txt'), 's');
  assert.equal(await ws.isClean(dir), false);
});
test('headInfo returns sha and commit time', async () => {
  const { dir } = await ws.ensureWorktree(root, 7, 'master');
  const h = await ws.headInfo(dir);
  assert.match(h.sha, /^[0-9a-f]{40}$/);
  assert.ok(!Number.isNaN(Date.parse(h.committedAt)));
});
test('mergeBase is clean when master moved without conflict', async () => {
  const { dir } = await ws.ensureWorktree(root, 7, 'master'); await commitFile(dir, 'x.txt');
  await commitFile(seed, 'other.txt'); await git(seed, 'push', '-q', 'origin', 'master');
  assert.equal(await ws.mergeBase(dir, 'master'), 'clean');
  assert.ok(existsSync(join(dir, 'other.txt')));
  assert.equal(await ws.mergeResolved(dir), true);
});
test('mergeBase reports conflict and mergeResolved is false until resolved', async () => {
  const { dir } = await ws.ensureWorktree(root, 7, 'master'); await commitFile(dir, 'a.txt', 'mine\n');
  await commitFile(seed, 'a.txt', 'theirs\n'); await git(seed, 'push', '-q', 'origin', 'master');
  assert.equal(await ws.mergeBase(dir, 'master'), 'conflict');
  assert.equal(await ws.mergeResolved(dir), false);
  writeFileSync(join(dir, 'a.txt'), 'both\n'); await git(dir, 'add', '-A'); await git(dir, 'commit', '-q', '-m', 'merge');
  assert.equal(await ws.mergeResolved(dir), true);
});
test('mergeBase continues a merge that is already in progress', async () => {
  const { dir } = await ws.ensureWorktree(root, 7, 'master'); await commitFile(dir, 'a.txt', 'mine\n');
  await commitFile(seed, 'a.txt', 'theirs\n'); await git(seed, 'push', '-q', 'origin', 'master');
  await ws.mergeBase(dir, 'master');
  assert.equal(await ws.mergeBase(dir, 'master'), 'conflict');
});
test('push publishes the branch and never forces', async () => {
  const { dir } = await ws.ensureWorktree(root, 7, 'master'); await commitFile(dir, 'x.txt');
  await ws.push(dir, 'factory/issue-7', (await ws.headInfo(dir)).sha);
  assert.match(await git(seed, 'ls-remote', origin, 'factory/issue-7'), /factory\/issue-7/);
  await git(dir, 'commit', '-q', '--amend', '-m', 'rewritten');
  await assert.rejects(ws.push(dir, 'factory/issue-7', (await ws.headInfo(dir)).sha));
});
test('removeWorktree leaves no directory and no local branch', async () => {
  const { dir } = await ws.ensureWorktree(root, 7, 'master');
  writeFileSync(join(dir, 'stray.txt'), 's');
  await ws.removeWorktree(root, 7);
  assert.equal(existsSync(dir), false);
  assert.equal(await git(join(root, 'repo'), 'branch', '--list', 'factory/issue-7'), '');
  assert.deepEqual(await ws.listWorktrees(root), []);
});
test('listWorktrees returns issue numbers on disk', async () => {
  await ws.ensureWorktree(root, 7, 'master'); await ws.ensureWorktree(root, 12, 'master');
  assert.deepEqual((await ws.listWorktrees(root)).sort((a, b) => a - b), [7, 12]);
});
test('ensureWorktree removes sandbox placeholders a killed session left, and nothing else', async () => {
  const { dir } = await ws.ensureWorktree(root, 3, 'master');
  const { mkdirSync, chmodSync } = await import('node:fs');
  mkdirSync(join(dir, '.claude/.cc-writes'), { recursive: true });
  for (const f of ['.bashrc', '.gitconfig', '.claude/settings.json']) { writeFileSync(join(dir, f), ''); chmodSync(join(dir, f), 0o444); }
  writeFileSync(join(dir, 'wip.js'), 'unfinished work');   // the agent's own work
  writeFileSync(join(dir, 'empty.txt'), '');               // empty but writable: not a placeholder
  await ws.ensureWorktree(root, 3, 'master');
  for (const f of ['.bashrc', '.gitconfig', '.claude']) assert.ok(!existsSync(join(dir, f)), f);
  assert.ok(existsSync(join(dir, 'wip.js')) && existsSync(join(dir, 'empty.txt')));
});
test('ensureWorktree removes a sandbox placeholder config.lock from the clone', async () => {
  const { chmodSync } = await import('node:fs');
  const lock = join(root, 'repo', '.git', 'config.lock');
  writeFileSync(lock, ''); chmodSync(lock, 0o444);
  const { created } = await ws.ensureWorktree(root, 4, 'master');
  assert.ok(created && !existsSync(lock));
});
test('changesAgainstBase with a commit lists only what changed after it', async () => {
  const { dir } = await ws.ensureWorktree(root, 5, 'master');
  await commitFile(dir, 'first.txt');
  const { sha } = await ws.headInfo(dir);
  await commitFile(dir, 'second.txt');
  assert.deepEqual((await ws.changesAgainstBase(dir, 'master', sha)).map((c) => c.path), ['second.txt']);
  assert.deepEqual((await ws.changesAgainstBase(dir, 'master')).map((c) => c.path), ['first.txt', 'second.txt']);
});
test('pathsOnBase lists files and their folders on the remote base branch', async () => {
  const paths = await ws.pathsOnBase(join(root, 'repo'), 'master');
  assert.ok(paths.has('a.txt') && paths.has('test/') && paths.has('test/unit/') && paths.has('test/unit/stats.test.js'));
  assert.ok(!paths.has('missing/'));
});
test('hasRemoteBranch tells whether the base branch exists', async () => {
  assert.equal(await ws.hasRemoteBranch(join(root, 'repo'), 'master'), true);
  assert.equal(await ws.hasRemoteBranch(join(root, 'repo'), 'nope'), false);
});
test('push sends the given commit, not whatever the branch ref points at', async () => {
  const { dir } = await ws.ensureWorktree(root, 7, 'master');
  await commitFile(dir, 'checked.txt');
  const checked = (await ws.headInfo(dir)).sha;
  await commitFile(dir, 'sneaked.txt'); // moves the branch ref past what was checked
  await ws.push(dir, 'factory/issue-7', checked);
  assert.equal((await git(seed, 'ls-remote', origin, 'refs/heads/factory/issue-7')).split('\t')[0], checked);
});
test('currentBranch names the checked-out branch, null when HEAD is detached', async () => {
  const { dir } = await ws.ensureWorktree(root, 7, 'master');
  assert.equal(await ws.currentBranch(dir), 'factory/issue-7');
  await git(dir, 'checkout', '-q', '--detach');
  assert.equal(await ws.currentBranch(dir), null);
});
test('a tampered .git link is refused', async () => {
  const { dir } = await ws.ensureWorktree(root, 7, 'master');
  await ws.checkGitLink(root, 7);
  writeFileSync(join(dir, '.git'), 'gitdir: ./.x\n');
  await assert.rejects(ws.checkGitLink(root, 7), /\.git link .* was changed/);
  await assert.rejects(ws.ensureWorktree(root, 7, 'master'), /\.git link .* was changed/);
});
