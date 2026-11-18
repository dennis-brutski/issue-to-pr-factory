// verifyBranch judges a real branch in a real temporary git repository.
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
const write = (dir, name, content) => { mkdirSync(dirname(join(dir, name)), { recursive: true }); writeFileSync(join(dir, name), content); };
const commit = async (dir, files, message = 'change') => {
  for (const [name, content] of Object.entries(files)) write(dir, name, content);
  await git(dir, 'add', '-A'); await git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
};

const cfg = { protectedFiles: ['lib/brakes.mjs'], protectedDirs: ['smoke/'], testDirs: ['test/'] };
let ws, dir;
beforeEach(async () => {
  const base = mkdtempSync(join(tmpdir(), 'factory-verify-'));
  const origin = join(base, 'origin.git'), seed = join(base, 'seed'), root = join(base, 'factory');
  await run('git', ['init', '-q', '--bare', '-b', 'master', origin]);
  await run('git', ['init', '-q', '-b', 'master', seed]);
  await commit(seed, { 'a.txt': 'one\n', 'lib/brakes.mjs': 'brakes\n', 'test/a.test.mjs': "test('a', () => {})\n", '.github/workflows/ci.yml': 'on: push\n' }, 'init');
  await git(seed, 'remote', 'add', 'origin', origin); await git(seed, 'push', '-q', 'origin', 'master');
  mkdirSync(root);
  ws = workspace({ root, url: origin, base: 'master' });
  await ws.ensureClone();
  ({ dir } = await ws.ensureWorktree(7));
});

test('a plain change neither parks nor flags', async () => {
  await commit(dir, { 'b.txt': 'x' });
  assert.deepEqual(await verifyBranch(ws, cfg, dir), { park: null, flags: [] });
});

test('an attribution line parks', async () => {
  await commit(dir, { 'b.txt': 'x' }, 'Add b\n\nCo-Authored-By: x <x@example.invalid>');
  const r = await verifyBranch(ws, cfg, dir);
  assert.equal(r.park, 'Commits must not carry attribution lines:\n- commit message carries an attribution line: "Add b"');
});

test('a workflow change parks and shows the diff', async () => {
  await commit(dir, { '.github/workflows/ci.yml': 'on: pull_request\n' });
  const r = await verifyBranch(ws, cfg, dir);
  assert.match(r.park, /^The branch changes CI workflow files, so the factory did not push it\. .*\n- \.github\/workflows\/ci\.yml\n/);
  assert.match(r.park, /\+on: pull_request/);
});

test('before setup, a protected file parks and test folders do not count', async () => {
  await commit(dir, { 'lib/brakes.mjs': 'loose\n', 'test/a.test.mjs': 'changed\n' });
  const r = await verifyBranch(ws, cfg, dir, { before: 'setup' });
  assert.equal(r.park, `The branch changes protected files, so the factory did not run setup with network on it:\n- protected file changed: lib/brakes.mjs\nReview them in \`${dir}\`; to go ahead, merge or revert them, then remove the label.`);
  assert.deepEqual(r.flags, []);
});

test('before setup, a changed test alone does not park', async () => {
  await commit(dir, { 'test/a.test.mjs': 'changed\n' });
  assert.deepEqual(await verifyBranch(ws, cfg, dir, { before: 'setup' }), { park: null, flags: [] });
});

test('a protected path is flagged, not parked', async () => {
  await commit(dir, { 'smoke/x.mjs': 'x' });
  assert.deepEqual(await verifyBranch(ws, cfg, dir), { park: null, flags: ['protected file changed: smoke/x.mjs'] });
});

test('a changed existing test is flagged', async () => {
  await commit(dir, { 'test/a.test.mjs': "test('a', () => { changed })\n" });
  assert.deepEqual(await verifyBranch(ws, cfg, dir), { park: null, flags: ['existing test changed (M): test/a.test.mjs'] });
});

test('an added skip is flagged', async () => {
  await commit(dir, { 'test/b.test.mjs': "test.skip('b', () => {})\n" });
  assert.deepEqual(await verifyBranch(ws, cfg, dir), { park: null, flags: ["test skipped or singled out: test.skip('b', () => {})"] });
});

test('with since, only what changed after it and still differs from the base counts', async () => {
  await commit(dir, { 'smoke/old.mjs': 'x', 'test/old.test.mjs': "test.only('o', () => {})\n", 'lib/brakes.mjs': 'loose\n' });
  const since = await git(dir, 'rev-parse', 'HEAD');
  // Restoring a protected file to its base state is fine; a new protected change and skip count.
  await commit(dir, { 'lib/brakes.mjs': 'brakes\n', 'smoke/new.mjs': 'x', 'test/new.test.mjs': "it.skip('n', () => {})\n" });
  const r = await verifyBranch(ws, cfg, dir, { since });
  assert.equal(r.park, null);
  assert.deepEqual(r.flags, ['protected file changed: smoke/new.mjs', "test skipped or singled out: it.skip('n', () => {})"]);
  // Without since, the whole branch counts.
  assert.equal((await verifyBranch(ws, cfg, dir)).flags.length, 4);
});

test('with since, attribution and workflows still park against the base', async () => {
  await commit(dir, { 'b.txt': 'x' }, 'Add b\n\nGenerated with something');
  const since = await commit(dir, { 'c.txt': 'x' });
  assert.match((await verifyBranch(ws, cfg, dir, { since })).park, /^Commits must not carry attribution lines/);
});
