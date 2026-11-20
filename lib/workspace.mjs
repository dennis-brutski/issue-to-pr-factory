import { existsSync, readdirSync, readFileSync, mkdirSync, statSync, rmSync, rmdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { run } from './exec.mjs';
import { branchFor, worktreeFor, issueOfWorktree } from './names.mjs';

// Agents can write to the clone's .git. These flags make sure nothing they
// left in its hooks or fsmonitor config runs with the factory's rights.
const SAFE = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'advice.graftFileDeprecated=false'];
// Replace refs and a grafts file make git read other commits than the real ones,
// which can hide what a branch changes. The factory's git ignores both.
const SAFE_ENV = { GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: '/dev/null' };

async function git(dir, args, { allowFail = false } = {}) {
  const r = await run('git', ['-C', dir, ...SAFE, ...args], { env: SAFE_ENV, timeoutMs: 300_000 });
  if (r.code !== 0 && !allowFail)
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim().slice(0, 1000)}`);
  return r;
}

// Runs share the clone, and two fetches at once fight over its ref locks: one at a time.
// ponytail: one queue for the whole process; per clone if one process ever serves several targets.
let fetchQueue = Promise.resolve();
function fetch(dir, args) {
  const r = fetchQueue.then(() => git(dir, ['fetch', ...args]));
  fetchQueue = r.catch(() => {});
  return r;
}

export function paths(root, n) {
  return {
    clone: join(root, 'repo'),
    worktree: join(root, 'worktrees', worktreeFor(n)),
    logs: join(root, 'logs', worktreeFor(n)),
    branch: branchFor(n),
  };
}

export async function ensureClone(root, remoteUrl) {
  const clone = join(root, 'repo');
  if (!existsSync(join(clone, '.git'))) {
    mkdirSync(root, { recursive: true });
    const r = await run('git', [...SAFE, 'clone', '-q', remoteUrl, clone], { env: SAFE_ENV, timeoutMs: 600_000 });
    if (r.code !== 0) throw new Error(`git clone failed: ${r.stderr.trim().slice(0, 1000)}`);
  } else {
    await fetch(clone, ['-q', '--prune', 'origin']);
  }
}

// Every file on the remote base branch, and every folder with a trailing slash.
export async function pathsOnBase(clone, baseBranch) {
  const files = (await git(clone, ['ls-tree', '-r', '--name-only', `origin/${baseBranch}`])).stdout.split('\n').filter(Boolean);
  const out = new Set(files);
  for (const f of files) for (let i = f.indexOf('/'); i !== -1; i = f.indexOf('/', i + 1)) out.add(f.slice(0, i + 1));
  return out;
}

export async function hasRemoteBranch(clone, baseBranch) {
  return (await git(clone, ['rev-parse', '-q', '--verify', `refs/remotes/origin/${baseBranch}`], { allowFail: true })).code === 0;
}

export async function ensureWorktree(root, n, baseBranch) {
  const p = paths(root, n);
  // The sandbox also guards the clone's .git/config through a placeholder lock.
  const lock = join(p.clone, '.git', 'config.lock');
  if (isPlaceholder(lock)) rmSync(lock);
  await fetch(p.clone, ['-q', '--prune', 'origin']);
  if (existsSync(p.worktree)) { await checkGitLink(root, n); await removeSandboxLeftovers(p.worktree); return { dir: p.worktree, created: false }; }
  mkdirSync(join(root, 'worktrees'), { recursive: true });
  await git(p.clone, ['worktree', 'prune']);
  const remote = await git(p.clone, ['rev-parse', '-q', '--verify', `refs/remotes/origin/${p.branch}`], { allowFail: true });
  const start = remote.code === 0 ? `origin/${p.branch}` : `origin/${baseBranch}`;
  await git(p.clone, ['worktree', 'add', '-q', '-B', p.branch, p.worktree, start]);
  return { dir: p.worktree, created: true };
}

const isPlaceholder = (abs) => {
  const st = statSync(abs, { throwIfNoEntry: false });
  return !!st?.isFile() && st.size === 0 && !(st.mode & 0o222);
};

// Every .cc-writes folder under dir, at any depth. .git and node_modules are not searched.
function ccWrites(dir) {
  const found = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === '.git' || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.name === '.cc-writes') found.push(p); else found.push(...ccWrites(p));
  }
  return found;
}

// The Claude sandbox mounts over dotfiles (.bashrc, .gitconfig, .claude/…) through
// empty read-only placeholders and removes them on exit. A killed session leaves
// them behind; they would park the run as uncommitted changes or end up in a commit.
// It also leaves empty .claude/.cc-writes folders, in subfolders too, even after a normal exit.
export async function removeSandboxLeftovers(dir) {
  const files = (await git(dir, ['ls-files', '-o', '--exclude-standard', '-z'])).stdout.split('\0').filter(Boolean);
  const dirs = new Set([join(dir, '.claude', '.cc-writes'), join(dir, '.claude')]);
  for (const d of ccWrites(dir)) { dirs.add(d); dirs.add(dirname(d)); }
  for (const f of files) {
    const abs = join(dir, f);
    if (!isPlaceholder(abs)) continue;
    rmSync(abs);
    for (let d = dirname(abs); d !== dir; d = dirname(d)) dirs.add(d);
  }
  // Deepest first; rmdir only succeeds on folders that are now empty.
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) try { rmdirSync(d); } catch {}
}

export async function headInfo(dir) {
  const [sha, committedAt] = (await git(dir, ['log', '-1', '--format=%H %cI'])).stdout.trim().split(' ');
  return { sha, committedAt };
}

// The base commit as GitHub has it right now. The clone's origin ref is no
// good for this: agents commit into the same git data and can move it.
export async function remoteBase(dir, baseBranch) {
  const ref = `refs/heads/${baseBranch}`;
  const out = (await git(dir, ['ls-remote', 'origin', ref])).stdout;
  const sha = out.split('\n').map((l) => l.split('\t')).find(([, r]) => r === ref)?.[0];
  if (!/^[0-9a-f]{40,64}$/.test(sha ?? '')) throw new Error(`the remote has no branch ${baseBranch}`);
  // A commit's name is its content's hash, so one already here is the right one.
  if ((await git(dir, ['cat-file', '-e', `${sha}^{commit}`], { allowFail: true })).code !== 0)
    await fetch(dir, ['-q', 'origin', sha]);
  return sha;
}

// Brakes need the remote base. `local` reads the clone's ref instead, for
// notes that decide nothing and must not reach the network.
const baseRev = async (dir, baseBranch, local) => (local ? `origin/${baseBranch}` : await remoteBase(dir, baseBranch));

// With `since` (a commit), only what changed after it.
export async function changesAgainstBase(dir, baseBranch, since = null) {
  const range = since ? `${since}..HEAD` : `${await baseRev(dir, baseBranch)}...HEAD`;
  const out = (await git(dir, ['diff', '--name-status', '-M', range])).stdout;
  return out.split('\n').filter(Boolean).map((line) => {
    const [code, a, b] = line.split('\t');
    const status = code[0];
    return status === 'R' || status === 'C'
      ? { status: status === 'C' ? 'A' : 'R', ...(status === 'R' ? { oldPath: a } : {}), path: b }
      : { status, path: a };
  });
}

// pathspec: one path or a list. With `since` (a commit), only what changed after it.
export async function diffAgainstBase(dir, baseBranch, pathspec, since = null) {
  const range = since ? `${since}..HEAD` : `${await baseRev(dir, baseBranch)}...HEAD`;
  return (await git(dir, ['diff', range, '--', ...[pathspec].flat()])).stdout;
}

export async function commitMessagesAgainstBase(dir, baseBranch, { local = false } = {}) {
  const out = (await git(dir, ['log', '--format=%B%x00', `${await baseRev(dir, baseBranch, local)}..HEAD`])).stdout;
  return out.split('\0').map((m) => m.trim()).filter(Boolean);
}

export async function isClean(dir) {
  return (await git(dir, ['status', '--porcelain'])).stdout.trim() === '';
}

async function mergeInProgress(dir) {
  return (await git(dir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { allowFail: true })).code === 0;
}

async function unmerged(dir) {
  return (await git(dir, ['diff', '--name-only', '--diff-filter=U'])).stdout.trim() !== '';
}

// Merges the base branch into the worktree's branch. A merge left half-done
// by an earlier attempt is continued, not restarted.
export async function mergeBase(dir, baseBranch) {
  if (await mergeInProgress(dir)) return 'conflict';
  await fetch(dir, ['-q', 'origin']);
  const r = await git(dir, ['merge', '--no-edit', `origin/${baseBranch}`], { allowFail: true });
  if (r.code === 0) return 'clean';
  if (await mergeInProgress(dir)) return 'conflict';
  throw new Error(`git merge failed: ${(r.stderr || r.stdout).trim().slice(0, 1000)}`);
}

// Puts the worktree back as it was before a merge that conflicted.
export async function abortMerge(dir) {
  await git(dir, ['merge', '--abort']);
}

export async function mergeResolved(dir) {
  return !(await mergeInProgress(dir)) && !(await unmerged(dir));
}

// Never forces: a rewritten branch is a reason to stop, not to overwrite.
// Pushes exactly `sha` — the commit the brakes and checks looked at — never
// whatever the branch ref has been moved to since.
export async function push(dir, branch, sha) {
  await git(dir, ['push', '-q', 'origin', `${sha}:refs/heads/${branch}`]);
}

export async function currentBranch(dir) {
  const r = await git(dir, ['symbolic-ref', '-q', '--short', 'HEAD'], { allowFail: true });
  return r.code === 0 ? r.stdout.trim() : null;
}

// An agent that detached HEAD and committed on top of its branch: put the branch at HEAD and check it out.
// Only when HEAD is detached and contains the branch tip; true when it did.
export async function attachBranch(dir, branch) {
  if (await currentBranch(dir)) return false;
  const ahead = await git(dir, ['merge-base', '--is-ancestor', `refs/heads/${branch}`, 'HEAD'], { allowFail: true });
  if (ahead.code !== 0) return false;
  await git(dir, ['checkout', '-q', '-B', branch, 'HEAD']);
  return true;
}

// A worktree's .git file says where its git data is. Agents can write it; if it
// no longer points into the factory's clone, the factory's own (unconfined) git
// commands would use a repo — and a config — the agent made.
// Agents commit in the clone, so they can write its .git/config, and every git
// command the factory runs there (unconfined, as the user) reads it: credential
// helpers, external diffs, merge drivers and filters would run. A plain clone
// holds only these keys; anything else means the clone can no longer be used.
const CONFIG_ALLOWED = [/^core\.(repositoryformatversion|filemode|bare|logallrefupdates)$/, /^remote\.origin\.(url|fetch)$/, /^branch\..+\.(remote|merge)$/];

// A plain clone's refspec; another one could keep a fetch from repairing origin refs.
const FETCH = '+refs/heads/*:refs/remotes/origin/*';

export async function checkCloneConfig(root, url) {
  const file = join(root, 'repo', '.git', 'config');
  // --file and --no-includes: only this file is read, nothing in it is acted on.
  const r = await run('git', ['config', '--file', file, '--no-includes', '--list', '-z'], { cwd: root, timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(`the clone's git config at ${file} cannot be read: ${r.stderr.trim()}`);
  const bad = [];
  for (const entry of r.stdout.split('\0').filter(Boolean)) {
    const [key, value = ''] = entry.split(/\n(.*)/s);
    if (!CONFIG_ALLOWED.some((re) => re.test(key))) bad.push(key);
    else if (key === 'remote.origin.url' && value !== url) bad.push(`remote.origin.url (origin is ${value}, not ${url})`);
    else if (key === 'remote.origin.fetch' && value !== FETCH) bad.push(`remote.origin.fetch (${value})`);
    else if (/^branch\..+\.remote$/.test(key) && value !== 'origin') bad.push(key);
  }
  if (bad.length) throw new Error(`the clone's git config at ${file} was changed: ${bad.join(', ')}. The factory stops using it; remove those lines (or delete the clone) before starting again.`);
}

export async function checkGitLink(root, n) {
  const p = paths(root, n);
  const expected = `gitdir: ${join(p.clone, '.git', 'worktrees', basename(p.worktree))}`;
  const actual = readFileSync(join(p.worktree, '.git'), 'utf8').trim();
  if (actual !== expected) throw new Error(`the worktree's .git link at ${p.worktree} was changed — it no longer points into the factory's clone`);
  const commondir = readFileSync(join(p.clone, '.git', 'worktrees', basename(p.worktree), 'commondir'), 'utf8').trim();
  if (commondir !== '../..') throw new Error(`the worktree's commondir for ${p.worktree} was changed to ${commondir} — it no longer points into the factory's clone`);
}

export async function removeWorktree(root, n) {
  const p = paths(root, n);
  if (existsSync(p.worktree)) await git(p.clone, ['worktree', 'remove', '--force', p.worktree]);
  await git(p.clone, ['worktree', 'prune']);
  await git(p.clone, ['branch', '-D', p.branch], { allowFail: true });
}

export async function listWorktrees(root) {
  const dir = join(root, 'worktrees');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map(issueOfWorktree).filter((n) => n !== null);
}

// One target's workspace, bound to its run folder, clone URL and base branch. Every
// method that runs git first checks the clone's config and, for a worktree, its .git
// link: agents can write both, and the factory's own git acts on what they say.
// Callers cannot forget the check, because there is no way to run git around it.
export function workspace({ root, url, base }) {
  const clone = join(root, 'repo');
  const checkClone = () => checkCloneConfig(root, url);
  const inWorktree = (fn) => async (dir, ...args) => {
    const n = issueOfWorktree(basename(dir));
    if (n === null || paths(root, n).worktree !== dir) throw new Error(`${dir} is not one of the factory's worktrees`);
    await checkClone();
    await checkGitLink(root, n);
    return fn(dir, ...args);
  };
  return {
    paths: (n) => paths(root, n),
    checkClone,
    ensureClone: async () => { if (existsSync(join(clone, '.git'))) await checkClone(); return ensureClone(root, url); },
    hasRemoteBranch: async () => { await checkClone(); return hasRemoteBranch(clone, base); },
    pathsOnBase: async () => { await checkClone(); return pathsOnBase(clone, base); },
    ensureWorktree: async (n) => { await checkClone(); return ensureWorktree(root, n, base); },
    removeWorktree: async (n) => {
      await checkClone();
      if (existsSync(paths(root, n).worktree)) await checkGitLink(root, n);
      return removeWorktree(root, n);
    },
    listWorktrees: async () => listWorktrees(root), // reads a folder, runs no git
    headInfo: inWorktree(headInfo),
    changesAgainstBase: inWorktree((dir, since = null) => changesAgainstBase(dir, base, since)),
    diffAgainstBase: inWorktree((dir, pathspec, since = null) => diffAgainstBase(dir, base, pathspec, since)),
    commitMessagesAgainstBase: inWorktree((dir, opts = {}) => commitMessagesAgainstBase(dir, base, opts)),
    isClean: inWorktree(isClean),
    mergeBase: inWorktree((dir) => mergeBase(dir, base)),
    abortMerge: inWorktree(abortMerge),
    mergeResolved: inWorktree(mergeResolved),
    push: inWorktree(push),
    currentBranch: inWorktree(currentBranch),
    attachBranch: inWorktree(attachBranch),
    removeSandboxLeftovers: inWorktree(removeSandboxLeftovers),
  };
}
