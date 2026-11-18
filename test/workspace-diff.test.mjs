// diffAgainstBase takes several paths, and a commit to diff from.
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
  const base = mkdtempSync(join(tmpdir(), 'factory-wsd-'));
  origin = join(base, 'origin.git'); seed = join(base, 'seed'); root = join(base, 'factory');
  await run('git', ['init', '-q', '--bare', '-b', 'master', origin]);
  await run('git', ['init', '-q', '-b', 'master', seed]);
  writeFileSync(join(seed, 'a.txt'), 'one\n');
  await git(seed, 'add', '-A'); await git(seed, 'commit', '-q', '-m', 'init');
  await git(seed, 'remote', 'add', 'origin', origin); await git(seed, 'push', '-q', 'origin', 'master');
  await run('mkdir', ['-p', root]);
  await ws.ensureClone(root, origin);
});

test('diffAgainstBase covers a list of paths, and only what changed since a commit', async () => {
  const { dir } = await ws.ensureWorktree(root, 7, 'master');
  await commitFile(dir, 'b.txt', 'bee');
  const since = await git(dir, 'rev-parse', 'HEAD');
  await commitFile(dir, 'c.txt', 'sea');
  const both = await ws.diffAgainstBase(dir, 'master', ['b.txt', 'c.txt']);
  assert.match(both, /\+bee/); assert.match(both, /\+sea/);
  const later = await ws.diffAgainstBase(dir, 'master', ['b.txt', 'c.txt'], since);
  assert.doesNotMatch(later, /\+bee/); assert.match(later, /\+sea/);
});
