import { existsSync, readdirSync, mkdirSync, statSync, rmSync, rmdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { run } from './exec.mjs';

// Agents can write to the clone's .git. These flags make sure nothing they
// left in its hooks or fsmonitor config runs with the factory's rights.
const SAFE = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'];

async function git(dir, args, { allowFail = false } = {}) {
  const r = await run('git', ['-C', dir, ...SAFE, ...args], { timeoutMs: 300_000 });
  if (r.code !== 0 && !allowFail)
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim().slice(0, 1000)}`);
  return r;
}

export function paths(root, n) {
  return {
    clone: join(root, 'repo'),
    worktree: join(root, 'worktrees', `issue-${n}`),
    logs: join(root, 'logs', `issue-${n}`),
    branch: `factory/issue-${n}`,
  };
}

export async function ensureClone(root, remoteUrl) {
  const clone = join(root, 'repo');
  if (!existsSync(join(clone, '.git'))) {
    mkdirSync(root, { recursive: true });
    const r = await run('git', [...SAFE, 'clone', '-q', remoteUrl, clone], { timeoutMs: 600_000 });
    if (r.code !== 0) throw new Error(`git clone failed: ${r.stderr.trim().slice(0, 1000)}`);
  } else {
    await git(clone, ['fetch', '-q', '--prune', 'origin']);
  }
}

export async function ensureWorktree(root, n, baseBranch) {
  const p = paths(root, n);
  // The sandbox also guards the clone's .git/config through a placeholder lock.
  const lock = join(p.clone, '.git', 'config.lock');
  if (isPlaceholder(lock)) rmSync(lock);
  await git(p.clone, ['fetch', '-q', '--prune', 'origin']);
  if (existsSync(p.worktree)) { await removeSandboxLeftovers(p.worktree); return { dir: p.worktree, created: false }; }
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

// The Claude sandbox mounts over dotfiles (.bashrc, .gitconfig, .claude/…) through
// empty read-only placeholders and removes them on exit. A killed session leaves
// them behind; they would park the run as uncommitted changes or end up in a commit.
async function removeSandboxLeftovers(dir) {
  const files = (await git(dir, ['ls-files', '-o', '--exclude-standard', '-z'])).stdout.split('\0').filter(Boolean);
  const dirs = new Set([join(dir, '.claude', '.cc-writes'), join(dir, '.claude')]);
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

export async function changesAgainstBase(dir, baseBranch) {
  const out = (await git(dir, ['diff', '--name-status', '-M', `origin/${baseBranch}...HEAD`])).stdout;
  return out.split('\n').filter(Boolean).map((line) => {
    const [code, a, b] = line.split('\t');
    const status = code[0];
    return status === 'R' || status === 'C'
      ? { status: status === 'C' ? 'A' : 'R', ...(status === 'R' ? { oldPath: a } : {}), path: b }
      : { status, path: a };
  });
}

export async function commitMessagesAgainstBase(dir, baseBranch) {
  const out = (await git(dir, ['log', '--format=%B%x00', `origin/${baseBranch}..HEAD`])).stdout;
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
  await git(dir, ['fetch', '-q', 'origin']);
  const r = await git(dir, ['merge', '--no-edit', `origin/${baseBranch}`], { allowFail: true });
  if (r.code === 0) return 'clean';
  if (await mergeInProgress(dir)) return 'conflict';
  throw new Error(`git merge failed: ${(r.stderr || r.stdout).trim().slice(0, 1000)}`);
}

export async function mergeResolved(dir) {
  return !(await mergeInProgress(dir)) && !(await unmerged(dir));
}

// Never forces: a rewritten branch is a reason to stop, not to overwrite.
export async function push(dir, branch) {
  await git(dir, ['push', '-q', '-u', 'origin', branch]);
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
  return readdirSync(dir).map((d) => /^issue-(\d+)$/.exec(d)).filter(Boolean).map((m) => Number(m[1]));
}
