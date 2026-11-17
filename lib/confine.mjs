// The factory's own setup and check runs execute code from a branch nobody has
// reviewed yet, so they run under bwrap like the agents: the system read-only,
// the home folder hidden, writes only to the worktree (and, for setup, the
// target's caches), and checks without network.
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run } from './exec.mjs';

export const expandHome = (p, home = homedir()) => (p === '~' ? home : p.startsWith('~/') ? join(home, p.slice(2)) : p);

export function targetEnv(cfg, port) {
  const env = { CI: '1' };
  for (const [k, v] of Object.entries(cfg.env ?? {})) env[k] = String(v).replaceAll('{port}', String(port));
  return env;
}

// The home folder is hidden, so git cannot read ~/.gitconfig: commits made by
// agents and by tests get the user's identity through the environment instead.
let identity;
export async function gitIdentityEnv() {
  if (!identity) {
    const get = async (k) => (await run('git', ['config', '--global', k])).stdout.trim();
    const [name, email] = [await get('user.name'), await get('user.email')];
    identity = { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
  }
  return identity;
}

export function bwrapArgs({ dir, gitDir, home = homedir(), network, read = [], write = [] }) {
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp', '--tmpfs', home];
  for (const p of read.map((r) => expandHome(r, home))) if (existsSync(p)) args.push('--ro-bind', p, p);
  if (gitDir) args.push('--ro-bind', gitDir, gitDir); // a worktree's git data lives in the clone
  args.push('--bind', dir, dir);
  for (const p of write.map((w) => expandHome(w, home))) { mkdirSync(p, { recursive: true }); args.push('--bind', p, p); }
  if (!network) args.push('--unshare-net');
  args.push('--die-with-parent', '--chdir', dir);
  return args;
}

export async function runConfined(cmd, args, { dir, gitDir, cfg, port, network, write = [], timeoutMs }) {
  const read = [...(cfg.runtimeRead ?? []), ...(cfg.sandboxRead ?? [])];
  const env = { ...(await gitIdentityEnv()), ...targetEnv(cfg, port) };
  return run('bwrap', [...bwrapArgs({ dir, gitDir, network, read, write }), '--', cmd, ...args], { cwd: dir, env, timeoutMs });
}
