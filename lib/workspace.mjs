import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, statSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { run } from './exec.mjs';
import { bwrapArgs, pick, gitIdentityEnv } from './confine.mjs';
import { branchFor, worktreeFor, issueOfWorktree } from './names.mjs';

// Agents can write to the clone's .git. These flags make sure nothing they
// left in its hooks or fsmonitor config runs with the factory's rights.
const SAFE = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'advice.graftFileDeprecated=false'];
// Replace refs and a grafts file make git read other commits than the real ones,
// which can hide what a branch changes. The factory's git ignores both.
const SAFE_ENV = { GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: '/dev/null' };

// The confined upload-pack's command line is long and says nothing useful in an error.
// Nor do git's hint lines, which some git versions print whatever the advice settings say.
const unhinted = (text) => text.split('\n').filter((l) => !l.startsWith('hint:')).join('\n');
const failed = (args, r) => new Error(`git ${args.map((a) => (a.startsWith("'bwrap'") ? '(confined)' : a)).join(' ')} failed: ${unhinted(r.stderr || r.stdout).trim().slice(0, 1000)}`);

// The factory's own clone of the target, next to the agents' clone. Only it talks to GitHub (fetch, ls-remote,
// push), with your credentials. No agent can write it, so its config is the one git made when it cloned.
const upstreamOf = (root) => join(root, 'upstream.git');
// The run folder of a clone (<root>/repo) or one of its worktrees (<root>/worktrees/<name>).
const rootOf = (dir) => (basename(dirname(dir)) === 'worktrees' ? dirname(dirname(dir)) : dirname(dir));

// Git in a repo only the factory writes: its own clone, a scratch repo.
async function ownGit(dir, args, { allowFail = false } = {}) {
  const r = await run('git', ['-C', dir, ...SAFE, ...args], { env: SAFE_ENV, timeoutMs: 300_000 });
  if (r.code !== 0 && !allowFail) throw failed(args, r);
  return r;
}

// What the factory's confined git sees of its environment: no tokens, no sockets. Its own list, apart from the
// agents' and the checks' (docs/adr/0005-the-factorys-git-runs-confined.md).
const GIT_PASSED_ON = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ'];
const gitEnv = async () => ({ ...pick(process.env, GIT_PASSED_ON), ...SAFE_ENV, ...(await gitIdentityEnv()) });

// Agents can write the clone's git data, and the config check before each command leaves a short window,
// so git in the clone and its worktrees may run whatever that config says. It runs confined: no network,
// home folder and /run hidden, writes only to dir, the clone's git data and `write`.
async function git(dir, args, { allowFail = false, write = [] } = {}) {
  const root = rootOf(dir);
  const box = bwrapArgs({ dir, network: false, read: [upstreamOf(root)], write: [join(root, 'repo', '.git'), ...write], env: await gitEnv() });
  const r = await run('bwrap', [...box, '--', 'git', '-C', dir, ...SAFE, ...args], { timeoutMs: 300_000 });
  if (r.code !== 0 && !allowFail) throw failed(args, r);
  return r;
}

// Runs share both clones, and two fetches at once fight over their ref locks: one at a time.
// ponytail: one queue for the whole process; per clone if one process ever serves several targets.
let fetchQueue = Promise.resolve();
function queued(fn) {
  const r = fetchQueue.then(fn);
  fetchQueue = r.catch(() => {});
  return r;
}

// The base and every branch, from GitHub into the factory's clone, then from there into the agents' clone.
const fetchAll = (root) => queued(async () => {
  await ownGit(upstreamOf(root), ['fetch', '-q', '--prune', 'origin', '+refs/heads/*:refs/heads/*']);
  await git(join(root, 'repo'), ['fetch', '-q', '--prune', upstreamOf(root), '+refs/heads/*:refs/remotes/origin/*']);
});

// One commit, the same way. A commit's name is its content's hash, so the one that arrives is the right one.
const fetchCommit = (root, sha) => queued(async () => {
  await ownGit(upstreamOf(root), ['fetch', '-q', 'origin', sha]);
  await git(join(root, 'repo'), ['fetch', '-q', upstreamOf(root), sha]);
});

// The factory's clone takes a checked commit from the agents' clone. git serves it with upload-pack, which reads
// the agents' clone's config, so upload-pack runs confined. git appends the clone's path to this command.
async function confinedUploadPack(root) {
  const box = bwrapArgs({ dir: join(root, 'repo'), network: false, env: await gitEnv() });
  const quote = (a) => `'${String(a).replaceAll("'", "'\\''")}'`;
  return ['bwrap', ...box, '--', 'git', ...SAFE, '-c', 'uploadpack.allowAnySHA1InWant=true', 'upload-pack'].map(quote).join(' ');
}

export function paths(root, n) {
  return {
    clone: join(root, 'repo'),
    worktree: join(root, 'worktrees', worktreeFor(n)),
    logs: join(root, 'logs', worktreeFor(n)),
    branch: branchFor(n),
  };
}

// A clone that does not exist yet has no config an agent changed, so it is made unconfined.
async function cloneInto(remoteUrl, dir, flags = []) {
  mkdirSync(dirname(dir), { recursive: true });
  const r = await run('git', [...SAFE, 'clone', '-q', ...flags, remoteUrl, dir], { env: SAFE_ENV, timeoutMs: 600_000 });
  if (r.code !== 0) throw new Error(`git clone failed: ${r.stderr.trim().slice(0, 1000)}`);
}

export async function ensureClone(root, remoteUrl) {
  const clone = join(root, 'repo');
  const fresh = !existsSync(join(clone, '.git'));
  if (!existsSync(join(upstreamOf(root), 'HEAD'))) await cloneInto(remoteUrl, upstreamOf(root), ['--bare']);
  if (fresh) await cloneInto(remoteUrl, clone);
  else await fetchAll(root);
}

// Every file on the remote base branch, and every folder with a trailing slash.
export async function pathsOnBase(clone, baseBranch) {
  const files = (await git(clone, ['ls-tree', '-r', '--name-only', `origin/${baseBranch}`])).stdout.split('\n').filter(Boolean);
  const out = new Set(files);
  for (const f of files) for (let i = f.indexOf('/'); i !== -1; i = f.indexOf('/', i + 1)) out.add(f.slice(0, i + 1));
  return out;
}

// Which of `list` the base branch's top .gitignore ignores; a folder counts when the files in it are.
// git judges it in an empty scratch repo, so the clone's stale checkout and its .git/info/exclude play no part.
// ponytail: only the top .gitignore; read nested ones too if a target ever relies on them.
export async function ignoredOnBase(clone, baseBranch, list) {
  const r = await git(clone, ['show', `origin/${baseBranch}:.gitignore`], { allowFail: true });
  if (r.code !== 0 || !list.length) return new Set();
  const scratch = mkdtempSync(join(tmpdir(), 'factory-ignore-'));
  try {
    await ownGit(scratch, ['init', '-q']);
    writeFileSync(join(scratch, '.gitignore'), r.stdout);
    const probe = (p) => (p.endsWith('/') ? `${p}x` : p);
    const out = await ownGit(scratch, ['-c', 'core.excludesFile=/dev/null', 'check-ignore', '--no-index', '--', ...list.map(probe)], { allowFail: true });
    const hits = new Set(out.stdout.split('\n').filter(Boolean));
    return new Set(list.filter((p) => hits.has(probe(p))));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

export async function hasRemoteBranch(clone, baseBranch) {
  return (await git(clone, ['rev-parse', '-q', '--verify', `refs/remotes/origin/${baseBranch}`], { allowFail: true })).code === 0;
}

export async function ensureWorktree(root, n, baseBranch) {
  const p = paths(root, n);
  // The sandbox also guards the clone's .git/config through a placeholder lock.
  const lock = join(p.clone, '.git', 'config.lock');
  if (isPlaceholder(lock)) rmSync(lock);
  await fetchAll(root);
  if (existsSync(p.worktree)) { await checkGitLink(root, n); await removeSandboxLeftovers(p.worktree); return { dir: p.worktree, created: false }; }
  mkdirSync(join(root, 'worktrees'), { recursive: true });
  const worktrees = { write: [join(root, 'worktrees')] };
  // One at a time: a prune while another run's add is half done removes that worktree's git data.
  await queued(async () => {
    await git(p.clone, ['worktree', 'prune'], worktrees);
    const remote = await git(p.clone, ['rev-parse', '-q', '--verify', `refs/remotes/origin/${p.branch}`], { allowFail: true });
    const start = remote.code === 0 ? `origin/${p.branch}` : `origin/${baseBranch}`;
    await git(p.clone, ['worktree', 'add', '-q', '-B', p.branch, p.worktree, start], worktrees);
  });
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
  return { sha: (await git(dir, ['log', '-1', '--format=%H'])).stdout.trim() };
}

// The base commit as GitHub has it right now, asked through the factory's own clone. The agents' clone's
// origin ref is no good for this: agents commit into the same git data and can move it.
async function remoteBase(dir, baseBranch) {
  const ref = `refs/heads/${baseBranch}`;
  const out = (await ownGit(upstreamOf(rootOf(dir)), ['ls-remote', 'origin', ref])).stdout;
  const sha = out.split('\n').map((l) => l.split('\t')).find(([, r]) => r === ref)?.[0];
  if (!/^[0-9a-f]{40,64}$/.test(sha ?? '')) throw new Error(`the remote has no branch ${baseBranch}`);
  // A commit's name is its content's hash, so one already here is the right one.
  if ((await git(dir, ['cat-file', '-e', `${sha}^{commit}`], { allowFail: true })).code !== 0)
    await fetchCommit(rootOf(dir), sha);
  return sha;
}

// The branch judged against one base commit, asked for once: every read of the view uses the same `sha`.
// The brakes need the remote base. `local` reads the clone's ref instead, for notes that decide nothing
// and must not reach the network.
export async function againstBase(dir, baseBranch, { local = false } = {}) {
  const sha = local
    ? (await git(dir, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${baseBranch}^{commit}`])).stdout.trim()
    : await remoteBase(dir, baseBranch);
  // With `since` (a commit), only what changed after it.
  const range = (since) => (since ? `${since}..HEAD` : `${sha}...HEAD`);
  return {
    sha,
    async changes(since = null) {
      const out = (await git(dir, ['diff', '--name-status', '-M', range(since)])).stdout;
      return out.split('\n').filter(Boolean).map((line) => {
        const [code, a, b] = line.split('\t');
        const status = code[0];
        return status === 'R' || status === 'C'
          ? { status: status === 'C' ? 'A' : 'R', ...(status === 'R' ? { oldPath: a } : {}), path: b }
          : { status, path: a };
      });
    },
    // paths: one path or a list.
    async diff(paths, since = null) {
      return (await git(dir, ['diff', range(since), '--', ...[paths].flat()])).stdout;
    },
    async messages() {
      const out = (await git(dir, ['log', '--format=%B%x00', `${sha}..HEAD`])).stdout;
      return out.split('\0').map((m) => m.trim()).filter(Boolean);
    },
  };
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

// Merges the base branch, as GitHub has it, into the worktree's branch: not the clone's
// origin ref, which agents can move. A merge left half-done by an earlier attempt is continued, not restarted.
export async function mergeBase(dir, baseBranch) {
  if (await mergeInProgress(dir)) return 'conflict';
  await fetchAll(rootOf(dir));
  const sha = await remoteBase(dir, baseBranch);
  const r = await git(dir, ['merge', '--no-edit', '-m', `Merge ${baseBranch} (${sha.slice(0, 12)})`, sha], { allowFail: true });
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
// whatever the branch ref has been moved to since. The push goes out from the
// factory's own clone: nothing an agent wrote into the clone's config takes part.
export async function push(dir, branch, sha) {
  const root = rootOf(dir), upstream = upstreamOf(root);
  await queued(async () => ownGit(upstream, ['fetch', '-q', '--upload-pack', await confinedUploadPack(root), join(root, 'repo'), sha]));
  await ownGit(upstream, ['push', '-q', 'origin', `${sha}:refs/heads/${branch}`]);
}

async function currentBranch(dir) {
  const r = await git(dir, ['symbolic-ref', '-q', '--short', 'HEAD'], { allowFail: true });
  return r.code === 0 ? r.stdout.trim() : null;
}

// What a push needs first. An agent may detach HEAD and commit on top of its branch; that work is
// still the branch's, so the branch is put at HEAD and checked out (`reattached`). The sessions may
// have left sandbox leftovers; they are not the agent's work. Returns { sha, reattached }: `sha` is
// what the brakes and checks look at and what gets pushed. Or { refused, branch }: 'not-on-branch'
// or 'uncommitted', with the branch HEAD is on (null when detached).
export async function preparePush(dir, branch) {
  let on = await currentBranch(dir), reattached = false;
  if (on === null) {
    const ahead = await git(dir, ['merge-base', '--is-ancestor', `refs/heads/${branch}`, 'HEAD'], { allowFail: true });
    if (ahead.code === 0) {
      await git(dir, ['checkout', '-q', '-B', branch, 'HEAD']);
      on = await currentBranch(dir);
      reattached = true;
    }
  }
  if (on !== branch) return { refused: 'not-on-branch', branch: on };
  const { sha } = await headInfo(dir);
  await removeSandboxLeftovers(dir);
  if (!(await isClean(dir))) return { refused: 'uncommitted', branch: on };
  return { sha, reattached };
}

// The branch's new and changed tests against the code without the change: every other file the branch changed
// is put back as it is at the base commit `sha` (files the branch added go), then `run(tests)` gets the test files
// and the branch is restored. What the checks left in the tree before it is removed first. Returns what run returns, or null when the branch adds or changes no test.
// Throws when the branch cannot be restored to the same HEAD and a clean tree.
export async function testsOnBase(dir, sha, testDirs, run) {
  const branch = await currentBranch(dir), { sha: head } = await headInfo(dir);
  // preparePush found the tree clean; what is left now the checks wrote (a coverage report, a results file).
  await git(dir, ['reset', '-q', '--hard']);
  await git(dir, ['clean', '-q', '-f', '-d']);
  const lit = ['--literal-pathspecs'];
  const out = (await git(dir, ['diff', '--name-status', '--no-renames', '-z', `${sha}...HEAD`])).stdout.split('\0').filter(Boolean);
  const changes = [];
  for (let i = 0; i + 1 < out.length; i += 2) changes.push({ status: out[i], path: out[i + 1] });
  const isTest = (p) => testDirs.some((d) => p.startsWith(d));
  const tests = changes.filter((c) => c.status !== 'D' && isTest(c.path)).map((c) => c.path);
  if (!tests.length) return null;
  const others = changes.filter((c) => !isTest(c.path)).map((c) => c.path);
  let result, failure = null;
  try {
    if (others.length) {
      const atBase = new Set((await git(dir, [...lit, 'ls-tree', '-r', '-z', '--name-only', sha, '--', ...others])).stdout.split('\0').filter(Boolean));
      const back = others.filter((p) => atBase.has(p)), gone = others.filter((p) => !atBase.has(p));
      if (back.length) await git(dir, [...lit, 'checkout', '-q', sha, '--', ...back]);
      if (gone.length) await git(dir, [...lit, 'rm', '-q', '-f', '--ignore-unmatch', '--', ...gone]);
    }
    result = await run(tests);
  } catch (e) { failure = e; }
  // Restored whatever happened above; a branch that is not back as it was stops the run before anything else.
  await git(dir, ['reset', '-q', '--hard']);
  await git(dir, ['clean', '-q', '-f', '-d']);
  if ((await currentBranch(dir)) !== branch || (await headInfo(dir)).sha !== head || !(await isClean(dir)))
    throw new Error(`after its tests ran on the base, the worktree could not be put back: HEAD is not ${branch} at ${head.slice(0, 12)} with a clean tree`);
  if (failure) throw failure;
  return result;
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
  const worktrees = { write: [join(root, 'worktrees')] };
  if (existsSync(p.worktree)) await git(p.clone, ['worktree', 'remove', '--force', p.worktree], worktrees);
  await git(p.clone, ['worktree', 'prune'], worktrees);
  await git(p.clone, ['branch', '-D', p.branch], { allowFail: true });
}

export async function listWorktrees(root) {
  const dir = join(root, 'worktrees');
  if (!existsSync(dir)) return [];
  // issue-0 is a smoke run's worktree, not a GitHub issue: the loop must not look it up or remove it
  return readdirSync(dir).map(issueOfWorktree).filter((n) => n !== null && n !== 0);
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
    ignoredOnBase: async (list) => { await checkClone(); return ignoredOnBase(clone, base, list); },
    ensureWorktree: async (n) => { await checkClone(); return ensureWorktree(root, n, base); },
    removeWorktree: async (n) => {
      await checkClone();
      if (existsSync(paths(root, n).worktree)) await checkGitLink(root, n);
      return removeWorktree(root, n);
    },
    listWorktrees: async () => listWorktrees(root), // reads a folder, runs no git
    headInfo: inWorktree(headInfo),
    // Each read of the view checks again: an agent's session may come between asking and reading.
    againstBase: inWorktree(async (dir, opts = {}) => {
      const view = await againstBase(dir, base, opts);
      const checked = (fn) => inWorktree((d, ...args) => fn(...args)).bind(null, dir);
      return { sha: view.sha, changes: checked(view.changes), diff: checked(view.diff), messages: checked(view.messages) };
    }),
    isClean: inWorktree(isClean),
    mergeBase: inWorktree((dir) => mergeBase(dir, base)),
    abortMerge: inWorktree(abortMerge),
    mergeResolved: inWorktree(mergeResolved),
    push: inWorktree(push),
    preparePush: inWorktree(preparePush),
    testsOnBase: inWorktree(testsOnBase),
  };
}
