// verifyBranch judges a real branch in a real temporary git repository.
import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { run } from '../lib/exec.mjs';
import { workspace } from '../lib/workspace.mjs';
import { verifyBranch } from '../lib/verify.mjs';
import { FAKE_BWRAP_BIN } from './behavior/world.mjs';
import { tempDir } from './fakes/tmp.mjs';

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid'];

// The factory's git runs under bwrap. Inside an agent's own sandbox bwrap cannot start: the fake runs git unconfined there.
if ((await run('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-net', 'true'])).code !== 0) process.env.PATH = `${FAKE_BWRAP_BIN}:${process.env.PATH}`;
const git = async (dir, ...args) => {
  const r = await run('git', ['-C', dir, ...ID, ...args]);
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

describe('protected files and tests', () => {
  const write = (dir, name, content) => { mkdirSync(dirname(join(dir, name)), { recursive: true }); writeFileSync(join(dir, name), content); };
  const commit = async (dir, files, message = 'change') => {
    for (const [name, content] of Object.entries(files)) write(dir, name, content);
    await git(dir, 'add', '-A'); await git(dir, 'commit', '-q', '-m', message);
    return git(dir, 'rev-parse', 'HEAD');
  };

  const cfg = { protectedFiles: ['lib/brakes.mjs'], protectedDirs: ['smoke/'], testDirs: ['test/'] };
  let ws, dir;
  beforeEach(async () => {
    const base = tempDir('factory-verify-');
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

  test('a secret in an added line or a commit message parks without showing it', async () => {
    const token = 'gh' + 'p_' + 'a'.repeat(36);
    await commit(dir, { 'a.txt': 'one\n' + token + '\n' }, 'Add b\n\n' + token);
    const r = await verifyBranch(ws, cfg, dir);
    assert.equal(r.park, 'The branch adds what looks like a secret, so the factory did not push it:\n- a.txt line 2: looks like a GitHub token\n- commit message 1: looks like a GitHub token\n'
      + `Remove it from the files and commits in \`${dir}\`, then remove the label.`);
  });

  test('a workflow change parks and shows the diff', async () => {
    await commit(dir, { '.github/workflows/ci.yml': 'on: pull_request\n' });
    const r = await verifyBranch(ws, cfg, dir);
    assert.match(r.park, /^The branch changes CI workflow files, so the factory did not push it\. .*\n- \.github\/workflows\/ci\.yml\n/);
    assert.match(r.park, /\+on: pull_request/);
  });

  test('before setup, a protected file parks and test folders do not count', async () => {
    const head = await commit(dir, { 'lib/brakes.mjs': 'loose\n', 'test/a.test.mjs': 'changed\n' });
    const r = await verifyBranch(ws, cfg, dir, { before: 'setup', approvals: [] });
    assert.equal(r.park, `The branch changes protected files, so the factory did not run setup with network on it:\n- protected file changed: lib/brakes.mjs\nReview them in \`${dir}\`; to go ahead, merge or revert them, then remove the label.\n\nOr, once you have read them and they are right, approve setup for the branch as it is now, at ${head}, with this comment, then remove the label:\n\n\`\`\`\napprove protected setup ${head}\n\`\`\``);
    assert.deepEqual(r.flags, []);
  });

  test('before setup, a changed test alone does not park', async () => {
    await commit(dir, { 'test/a.test.mjs': 'changed\n' });
    assert.deepEqual(await verifyBranch(ws, cfg, dir, { before: 'setup', approvals: [] }), { park: null, flags: [] });
  });

  // ADR 0007: the owner may approve setup for one commit whose protected change they read.
  test('before setup, an approval naming HEAD lets setup run on a protected change', async () => {
    const head = await commit(dir, { 'lib/brakes.mjs': 'loose\n' });
    assert.deepEqual(await verifyBranch(ws, cfg, dir, { before: 'setup', approvals: [head] }), { park: null, flags: [] });
  });

  test('before setup, an approved commit still counts after changes outside protected files', async () => {
    const approved = await commit(dir, { 'lib/brakes.mjs': 'loose\n', 'smoke/x.mjs': 'x' });
    await commit(dir, { 'b.txt': 'later\n', 'test/a.test.mjs': 'changed\n' });
    assert.deepEqual(await verifyBranch(ws, cfg, dir, { before: 'setup', approvals: [approved] }), { park: null, flags: [] });
  });

  test('before setup, a protected file changed after the approved commit parks again', async () => {
    const approved = await commit(dir, { 'lib/brakes.mjs': 'loose\n' });
    const head = await commit(dir, { 'lib/brakes.mjs': 'looser\n' });
    const r = await verifyBranch(ws, cfg, dir, { before: 'setup', approvals: [approved] });
    assert.match(r.park, /^The branch changes protected files, so the factory did not run setup with network on it:\n- protected file changed: lib\/brakes\.mjs\n/);
    assert.ok(r.park.includes(`approve protected setup ${head}`));
  });

  test('before setup, a protected folder changed after the approved commit parks again', async () => {
    const approved = await commit(dir, { 'lib/brakes.mjs': 'loose\n' });
    await commit(dir, { 'smoke/x.mjs': 'x' });
    const r = await verifyBranch(ws, cfg, dir, { before: 'setup', approvals: [approved] });
    assert.match(r.park, /did not run setup with network/);
  });

  test('before setup, an approval naming a commit the clone does not have parks', async () => {
    await commit(dir, { 'lib/brakes.mjs': 'loose\n' });
    const r = await verifyBranch(ws, cfg, dir, { before: 'setup', approvals: ['0123456789abcdef0123456789abcdef01234567'] });
    assert.match(r.park, /did not run setup with network/);
  });

  test('a protected path is flagged, not parked', async () => {
    await commit(dir, { 'smoke/x.mjs': 'x' });
    assert.deepEqual(await verifyBranch(ws, cfg, dir), { park: null, flags: ['protected file changed: smoke/x.mjs'] });
  });

  test('a changed existing test is flagged', async () => {
    await commit(dir, { 'test/a.test.mjs': "test('a', () => { changed })\n" });
    assert.deepEqual(await verifyBranch(ws, cfg, dir), { park: null, flags: ['existing test changed (M): test/a.test.mjs'] });
  });

  test('a test moved out of the test folder is flagged by its old path', async () => {
    mkdirSync(join(dir, 'moved'));
    await git(dir, 'mv', 'test/a.test.mjs', 'moved/a.test.mjs'); await git(dir, 'commit', '-q', '-m', 'move');
    assert.deepEqual(await verifyBranch(ws, cfg, dir), { park: null, flags: ['existing test changed (R): test/a.test.mjs'] });
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

  // The issue's "## Tests that change" section lists the test files it changes on purpose.
  test('a changed test the issue lists is a note, not a draft', async () => {
    await commit(dir, { 'test/a.test.mjs': "test('a', () => { changed })\n" });
    assert.deepEqual(await verifyBranch(ws, cfg, dir, { testsThatChange: ['test/a.test.mjs'] }),
      { park: null, flags: [], notes: ['test changed as the issue asks (M): test/a.test.mjs'] });
  });

  test('a deleted test the issue lists is a note, not a draft', async () => {
    await git(dir, 'rm', '-q', 'test/a.test.mjs'); await git(dir, 'commit', '-q', '-m', 'drop');
    assert.deepEqual(await verifyBranch(ws, cfg, dir, { testsThatChange: ['test/a.test.mjs'] }),
      { park: null, flags: [], notes: ['test changed as the issue asks (D): test/a.test.mjs'] });
  });

  test('lines only added to an existing test are a note, not a draft', async () => {
    await commit(dir, { 'test/a.test.mjs': "test('a', () => {})\ntest('b', () => {})\n" });
    assert.deepEqual(await verifyBranch(ws, cfg, dir), { park: null, flags: [], notes: ['test cases added: test/a.test.mjs'] });
  });

  test('a changed test the issue does not list is still a draft', async () => {
    await commit(dir, { 'test/a.test.mjs': "test('a', () => { changed })\n" });
    assert.deepEqual(await verifyBranch(ws, cfg, dir, { testsThatChange: ['test/other.test.mjs'] }),
      { park: null, flags: ['existing test changed (M): test/a.test.mjs'] });
  });

  test('a skip added to a listed test is still a draft', async () => {
    await commit(dir, { 'test/a.test.mjs': "test.skip('a', () => {})\n" });
    const { flags } = await verifyBranch(ws, cfg, dir, { testsThatChange: ['test/a.test.mjs'] });
    assert.equal(flags.length, 1);
    assert.match(flags[0], /^test skipped or singled out: test\.skip/);
  });

  test('a skip added in new lines of an existing test is still a draft', async () => {
    await commit(dir, { 'test/a.test.mjs': "test('a', () => {})\ntest.only('b', () => {})\n" });
    const { flags } = await verifyBranch(ws, cfg, dir);
    assert.deepEqual(flags, ["test skipped or singled out: test.only('b', () => {})"]);
  });

  test('a listed path does not lift a protected file', async () => {
    await commit(dir, { 'lib/brakes.mjs': 'changed\n' });
    assert.deepEqual(await verifyBranch(ws, cfg, dir, { testsThatChange: ['lib/brakes.mjs'] }),
      { park: null, flags: ['protected file changed: lib/brakes.mjs'] });
  });

  // Each ask is an ls-remote and a confined git call; one verify judges against one base.
  test('the remote base is asked once per verify and every read against the base uses it', async () => {
    await commit(dir, { 'test/a.test.mjs': "test('a', () => {})\ntest('b', () => {})\n", 'test/b.test.mjs': "test('b', () => {})\n" });
    const asked = [], reads = [];
    const spy = {
      ...ws,
      againstBase: async (d, opts) => {
        const view = await ws.againstBase(d, opts);
        asked.push(view.sha);
        return {
          sha: view.sha,
          changes: (since) => { reads.push(['changes', since ?? null, view.sha]); return view.changes(since); },
          diff: (p, since) => { reads.push(['diff', since ?? null, view.sha]); return view.diff(p, since); },
          messages: () => { reads.push(['log', null, view.sha]); return view.messages(); },
        };
      },
    };
    assert.deepEqual(await verifyBranch(spy, cfg, dir), { park: null, flags: [], notes: ['test cases added: test/a.test.mjs'] });
    assert.equal(asked.length, 1);
    assert.deepEqual(reads.map(([what]) => what), ['log', 'diff', 'changes', 'diff', 'diff']);
    for (const [what, , at] of reads) assert.equal(at, asked[0], `${what} reads against the base asked once`);
    asked.length = 0; reads.length = 0;
    assert.deepEqual(await verifyBranch(spy, cfg, dir, { before: 'setup', approvals: [] }), { park: null, flags: [] });
    assert.deepEqual([asked.length, reads], [1, [['changes', null, asked[0]]]]);
  });
});

// The dotfile guard is a push brake: verifyBranch (protected) refuses the branch, not the stage code.
describe('dotfiles', () => {
  const commit = async (dir, files) => {
    for (const [name, content] of Object.entries(files)) { mkdirSync(dirname(join(dir, name)), { recursive: true }); writeFileSync(join(dir, name), content); }
    await git(dir, 'add', '-A'); await git(dir, 'commit', '-q', '-m', 'change');
  };

  let ws, dir;
  beforeEach(async () => {
    const base = tempDir('factory-verify-dot-');
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
});

// Fakes and contract tests the rules ask agents to extend: lines only added there are a note, not a draft.
describe('test support files', () => {
  const commit = async (dir, files) => {
    for (const [name, content] of Object.entries(files)) { mkdirSync(dirname(join(dir, name)), { recursive: true }); writeFileSync(join(dir, name), content); }
    await git(dir, 'add', '-A'); await git(dir, 'commit', '-q', '-m', 'change');
    return git(dir, 'rev-parse', 'HEAD');
  };

  const FAKE = 'export const a = 1;\nlet i = 2;\n--i;\n';
  const cfg = { testDirs: ['test/'], testSupport: ['test/fakes/'] };
  let ws, dir;
  beforeEach(async () => {
    const base = tempDir('factory-verify-support-');
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

  test('lines only added to an ordinary existing test are a note, not a draft', async () => {
    await commit(dir, { 'test/a.test.mjs': "test('a', () => {})\ntest('b', () => {})\n" });
    assert.deepEqual(await verifyBranch(ws, cfg, dir), { park: null, flags: [], notes: ['test cases added: test/a.test.mjs'] });
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
});
