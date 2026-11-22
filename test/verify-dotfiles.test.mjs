// The dotfile guard is a push brake: verifyBranch (protected) refuses the branch, not the stage code.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { run } from '../lib/exec.mjs';
import { workspace } from '../lib/workspace.mjs';
import { verifyBranch } from '../lib/verify.mjs';

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid'];
const git = async (dir, ...args) => {
  const r = await run('git', ['-C', dir, ...ID, ...args]);
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const commit = async (dir, files) => {
  for (const [name, content] of Object.entries(files)) { mkdirSync(dirname(join(dir, name)), { recursive: true }); writeFileSync(join(dir, name), content); }
  await git(dir, 'add', '-A'); await git(dir, 'commit', '-q', '-m', 'change');
};

let ws, dir;
beforeEach(async () => {
  const base = mkdtempSync(join(tmpdir(), 'factory-verify-dot-'));
  const origin = join(base, 'origin.git'), seed = join(base, 'seed'), root = join(base, 'factory');
  await run('git', ['init', '-q', '--bare', '-b', 'master', origin]);
  await run('git', ['init', '-q', '-b', 'master', seed]);
  await commit(seed, { 'a.txt': 'one\n', '.gitignore': 'node_modules/\n' });
  await git(seed, 'remote', 'add', 'origin', origin); await git(seed, 'push', '-q', 'origin', 'master');
  mkdirSync(root);
  ws = workspace({ root, url: origin, base: 'master' });
  await ws.ensureClone();
  ({ dir } = await ws.ensureWorktree(7));
});

test('a branch adding .bashrc or .idea/ at the root is refused', async () => {
  await commit(dir, { '.bashrc': 'export X=1\n', '.idea/workspace.xml': '<x/>\n', 'b.txt': 'x' });
  const v = await verifyBranch(ws, {}, dir);
  assert.match(v.park ?? '', /dotfiles or editor folders/);
  assert.match(v.park, /\.bashrc/);
  assert.match(v.park, /\.idea\/workspace\.xml/);
});

test('a branch changing the tracked .gitignore is not refused', async () => {
  await commit(dir, { '.gitignore': 'node_modules/\ndist/\n' });
  assert.equal((await verifyBranch(ws, {}, dir)).park, null);
});
