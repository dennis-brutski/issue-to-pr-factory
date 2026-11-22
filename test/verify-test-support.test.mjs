// Fakes and contract tests the rules ask agents to extend: lines only added there are a note, not a draft.
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
  return git(dir, 'rev-parse', 'HEAD');
};

const FAKE = 'export const a = 1;\nlet i = 2;\n--i;\n';
const cfg = { testDirs: ['test/'], testSupport: ['test/fakes/'] };
let ws, dir;
beforeEach(async () => {
  const base = mkdtempSync(join(tmpdir(), 'factory-verify-support-'));
  const origin = join(base, 'origin.git'), seed = join(base, 'seed'), root = join(base, 'factory');
  await run('git', ['init', '-q', '--bare', '-b', 'master', origin]);
  await run('git', ['init', '-q', '-b', 'master', seed]);
  await commit(seed, { 'test/fakes/gh.mjs': FAKE, 'test/a.test.mjs': "test('a', () => {})\n" });
  await git(seed, 'remote', 'add', 'origin', origin); await git(seed, 'push', '-q', 'origin', 'master');
  mkdirSync(root);
  ws = workspace({ root, url: origin, base: 'master' });
  await ws.ensureClone();
  ({ dir } = await ws.ensureWorktree(7));
});

test('lines only added to a test support file are a note, not a flag', async () => {
  await commit(dir, { 'test/fakes/gh.mjs': `${FAKE}export const b = 2;\n` });
  assert.deepEqual(await verifyBranch(ws, cfg, dir), { park: null, flags: [], notes: ['test support extended, lines only added: test/fakes/gh.mjs'] });
});

test('a removed line in a test support file is still flagged', async () => {
  await commit(dir, { 'test/fakes/gh.mjs': FAKE.replace('--i;\n', '') });
  assert.deepEqual(await verifyBranch(ws, cfg, dir), { park: null, flags: ['existing test changed (M): test/fakes/gh.mjs'] });
});

test('lines only added to an ordinary existing test are still flagged', async () => {
  await commit(dir, { 'test/a.test.mjs': "test('a', () => {})\ntest('b', () => {})\n" });
  assert.deepEqual(await verifyBranch(ws, cfg, dir), { park: null, flags: ['existing test changed (M): test/a.test.mjs'] });
});

test('an added skip in a test support file is still flagged', async () => {
  await commit(dir, { 'test/fakes/gh.mjs': `${FAKE}test.skip('x', () => {});\n` });
  const v = await verifyBranch(ws, cfg, dir);
  assert.equal(v.flags.length, 1);
  assert.match(v.flags[0], /skipped or singled out/);
});

test('with since, only lines added after it count', async () => {
  const first = await commit(dir, { 'test/fakes/gh.mjs': FAKE.replace('--i;\n', '') });
  await commit(dir, { 'test/fakes/gh.mjs': `${FAKE.replace('--i;\n', '')}export const b = 2;\n` });
  assert.deepEqual(await verifyBranch(ws, cfg, dir, { since: first }),
    { park: null, flags: [], notes: ['test support extended, lines only added: test/fakes/gh.mjs'] });
});

test('an extended file that is also protected is still flagged', async () => {
  await commit(dir, { 'test/fakes/gh.mjs': `${FAKE}export const b = 2;\n` });
  const v = await verifyBranch(ws, { ...cfg, protectedDirs: ['test/fakes/'] }, dir);
  assert.deepEqual(v.flags, ['protected file changed: test/fakes/gh.mjs']);
});
