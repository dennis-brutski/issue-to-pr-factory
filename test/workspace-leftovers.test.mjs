// The Claude sandbox leaves empty .claude/.cc-writes folders behind, also in subfolders where a session ran commands.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../lib/exec.mjs';
import * as ws from '../lib/workspace.mjs';

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid'];
const git = async (dir, ...args) => {
  const r = await run('git', ['-C', dir, ...ID, ...args]);
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
};

let root;
beforeEach(async () => {
  const base = mkdtempSync(join(tmpdir(), 'factory-leftovers-'));
  const origin = join(base, 'origin.git'), seed = join(base, 'seed');
  root = join(base, 'factory');
  await run('git', ['init', '-q', '--bare', '-b', 'master', origin]);
  await run('git', ['init', '-q', '-b', 'master', seed]);
  mkdirSync(join(seed, 'prompts'));
  writeFileSync(join(seed, 'prompts', 'a.md'), 'a');
  await git(seed, 'add', '-A'); await git(seed, 'commit', '-q', '-m', 'init');
  await git(seed, 'remote', 'add', 'origin', origin); await git(seed, 'push', '-q', 'origin', 'master');
  await ws.ensureClone(root, origin);
});

test('empty .cc-writes folders in subfolders go, with their .claude folder when it is then empty', async () => {
  const { dir } = await ws.ensureWorktree(root, 3, 'master');
  mkdirSync(join(dir, 'prompts/.claude/.cc-writes'), { recursive: true });
  mkdirSync(join(dir, 'a/b/.claude/.cc-writes'), { recursive: true });
  await ws.removeSandboxLeftovers(dir);
  assert.ok(!existsSync(join(dir, 'prompts/.claude')));
  assert.ok(!existsSync(join(dir, 'a/b/.claude')));
  assert.ok(existsSync(join(dir, 'prompts/a.md')));
});

test('a .claude folder with other content stays, and a .cc-writes folder that is not empty stays', async () => {
  const { dir } = await ws.ensureWorktree(root, 3, 'master');
  mkdirSync(join(dir, 'x/.claude/.cc-writes'), { recursive: true });
  writeFileSync(join(dir, 'x/.claude/notes.md'), 'kept');
  mkdirSync(join(dir, 'y/.claude/.cc-writes'), { recursive: true });
  writeFileSync(join(dir, 'y/.claude/.cc-writes/f'), 'kept');
  await ws.removeSandboxLeftovers(dir);
  assert.ok(!existsSync(join(dir, 'x/.claude/.cc-writes')));
  assert.ok(existsSync(join(dir, 'x/.claude/notes.md')));
  assert.ok(existsSync(join(dir, 'y/.claude/.cc-writes/f')));
});

test('node_modules is not searched', async () => {
  const { dir } = await ws.ensureWorktree(root, 3, 'master');
  mkdirSync(join(dir, 'node_modules/p/.claude/.cc-writes'), { recursive: true });
  await ws.removeSandboxLeftovers(dir);
  assert.ok(existsSync(join(dir, 'node_modules/p/.claude/.cc-writes')));
});

test('a run start removes nested leftovers too', async () => {
  const { dir } = await ws.ensureWorktree(root, 3, 'master');
  mkdirSync(join(dir, 'prompts/.claude/.cc-writes'), { recursive: true });
  await ws.ensureWorktree(root, 3, 'master');
  assert.ok(!existsSync(join(dir, 'prompts/.claude')));
});
