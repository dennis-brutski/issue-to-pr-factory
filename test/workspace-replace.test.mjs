// Replace refs and grafts in the clone must not change what the factory's git sees.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
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

let root, dir;
beforeEach(async () => {
  const base = mkdtempSync(join(tmpdir(), 'factory-replace-'));
  const origin = join(base, 'origin.git'), seed = join(base, 'seed');
  root = join(base, 'factory');
  await run('git', ['init', '-q', '--bare', '-b', 'master', origin]);
  await run('git', ['init', '-q', '-b', 'master', seed]);
  writeFileSync(join(seed, 'a.txt'), 'one\n');
  await git(seed, 'add', '-A'); await git(seed, 'commit', '-q', '-m', 'init');
  await git(seed, 'remote', 'add', 'origin', origin); await git(seed, 'push', '-q', 'origin', 'master');
  mkdirSync(root, { recursive: true });
  await ws.ensureClone(root, origin);
  ({ dir } = await ws.ensureWorktree(root, 1, 'master'));
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'on: push\n');
  await git(dir, 'add', '-A'); await git(dir, 'commit', '-q', '-m', 'Add CI');
});

test('a replace ref does not hide what the branch changes', async () => {
  // A commit like the head, but without the workflow change.
  const fake = await git(dir, 'commit-tree', 'origin/master^{tree}', '-p', 'origin/master', '-m', 'Add CI');
  await git(dir, 'replace', 'HEAD', fake);
  assert.deepEqual((await run('git', ['-C', dir, 'diff', '--name-only', 'origin/master...HEAD'])).stdout, '');
  assert.deepEqual((await ws.changesAgainstBase(dir, 'master')).map((c) => c.path), ['.github/workflows/ci.yml']);
  assert.match(await ws.diffAgainstBase(dir, 'master', '.github'), /on: push/);
  assert.deepEqual(await ws.commitMessagesAgainstBase(dir, 'master'), ['Add CI']);
});

test('a grafts file does not hide what the branch changes', async () => {
  const baseSha = await git(dir, 'rev-parse', 'origin/master'), head = await git(dir, 'rev-parse', 'HEAD');
  mkdirSync(join(root, 'repo', '.git', 'info'), { recursive: true });
  writeFileSync(join(root, 'repo', '.git', 'info', 'grafts'), `${baseSha} ${head}\n`);
  assert.deepEqual((await ws.changesAgainstBase(dir, 'master')).map((c) => c.path), ['.github/workflows/ci.yml']);
  assert.deepEqual(await ws.commitMessagesAgainstBase(dir, 'master'), ['Add CI']);
});
