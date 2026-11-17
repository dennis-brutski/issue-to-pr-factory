// Replace refs and grafts change what git reads for a commit. Agents can plant
// both, so the factory's own git reads must ignore them.
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

let root, origin, dir, base;
beforeEach(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'factory-wsr-'));
  origin = join(tmp, 'origin.git'); const seed = join(tmp, 'seed'); root = join(tmp, 'factory');
  await run('git', ['init', '-q', '--bare', '-b', 'master', origin]);
  await run('git', ['init', '-q', '-b', 'master', seed]);
  writeFileSync(join(seed, 'a.txt'), 'one\n');
  await git(seed, 'add', '-A'); await git(seed, 'commit', '-q', '-m', 'init');
  await git(seed, 'remote', 'add', 'origin', origin); await git(seed, 'push', '-q', 'origin', 'master');
  base = await git(seed, 'rev-parse', 'HEAD');
  await run('mkdir', ['-p', root]);
  await ws.ensureClone(root, origin);
  ({ dir } = await ws.ensureWorktree(root, 7, 'master'));
  writeFileSync(join(dir, 'b.txt'), 'x\n');
  await git(dir, 'add', '-A'); await git(dir, 'commit', '-q', '-m', 'Add b\n\nCo-Authored-By: x <x@example.invalid>');
});

const seesTheBranch = async () => {
  assert.deepEqual(await ws.changesAgainstBase(dir, 'master', null, { base }), [{ status: 'A', path: 'b.txt' }]);
  assert.match(await ws.diffAgainstBase(dir, 'master', 'b.txt', { base }), /\+x/);
  assert.equal((await ws.commitMessagesAgainstBase(dir, 'master', { base })).length, 1);
};

// A child of the branch head with the same files; standing in for the base, it makes base...HEAD empty.
const decoy = async () => git(dir, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'x');

test('a replace ref for the base commit hides nothing', async () => {
  await git(dir, 'replace', '-f', base, await decoy());
  await seesTheBranch();
});

test('a grafts file hides nothing', async () => {
  const graft = `${base} ${await decoy()}\n`;
  writeFileSync(join(root, 'repo', '.git', 'info', 'grafts'), graft);
  await seesTheBranch();
});

test('the helpers compare against a given base without asking the remote', async () => {
  await git(join(root, 'repo'), 'remote', 'set-url', 'origin', join(root, 'missing.git'));
  await seesTheBranch();
});

test('checkCloneConfig still accepts a plain clone', async () => {
  await ws.checkCloneConfig(root, origin);
});
