import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, chmodSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { run } from '../lib/exec.mjs';
import { workspace } from '../lib/workspace.mjs';
import * as ws from '../lib/workspace.mjs';
import { fakeWorkspace } from './fakes/workspace.mjs';
import { FAKE_BWRAP_BIN } from './behavior/world.mjs';
import { tempDir } from './fakes/tmp.mjs';

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid'];

// The factory's git runs under bwrap. Inside an agent's own sandbox bwrap cannot start: the fake runs git unconfined there,
// and the tests that prove the confinement skip.
const bwrapWorks = (await run('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-net', 'true'])).code === 0;
if (!bwrapWorks) process.env.PATH = `${FAKE_BWRAP_BIN}:${process.env.PATH}`;
const real = { skip: bwrapWorks ? false : 'bwrap probe failed on this machine' };

describe('worktrees and branches', () => {
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
    const base = tempDir('factory-ws-');
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
    assert.deepEqual(await (await ws.againstBase(dir, 'master')).changes(), []);
  });
  test('ensureWorktree reuses an existing worktree and its commits', async () => {
    const a = await ws.ensureWorktree(root, 7, 'master'); await commitFile(a.dir, 'x.txt');
    const b = await ws.ensureWorktree(root, 7, 'master');
    assert.equal(b.created, false);
    assert.deepEqual(await (await ws.againstBase(b.dir, 'master')).changes(), [{ status: 'A', path: 'x.txt' }]);
  });
  test('ensureWorktree starts from the remote branch when one exists', async () => {
    await git(seed, 'checkout', '-q', '-b', 'factory/issue-8'); await commitFile(seed, 'earlier.txt');
    await git(seed, 'push', '-q', 'origin', 'factory/issue-8');
    const { dir } = await ws.ensureWorktree(root, 8, 'master');
    assert.ok(existsSync(join(dir, 'earlier.txt')));
  });
  test('againstBase reports renames with oldPath', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    await git(dir, 'mv', 'test/unit/stats.test.js', 'moved.js'); await git(dir, 'commit', '-q', '-m', 'mv');
    assert.deepEqual(await (await ws.againstBase(dir, 'master')).changes(), [{ status: 'R', oldPath: 'test/unit/stats.test.js', path: 'moved.js' }]);
  });
  test('againstBase changes gives file names as they are, not quoted as git prints them', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    await commitFile(dir, 'cié.txt'); await git(dir, 'mv', 'cié.txt', 'a"b.txt'); await git(dir, 'commit', '-q', '-m', 'mv');
    await commitFile(dir, 'tab\there.txt');
    assert.deepEqual(await (await ws.againstBase(dir, 'master')).changes(), [{ status: 'A', path: 'a"b.txt' }, { status: 'A', path: 'tab\there.txt' }]);
  });
  test('againstBase patches holds every commit, also what a later commit removed', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    writeFileSync(join(dir, 'p.txt'), 'gone later\n'); await git(dir, 'add', '-A'); await git(dir, 'commit', '-q', '-m', 'add');
    writeFileSync(join(dir, 'p.txt'), 'kept\n'); await git(dir, 'add', '-A'); await git(dir, 'commit', '-q', '-m', 'change');
    const view = await ws.againstBase(dir, 'master');
    assert.doesNotMatch(await view.diff([]), /gone later/);
    assert.match(await view.patches(), /\+gone later/);
  });
  test('againstBase messages are the full messages of new commits only', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    writeFileSync(join(dir, 'y.txt'), 'y'); await git(dir, 'add', '-A');
    await git(dir, 'commit', '-q', '-m', 'Subject line', '-m', 'Co-Authored-By: X <x@example.invalid>');
    const msgs = await (await ws.againstBase(dir, 'master')).messages();
    assert.equal(msgs.length, 1);
    assert.match(msgs[0], /Subject line[\s\S]*Co-Authored-By/);
  });
  test('isClean notices untracked and modified files', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    assert.equal(await ws.isClean(dir), true);
    writeFileSync(join(dir, 'stray.txt'), 's');
    assert.equal(await ws.isClean(dir), false);
  });
  test('headInfo returns only the sha', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    const h = await ws.headInfo(dir);
    assert.match(h.sha, /^[0-9a-f]{40}$/);
    assert.deepEqual(Object.keys(h), ['sha']);
  });
  test('mergeBase is clean when master moved without conflict', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master'); await commitFile(dir, 'x.txt');
    await commitFile(seed, 'other.txt'); await git(seed, 'push', '-q', 'origin', 'master');
    assert.equal(await ws.mergeBase(dir, 'master'), 'clean');
    assert.ok(existsSync(join(dir, 'other.txt')));
    assert.equal(await ws.mergeResolved(dir), true);
  });
  test('mergeBase merges the base from GitHub, not a ref an agent moved in the clone', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master'); await commitFile(dir, 'x.txt');
    await commitFile(seed, 'other.txt'); await git(seed, 'push', '-q', 'origin', 'master');
    // git reads "origin/master" as refs/origin/master before refs/remotes/origin/master, and no fetch removes it.
    await git(dir, 'update-ref', 'refs/origin/master', 'HEAD');
    assert.equal(await ws.mergeBase(dir, 'master'), 'clean');
    assert.ok(existsSync(join(dir, 'other.txt')));
  });
  test('mergeBase reports conflict and mergeResolved is false until resolved', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master'); await commitFile(dir, 'a.txt', 'mine\n');
    await commitFile(seed, 'a.txt', 'theirs\n'); await git(seed, 'push', '-q', 'origin', 'master');
    assert.equal(await ws.mergeBase(dir, 'master'), 'conflict');
    assert.equal(await ws.mergeResolved(dir), false);
    writeFileSync(join(dir, 'a.txt'), 'both\n'); await git(dir, 'add', '-A'); await git(dir, 'commit', '-q', '-m', 'merge');
    assert.equal(await ws.mergeResolved(dir), true);
  });
  test('mergeBase throws when git merge fails without a conflict', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master'); await commitFile(dir, 'x.txt');
    await commitFile(seed, 'other.txt', 'theirs\n'); await git(seed, 'push', '-q', 'origin', 'master');
    writeFileSync(join(dir, 'other.txt'), 'untracked\n'); // the merge would overwrite it, so git refuses before starting
    await assert.rejects(ws.mergeBase(dir, 'master'), /git merge failed/);
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
  test('listWorktrees returns issue numbers on disk, without the smoke issue-0', async () => {
    await ws.ensureWorktree(root, 7, 'master'); await ws.ensureWorktree(root, 12, 'master'); await ws.ensureWorktree(root, 0, 'master');
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
  test('againstBase changes with a commit lists only what changed after it', async () => {
    const { dir } = await ws.ensureWorktree(root, 5, 'master');
    await commitFile(dir, 'first.txt');
    const { sha } = await ws.headInfo(dir);
    await commitFile(dir, 'second.txt');
    assert.deepEqual((await (await ws.againstBase(dir, 'master')).changes(sha)).map((c) => c.path), ['second.txt']);
    assert.deepEqual((await (await ws.againstBase(dir, 'master')).changes()).map((c) => c.path), ['first.txt', 'second.txt']);
  });
  test('pathsOnBase lists files and their folders on the remote base branch', async () => {
    const paths = await ws.pathsOnBase(join(root, 'repo'), 'master');
    assert.ok(paths.has('a.txt') && paths.has('test/') && paths.has('test/unit/') && paths.has('test/unit/stats.test.js'));
    assert.ok(!paths.has('missing/'));
  });
  test('ignoredOnBase names the paths the base branch .gitignore ignores, folders by their contents', async () => {
    await commitFile(seed, '.gitignore', 'targets/*\n!targets/kept.mjs\nlocal.mjs\nlogs/\n'); await git(seed, 'push', '-q', 'origin', 'master');
    await ws.ensureClone(root, origin);
    const ignored = await ws.ignoredOnBase(join(root, 'repo'), 'master', ['targets/', 'local.mjs', 'logs/', 'targets/kept.mjs', 'spec/', 'a.txt']);
    assert.deepEqual([...ignored].sort(), ['local.mjs', 'logs/', 'targets/']);
  });
  test('ignoredOnBase is empty without a .gitignore on the base branch', async () => {
    assert.deepEqual([...await ws.ignoredOnBase(join(root, 'repo'), 'master', ['targets/'])], []);
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
  test('preparePush on its branch gives HEAD, and a detached HEAD is refused with no branch', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    assert.deepEqual(await ws.preparePush(dir, 'factory/issue-7'), { sha: await git(dir, 'rev-parse', 'HEAD'), reattached: false });
    await commitFile(dir, 'b.txt');
    await git(dir, 'checkout', '-q', '--detach', 'HEAD~1');
    assert.deepEqual(await ws.preparePush(dir, 'factory/issue-7'), { refused: 'not-on-branch', branch: null });
  });
  test('a tampered .git link is refused', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    await ws.checkGitLink(root, 7);
    writeFileSync(join(dir, '.git'), 'gitdir: ./.x\n');
    await assert.rejects(ws.checkGitLink(root, 7), /\.git link .* was changed/);
    await assert.rejects(ws.ensureWorktree(root, 7, 'master'), /\.git link .* was changed/);
  });
  test('checkCloneConfig accepts a plain clone with worktrees', async () => {
    await ws.ensureWorktree(root, 7, 'master');
    await ws.checkCloneConfig(root, origin);
  });
  for (const [what, args] of [
    ['a credential helper', ['credential.helper', '!touch /tmp/pwned']],
    ['an external diff', ['diff.external', 'sh -c x']],
    ['a merge driver', ['merge.x.driver', 'sh -c x']],
    ['an include', ['include.path', '/tmp/x']],
    ['a push URL', ['remote.origin.pushurl', 'https://example.com/x.git']],
  ]) {
    test(`checkCloneConfig refuses ${what}`, async () => {
      await git(join(root, 'repo'), 'config', ...args);
      await assert.rejects(ws.checkCloneConfig(root, origin), /clone's git config .* was changed/);
    });
  }
  test('checkCloneConfig refuses a changed origin', async () => {
    await git(join(root, 'repo'), 'remote', 'set-url', 'origin', 'https://example.com/x.git');
    await assert.rejects(ws.checkCloneConfig(root, origin), /origin/);
  });
  test('checkCloneConfig refuses a branch whose remote is not origin, and names the key', async () => {
    await git(join(root, 'repo'), 'config', 'branch.master.remote', 'elsewhere');
    const file = join(root, 'repo', '.git', 'config');
    await assert.rejects(ws.checkCloneConfig(root, origin), { message: `the clone's git config at ${file} was changed: branch.master.remote. The factory stops using it; remove those lines (or delete the clone) before starting again.` });
  });
  test('checkCloneConfig fails when the clone has no git config', async () => {
    const file = join(root, 'repo', '.git', 'config');
    rmSync(file);
    await assert.rejects(ws.checkCloneConfig(root, origin), { message: `the clone's git config at ${file} cannot be read: fatal: unable to read config file '${file}': No such file or directory` });
  });
  test('ensureClone fails on a URL that does not exist', async () => {
    const fresh = tempDir('factory-ws-');
    const missing = join(fresh, 'missing.git');
    await assert.rejects(ws.ensureClone(join(fresh, 'factory'), missing), { message: `git clone failed: fatal: repository '${missing}' does not exist` });
  });
  test('mergeBase fails, not conflicts, when the base branch is not on origin', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    await assert.rejects(ws.mergeBase(dir, 'nope'), { message: 'the remote has no branch nope' });
    assert.equal(await ws.mergeResolved(dir), true);
  });
  test('a redirected commondir is refused', async () => {
    await ws.ensureWorktree(root, 7, 'master');
    writeFileSync(join(root, 'repo', '.git', 'worktrees', 'issue-7', 'commondir'), '/tmp/elsewhere\n');
    await assert.rejects(ws.checkGitLink(root, 7), /commondir/);
  });
  test('abortMerge leaves a worktree that was mid-merge clean, at its old commit', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master'); await commitFile(dir, 'a.txt', 'mine\n');
    const before = (await ws.headInfo(dir)).sha;
    await commitFile(seed, 'a.txt', 'theirs\n'); await git(seed, 'push', '-q', 'origin', 'master');
    assert.equal(await ws.mergeBase(dir, 'master'), 'conflict');
    await ws.abortMerge(dir);
    assert.equal(await ws.isClean(dir), true);
    assert.equal(await ws.mergeResolved(dir), true);
    assert.equal((await ws.headInfo(dir)).sha, before);
  });
});

// preparePush puts a worktree whose HEAD an agent detached back on its branch, but only when HEAD builds on it.
describe('preparing the push', () => {
  const git = async (dir, ...args) => {
    const r = await run('git', ['-C', dir, ...ID, ...args]);
    assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const commitFile = async (dir, name) => { writeFileSync(join(dir, name), name); await git(dir, 'add', '-A'); await git(dir, 'commit', '-q', '-m', `add ${name}`); };
  const branchOf = async (dir) => (await run('git', ['-C', dir, 'symbolic-ref', '-q', '--short', 'HEAD'])).stdout.trim() || null;

  let root;
  beforeEach(async () => {
    const base = tempDir('factory-attach-');
    const origin = join(base, 'origin.git'), seed = join(base, 'seed');
    root = join(base, 'factory');
    await run('git', ['init', '-q', '--bare', '-b', 'master', origin]);
    await run('git', ['init', '-q', '-b', 'master', seed]);
    await commitFile(seed, 'a.txt');
    await git(seed, 'remote', 'add', 'origin', origin); await git(seed, 'push', '-q', 'origin', 'master');
    await ws.ensureClone(root, origin);
  });

  test('a detached HEAD on top of the branch is put back on the branch', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    await git(dir, 'checkout', '-q', '--detach');
    await commitFile(dir, 'work.txt');
    const head = (await ws.headInfo(dir)).sha;
    assert.deepEqual(await ws.preparePush(dir, 'factory/issue-7'), { sha: head, reattached: true });
    assert.equal(await branchOf(dir), 'factory/issue-7');
    assert.equal((await ws.headInfo(dir)).sha, head);
  });

  test('a detached HEAD that does not contain the branch tip stays as it is', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    await commitFile(dir, 'on-branch.txt');
    await git(dir, 'checkout', '-q', '--detach', 'HEAD~1');
    await commitFile(dir, 'elsewhere.txt');
    assert.deepEqual(await ws.preparePush(dir, 'factory/issue-7'), { refused: 'not-on-branch', branch: null });
    assert.equal(await branchOf(dir), null);
  });

  test('a worktree on another branch is refused and left alone', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    await git(dir, 'checkout', '-q', '-b', 'other');
    assert.deepEqual(await ws.preparePush(dir, 'factory/issue-7'), { refused: 'not-on-branch', branch: 'other' });
    assert.equal(await branchOf(dir), 'other');
  });

  test('a dirty tree is refused', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    writeFileSync(join(dir, 'loose.txt'), 'not committed');
    assert.deepEqual(await ws.preparePush(dir, 'factory/issue-7'), { refused: 'uncommitted', branch: 'factory/issue-7' });
  });

  test('sandbox leftovers do not count as dirty, and are removed', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    writeFileSync(join(dir, '.bashrc'), ''); chmodSync(join(dir, '.bashrc'), 0o444);
    mkdirSync(join(dir, 'sub/.claude/.cc-writes'), { recursive: true });
    assert.deepEqual(await ws.preparePush(dir, 'factory/issue-7'), { sha: await git(dir, 'rev-parse', 'HEAD'), reattached: false });
    assert.ok(!existsSync(join(dir, '.bashrc')));
    assert.ok(!existsSync(join(dir, 'sub/.claude')));
  });
});

// What the branch changes is measured against the base commit on the remote,
// never against the clone's origin ref, which agents can move.
describe('moved base ref', () => {
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
    const base = tempDir('factory-wsb-');
    origin = join(base, 'origin.git'); seed = join(base, 'seed'); root = join(base, 'factory');
    await run('git', ['init', '-q', '--bare', '-b', 'master', origin]);
    await run('git', ['init', '-q', '-b', 'master', seed]);
    writeFileSync(join(seed, 'a.txt'), 'one\n');
    await git(seed, 'add', '-A'); await git(seed, 'commit', '-q', '-m', 'init');
    await git(seed, 'remote', 'add', 'origin', origin); await git(seed, 'push', '-q', 'origin', 'master');
    await run('mkdir', ['-p', root]);
    await ws.ensureClone(root, origin);
  });

  test('a moved origin ref does not hide what the branch changes', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    await commitFile(dir, 'b.txt', 'x', 'Add b\n\nCo-Authored-By: x <x@example.invalid>');
    await git(dir, 'update-ref', 'refs/remotes/origin/master', 'HEAD');
    assert.deepEqual(await (await ws.againstBase(dir, 'master')).changes(), [{ status: 'A', path: 'b.txt' }]);
    assert.match(await (await ws.againstBase(dir, 'master')).diff('b.txt'), /\+x/);
    assert.equal((await (await ws.againstBase(dir, 'master')).messages()).length, 1);
  });

  test('the base is the remote commit, even one the clone has not fetched', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    await commitFile(seed, 'later.txt'); await git(seed, 'push', '-q', 'origin', 'master');
    const sha = await git(seed, 'rev-parse', 'HEAD');
    assert.equal((await ws.againstBase(dir, 'master')).sha, sha);
    // The branch does not have later.txt, so against the new base nothing is added.
    assert.deepEqual(await (await ws.againstBase(dir, 'master')).changes(), []);
  });

  test('a view keeps judging against the sha it was made with after the remote base moves', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    await commitFile(dir, 'b.txt', 'x', 'Add b');
    const view = await ws.againstBase(dir, 'master');
    const before = view.sha;
    // The remote's master takes the branch's commit and then later.txt, which the branch does not have.
    // Against that new base the branch changes nothing; against the view's sha it still adds b.txt.
    await git(dir, 'push', '-q', origin, 'HEAD:master');
    await git(seed, 'pull', '-q', '--ff-only', 'origin', 'master');
    await commitFile(seed, 'later.txt'); await git(seed, 'push', '-q', 'origin', 'master');
    await git(join(root, 'repo'), 'fetch', '-q', 'origin');
    assert.equal(view.sha, before);
    assert.deepEqual(await view.changes(), [{ status: 'A', path: 'b.txt' }]);
    assert.match(await view.diff(['b.txt', 'later.txt']), /\+x/);
    assert.doesNotMatch(await view.diff(['b.txt', 'later.txt']), /later\.txt/);
    assert.equal((await view.messages()).length, 1);
  });

  test('againstBase fails when the remote has no such branch', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    await assert.rejects(ws.againstBase(dir, 'nope'), /nope/);
  });

  test('a local read uses the clone\'s ref and never asks the remote', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    await commitFile(dir, 'b.txt');
    await git(join(root, 'repo'), 'remote', 'set-url', 'origin', join(root, 'missing.git'));
    assert.equal((await (await ws.againstBase(dir, 'master', { local: true })).messages()).length, 1);
  });

  test('checkCloneConfig refuses a changed fetch refspec', async () => {
    await git(join(root, 'repo'), 'config', 'remote.origin.fetch', '+refs/heads/x:refs/remotes/origin/x');
    await assert.rejects(ws.checkCloneConfig(root, origin), /remote\.origin\.fetch/);
  });

  test('checkCloneConfig refuses an extra fetch refspec', async () => {
    await git(join(root, 'repo'), 'config', '--add', 'remote.origin.fetch', '+refs/heads/master:refs/heads/elsewhere');
    await assert.rejects(ws.checkCloneConfig(root, origin), /remote\.origin\.fetch/);
  });

  test('checkCloneConfig accepts a plain clone\'s fetch refspec', async () => {
    assert.equal(await git(join(root, 'repo'), 'config', 'remote.origin.fetch'), '+refs/heads/*:refs/remotes/origin/*');
    await ws.checkCloneConfig(root, origin);
  });
});

// againstBase's diff takes several paths, and a commit to diff from.
describe('diff', () => {
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
    const base = tempDir('factory-wsd-');
    origin = join(base, 'origin.git'); seed = join(base, 'seed'); root = join(base, 'factory');
    await run('git', ['init', '-q', '--bare', '-b', 'master', origin]);
    await run('git', ['init', '-q', '-b', 'master', seed]);
    writeFileSync(join(seed, 'a.txt'), 'one\n');
    await git(seed, 'add', '-A'); await git(seed, 'commit', '-q', '-m', 'init');
    await git(seed, 'remote', 'add', 'origin', origin); await git(seed, 'push', '-q', 'origin', 'master');
    await run('mkdir', ['-p', root]);
    await ws.ensureClone(root, origin);
  });

  test('againstBase diff covers a list of paths, and only what changed since a commit', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    await commitFile(dir, 'b.txt', 'bee');
    const since = await git(dir, 'rev-parse', 'HEAD');
    await commitFile(dir, 'c.txt', 'sea');
    const both = await (await ws.againstBase(dir, 'master')).diff(['b.txt', 'c.txt']);
    assert.match(both, /\+bee/); assert.match(both, /\+sea/);
    const later = await (await ws.againstBase(dir, 'master')).diff(['b.txt', 'c.txt'], since);
    assert.doesNotMatch(later, /\+bee/); assert.match(later, /\+sea/);
  });
});

// The workspace handle checks the clone before every git command it runs:
// agents can write the clone's config and a worktree's .git link.
describe('handle guard', () => {
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
    const base = tempDir('factory-wsg-');
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
    const view = await h.againstBase(dir);
    assert.deepEqual(await view.changes(), [{ status: 'A', path: 'b.txt' }]);
    assert.match(await view.diff(['b.txt']), /\+x/);
    assert.equal((await view.messages()).length, 1);
    assert.deepEqual(await h.preparePush(dir, 'factory/issue-7'), { sha: (await h.headInfo(dir)).sha, reattached: false });
    assert.deepEqual(await h.listWorktrees(), [7]);
  });

  test('planted clone config stops every git command, worktree removal included', async () => {
    const h = handle();
    const { dir } = await h.ensureWorktree(7);
    await plant();
    /** @type {[string, () => Promise<unknown>][]} */
    const calls = [['ensureWorktree', () => h.ensureWorktree(8)], ['headInfo', () => h.headInfo(dir)], ['isClean', () => h.isClean(dir)],
      ['againstBase', () => h.againstBase(dir)], ['mergeBase', () => h.mergeBase(dir)], ['push', () => h.push(dir, 'factory/issue-7', 'abc')], ['preparePush', () => h.preparePush(dir, 'factory/issue-7')],
      ['removeWorktree', () => h.removeWorktree(7)], ['ensureClone', () => h.ensureClone()], ['checkClone', () => h.checkClone()]];
    for (const [name, call] of calls)
      await assert.rejects(call, /credential\.helper/, name);
  });

  test('config planted after againstBase stops each read of its view', async () => {
    const h = handle();
    const { dir } = await h.ensureWorktree(7);
    const view = await h.againstBase(dir);
    await plant();
    /** @type {[string, () => Promise<unknown>][]} */
    const reads = [['changes', () => view.changes()], ['diff', () => view.diff('a.txt')], ['messages', () => view.messages()]];
    for (const [name, call] of reads)
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
});

// The Claude sandbox leaves empty .claude/.cc-writes folders behind, also in subfolders where a session ran commands.
describe('sandbox leftovers', () => {
  const git = async (dir, ...args) => {
    const r = await run('git', ['-C', dir, ...ID, ...args]);
    assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
  };

  let root;
  beforeEach(async () => {
    const base = tempDir('factory-leftovers-');
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
});

// Runs in one factory share the clone: their fetches must not trip over each other.
describe('parallel runs', () => {
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
    const base = tempDir('factory-wsp-');
    origin = join(base, 'origin.git'); seed = join(base, 'seed'); root = join(base, 'factory');
    await run('git', ['init', '-q', '--bare', '-b', 'master', origin]);
    await run('git', ['init', '-q', '-b', 'master', seed]);
    writeFileSync(join(seed, 'a.txt'), 'one\n');
    await git(seed, 'add', '-A'); await git(seed, 'commit', '-q', '-m', 'init');
    await git(seed, 'remote', 'add', 'origin', origin); await git(seed, 'push', '-q', 'origin', 'master');
    await run('mkdir', ['-p', root]);
    await ws.ensureClone(root, origin);
  });

  test('parallel runs fetching the moved base all succeed', async () => {
    for (let i = 0; i < 3; i++) {
      await commitFile(seed, `m${i}.txt`); await git(seed, 'push', '-q', 'origin', 'master');
      await Promise.all([1, 2, 3, 4, 5, 6].map((n) => ws.ensureWorktree(root, n, 'master')));
    }
  });

  test('git errors carry no grafts deprecation hint', async () => {
    const { dir } = await ws.ensureWorktree(root, 7, 'master');
    await assert.rejects(() => ws.push(dir, 'factory/issue-7', 'dead'.repeat(10)), (/** @type {Error} */ e) => !/grafts is deprecated/.test(e.message));
  });
});

// Whatever hints a git version prints, an error keeps only the lines that say what went wrong.
describe('git error messages', () => {
  test('git errors leave out hint lines', async () => {
    const base = tempDir('factory-hint-');
    const bin = join(base, 'bin'), root = join(base, 'factory');
    mkdirSync(bin);
    writeFileSync(join(bin, 'git'), "#!/bin/sh\nprintf 'hint: a\\nhint: b\\nfatal: real reason\\n' >&2\nexit 1\n");
    chmodSync(join(bin, 'git'), 0o755);
    mkdirSync(join(root, 'upstream.git'), { recursive: true });
    writeFileSync(join(root, 'upstream.git', 'HEAD'), 'ref: refs/heads/master\n');
    mkdirSync(join(root, 'repo', '.git'), { recursive: true });
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      await assert.rejects(() => ws.ensureClone(root, 'unused'), (/** @type {Error} */ e) => e.message.includes('fatal: real reason') && !e.message.includes('hint:'));
    } finally { process.env.PATH = path; }
  });
});

// Replace refs and grafts in the clone must not change what the factory's git sees.
describe('replace refs and grafts', () => {
  const git = async (dir, ...args) => {
    const r = await run('git', ['-C', dir, ...ID, ...args]);
    assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };

  let root, dir;
  beforeEach(async () => {
    const base = tempDir('factory-replace-');
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
    assert.deepEqual((await (await ws.againstBase(dir, 'master')).changes()).map((c) => c.path), ['.github/workflows/ci.yml']);
    assert.match(await (await ws.againstBase(dir, 'master')).diff('.github'), /on: push/);
    assert.deepEqual(await (await ws.againstBase(dir, 'master')).messages(), ['Add CI']);
  });

  test('a grafts file does not hide what the branch changes', async () => {
    const baseSha = await git(dir, 'rev-parse', 'origin/master'), head = await git(dir, 'rev-parse', 'HEAD');
    mkdirSync(join(root, 'repo', '.git', 'info'), { recursive: true });
    writeFileSync(join(root, 'repo', '.git', 'info', 'grafts'), `${baseSha} ${head}\n`);
    assert.deepEqual((await (await ws.againstBase(dir, 'master')).changes()).map((c) => c.path), ['.github/workflows/ci.yml']);
    assert.deepEqual(await (await ws.againstBase(dir, 'master')).messages(), ['Add CI']);
  });
});

// A run's agent can change the clone's .git/config just after the factory checked it. Whatever that config makes the
// factory's git run stays confined, and the push goes out from a clone no agent can write.
describe('git config changed during a run', () => {
  const git = async (dir, ...args) => {
    const r = await run('git', ['-C', dir, ...ID, ...args]);
    assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };

  let base, root, origin, dir;
  beforeEach(async () => {
    base = tempDir('factory-race-');
    origin = join(base, 'origin.git'); root = join(base, 'factory');
    const seed = join(base, 'seed');
    await run('git', ['init', '-q', '--bare', '-b', 'master', origin]);
    await run('git', ['init', '-q', '-b', 'master', seed]);
    writeFileSync(join(seed, 'a.txt'), 'one\n');
    await git(seed, 'add', '-A'); await git(seed, 'commit', '-q', '-m', 'init');
    await git(seed, 'remote', 'add', 'origin', origin); await git(seed, 'push', '-q', 'origin', 'master');
    mkdirSync(root, { recursive: true });
    await ws.ensureClone(root, origin);
    ({ dir } = await ws.ensureWorktree(root, 7, 'master'));
    writeFileSync(join(dir, 'a.txt'), 'two\n');
    await git(dir, 'commit', '-q', '-am', 'Change a');
  });

  test('a command the config plants runs confined: it writes the worktree, nothing outside', real, async () => {
    // Called without the workspace's config check: the check already passed, then the agent changed the config.
    await git(join(root, 'repo'), 'config', 'diff.external', `touch ${join(dir, 'inside')} ${join(base, 'outside')}; true #`);
    await (await ws.againstBase(dir, 'master')).diff('a.txt');
    assert.ok(existsSync(join(dir, 'inside')), 'the planted command did not run at all');
    assert.ok(!existsSync(join(base, 'outside')), 'the planted command wrote outside the confinement');
  });

  test('a command the config plants for the push does not run', async () => {
    // git runs remote.<name>.receivepack to push to a path, as it runs core.sshCommand for an ssh remote.
    await git(join(root, 'repo'), 'config', 'remote.origin.receivepack', `touch ${join(base, 'outside')}; git-receive-pack`);
    await ws.push(dir, 'factory/issue-7', await git(dir, 'rev-parse', 'HEAD'));
    assert.ok(!existsSync(join(base, 'outside')));
  });

  test('the push goes out from the factory\'s own clone, not the one agents write', async () => {
    const elsewhere = join(base, 'elsewhere.git');
    await run('git', ['init', '-q', '--bare', '-b', 'master', elsewhere]);
    await git(join(root, 'repo'), 'remote', 'set-url', 'origin', elsewhere);
    await git(join(root, 'repo'), 'config', 'remote.origin.pushurl', elsewhere);
    const sha = await git(dir, 'rev-parse', 'HEAD');
    await ws.push(dir, 'factory/issue-7', sha);
    assert.equal(await git(origin, 'rev-parse', 'refs/heads/factory/issue-7'), sha);
    assert.equal((await run('git', ['-C', elsewhere, 'rev-parse', '-q', '--verify', 'refs/heads/factory/issue-7'])).code, 1);
  });

  test('that clone sits next to the agents\' clone, outside it and outside the worktrees', () => {
    assert.ok(existsSync(join(root, 'upstream.git', 'HEAD')));
    assert.equal((readFileSync(join(root, 'upstream.git', 'config'), 'utf8').match(/url = (.*)/) ?? [])[1], origin);
  });

  test('a base the agents\' clone never fetched is read from the factory\'s clone', async () => {
    await git(join(root, 'repo'), 'remote', 'set-url', 'origin', join(base, 'missing.git'));
    assert.deepEqual(await (await ws.againstBase(dir, 'master')).changes(), [{ status: 'M', path: 'a.txt' }]);
  });
});

// The branch's new and changed tests, run against the base's code: every other file the branch changed is put back
// to the pinned base for the run, then the branch is restored exactly.
describe('tests on the base', () => {
  const git = async (dir, ...args) => {
    const r = await run('git', ['-C', dir, ...ID, ...args]);
    assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const write = (dir, files) => { for (const [p, c] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), c); } };

  let base, root, origin, dir, sha;
  beforeEach(async () => {
    base = tempDir('factory-onbase-');
    origin = join(base, 'origin.git'); root = join(base, 'factory');
    const seed = join(base, 'seed');
    await run('git', ['init', '-q', '--bare', '-b', 'master', origin]);
    await run('git', ['init', '-q', '-b', 'master', seed]);
    write(seed, { 'src/a.js': 'one\n', 'src/gone.js': 'gone\n', 'test/a.test.js': 'old test\n', 'test/kept.test.js': 'kept\n' });
    await git(seed, 'add', '-A'); await git(seed, 'commit', '-q', '-m', 'init');
    await git(seed, 'remote', 'add', 'origin', origin); await git(seed, 'push', '-q', 'origin', 'master');
    mkdirSync(root, { recursive: true });
    await ws.ensureClone(root, origin);
    ({ dir } = await ws.ensureWorktree(root, 7, 'master'));
    sha = await git(dir, 'rev-parse', 'HEAD');
  });

  const branchChanges = async () => {
    write(dir, { 'src/a.js': 'two\n', 'src/new.js': 'new\n', 'test/a.test.js': 'new test\n', 'test/b.test.js': 'b test\n' });
    rmSync(join(dir, 'src/gone.js'));
    await git(dir, 'add', '-A'); await git(dir, 'commit', '-q', '-m', 'Change things');
  };
  const read = (p) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), 'utf8') : null);

  test('the run sees the base code with the branch\'s new and changed tests', async () => {
    await branchChanges();
    let seen;
    const out = await ws.testsOnBase(dir, sha, ['test/'], async (files) => {
      seen = { files, a: read('src/a.js'), gone: read('src/gone.js'), added: read('src/new.js'), t: read('test/a.test.js'), b: read('test/b.test.js') };
      return 'result';
    });
    assert.equal(out, 'result');
    assert.deepEqual(seen, { files: ['test/a.test.js', 'test/b.test.js'], a: 'one\n', gone: 'gone\n', added: null, t: 'new test\n', b: 'b test\n' });
  });

  test('afterwards HEAD and every file are exactly the branch\'s', async () => {
    await branchChanges();
    const head = await git(dir, 'rev-parse', 'HEAD');
    await ws.testsOnBase(dir, sha, ['test/'], async () => { write(dir, { 'stray.txt': 'left by the tests', 'src/a.js': 'changed by the tests\n' }); });
    assert.equal(await git(dir, 'rev-parse', 'HEAD'), head);
    assert.equal(await git(dir, 'symbolic-ref', '--short', 'HEAD'), 'factory/issue-7');
    assert.equal(await git(dir, 'status', '--porcelain'), '');
    assert.deepEqual([read('src/a.js'), read('src/new.js'), read('src/gone.js'), read('stray.txt')], ['two\n', 'new\n', null, null]);
  });

  test('untracked files the checks left are removed before the run, not a reason to stop', async () => {
    await branchChanges();
    const head = await git(dir, 'rev-parse', 'HEAD');
    write(dir, { 'coverage/report.txt': 'left by the checks\n', 'results.tap': 'ok 1\n' });
    let seen;
    await ws.testsOnBase(dir, sha, ['test/'], async () => { seen = [read('coverage/report.txt'), read('results.tap'), read('src/a.js')]; });
    assert.deepEqual(seen, [null, null, 'one\n']);
    assert.equal(await git(dir, 'rev-parse', 'HEAD'), head);
    assert.equal(await git(dir, 'status', '--porcelain'), '');
  });

  test('the branch is restored when the run throws', async () => {
    await branchChanges();
    await assert.rejects(() => ws.testsOnBase(dir, sha, ['test/'], async () => { throw new Error('boom'); }), /boom/);
    assert.equal(await git(dir, 'status', '--porcelain'), '');
    assert.equal(read('src/a.js'), 'two\n');
  });

  test('a run that moves HEAD stops with an error', async () => {
    await branchChanges();
    await assert.rejects(() => ws.testsOnBase(dir, sha, ['test/'], async () => { await git(dir, 'checkout', '-q', '--detach', 'HEAD~1'); }), /HEAD/);
  });

  test('without new or changed tests nothing runs', async () => {
    write(dir, { 'src/a.js': 'two\n' });
    await git(dir, 'commit', '-q', '-am', 'Change a');
    let ran = false;
    assert.equal(await ws.testsOnBase(dir, sha, ['test/'], async () => { ran = true; }), null);
    assert.equal(ran, false);
  });

  test('the handle runs it against the given base and checks the clone config first', async () => {
    const h = workspace({ root, url: origin, base: 'master' });
    await branchChanges();
    assert.deepEqual(await h.testsOnBase(dir, sha, ['test/'], async (files) => files), ['test/a.test.js', 'test/b.test.js']);
    await git(join(root, 'repo'), 'config', 'credential.helper', '!touch /tmp/pwned');
    await assert.rejects(() => h.testsOnBase(dir, sha, ['test/'], async () => {}), /credential\.helper/);
  });
  test('the handle makes the copy in a folder of its own next to the run folder, not in the system temp folder', async () => {
    const h = workspace({ root, url: origin, base: 'master' });
    const parent = await h.inCopy(dir, async (copy) => dirname(copy));
    assert.equal(parent, ws.copiesOf(root));
    assert.equal(parent, join(dirname(root), `.${basename(root)}-copies`));
  });
});

// Held-out checks run in a throwaway copy of the worktree (ADR 0009).
describe('throwaway copy', () => {
  let copies;
  beforeEach(() => { copies = join(tempDir('factory-copies-'), 'copies'); });
  const worktree = () => {
    const dir = tempDir('factory-copy-');
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    mkdirSync(join(dir, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'dep', 'index.js'), 'dep\n');
    return dir;
  };

  test('the copy holds every file, ignored ones included, and writes to it miss the worktree', async () => {
    const dir = worktree();
    const seen = await ws.inCopy(dir, async (copy) => {
      const files = [readFileSync(join(copy, 'a.txt'), 'utf8'), readFileSync(join(copy, 'node_modules', 'dep', 'index.js'), 'utf8')];
      writeFileSync(join(copy, 'a.txt'), 'two\n');
      writeFileSync(join(copy, 'node_modules', 'dep', 'index.js'), 'z\n');
      return { copy, files };
    }, copies);
    assert.notEqual(seen.copy, dir);
    assert.deepEqual(seen.files, ['one\n', 'dep\n']);
    assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'one\n');
    assert.equal(readFileSync(join(dir, 'node_modules', 'dep', 'index.js'), 'utf8'), 'dep\n');
  });
  test('the copy is gone after the checks pass', async () => {
    let copy;
    assert.equal(await ws.inCopy(worktree(), async (c) => { copy = c; return 'passed'; }, copies), 'passed');
    assert.ok(!existsSync(copy));
  });
  test('the copy is gone after the checks fail or throw', async () => {
    let copy;
    await assert.rejects(ws.inCopy(worktree(), async (c) => { copy = c; throw new Error('boom'); }, copies), /boom/);
    assert.ok(!existsSync(copy));
  });
  test('the copy is gone even when the checks left a folder without write permission', async () => {
    let copy;
    await ws.inCopy(worktree(), async (c) => { copy = c; mkdirSync(join(c, 'locked')); writeFileSync(join(c, 'locked', 'f'), 'x'); chmodSync(join(c, 'locked'), 0o500); }, copies);
    assert.ok(!existsSync(copy));
  });
  test('the copies folder is only for the factory: mode 0700, whatever mode the worktree has', async () => {
    const dir = worktree();
    chmodSync(dir, 0o755);
    const seen = await ws.inCopy(dir, async (copy) => ({ parent: dirname(copy), mode: statSync(copies).mode & 0o777 }), copies);
    assert.equal(seen.parent, copies);
    assert.equal(seen.mode, 0o700);
  });
  test('an existing copies folder that others can read is closed again', async () => {
    mkdirSync(copies, { mode: 0o755 });
    chmodSync(copies, 0o755);
    const mode = await ws.inCopy(worktree(), async () => statSync(copies).mode & 0o777, copies);
    assert.equal(mode, 0o700);
  });
  test('removeLeftoverCopies deletes the copies a killed factory left, and nothing else', async () => {
    mkdirSync(join(copies, 'factory-copy-old', 'node_modules', '.cache', 'x'), { recursive: true });
    writeFileSync(join(copies, 'factory-copy-old', 'node_modules', '.cache', 'x', 'held.test.mjs'), 'secret\n');
    mkdirSync(join(copies, 'factory-copy-locked', 'ro'), { recursive: true });
    writeFileSync(join(copies, 'factory-copy-locked', 'ro', 'f'), 'x');
    chmodSync(join(copies, 'factory-copy-locked', 'ro'), 0o500);
    writeFileSync(join(copies, 'notes.txt'), 'keep\n');
    ws.removeLeftoverCopies(copies);
    assert.deepEqual(readdirSync(copies), ['notes.txt']);
  });
  test('removeLeftoverCopies does nothing when there is no copies folder', () => {
    ws.removeLeftoverCopies(join(copies, 'missing'));
    assert.ok(!existsSync(join(copies, 'missing')));
  });
});
