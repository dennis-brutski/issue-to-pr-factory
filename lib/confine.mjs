// The factory's own setup and check runs execute code from a branch nobody has
// reviewed yet, so they run under bwrap like the agents: the system read-only,
// the home folder hidden, writes only to the worktree (and, for setup, the
// target's caches), and checks without network. Setup with setupHosts gets no network
// either, only the factory's proxy, through a bridge inside the sandbox (ADR 0008).
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './exec.mjs';
/** @import { Config } from './settings.mjs' */

export const expandHome = (p, home = homedir()) => (p === '~' ? home : p.startsWith('~/') ? join(home, p.slice(2)) : p);

// '{port}' becomes the run's port, '{runDir}' the target's run folder.
/** @type {(v: unknown, cfg: Partial<Pick<Config, 'runDir'>>, port: number) => string} */
const fill = (v, cfg, port) => String(v).replaceAll('{port}', String(port)).replaceAll('{runDir}', cfg.runDir ?? '');

/**
 * @param {Partial<Pick<Config, 'env' | 'runDir'>>} cfg
 * @param {number} port
 */
export function targetEnv(cfg, port) {
  const env = { CI: '1' };
  for (const [k, v] of Object.entries(cfg.env ?? {})) env[k] = fill(v, cfg, port);
  return env;
}

// The home folder is hidden, so git cannot read ~/.gitconfig: commits made by
// agents and by tests get the user's identity through the environment instead.
// Where the home folder is hidden from the factory itself (its tests, run by an
// agent), the identity the outer factory passed in is used.
let identity;
export async function gitIdentityEnv() {
  if (!identity) {
    const get = async (k, envKey) => (await run('git', ['config', '--global', k])).stdout.trim() || process.env[envKey] || '';
    const [name, email] = [await get('user.name', 'GIT_AUTHOR_NAME'), await get('user.email', 'GIT_AUTHOR_EMAIL')];
    identity = { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
  }
  return identity;
}

// /run holds the user's session sockets (ssh-agent, D-Bus with the keyring,
// systemd --user, which can start processes outside any sandbox), so it is hidden.
// Setup keeps the resolver's folder there, which /etc/resolv.conf may point into.
const RESOLVER = '/run/systemd/resolve';

// Inside the sandbox the bridge listens on this port; the sandbox has its own network, so it is free.
export const PROXY_PORT = 3128;
export const BRIDGE = fileURLToPath(new URL('./proxy-bridge.mjs', import.meta.url));
const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`;
// Set by the factory, after the target's env: never passed on from the factory's own environment (ADR 0001).
const PROXY_ENV = { HTTPS_PROXY: PROXY_URL, https_proxy: PROXY_URL, HTTP_PROXY: PROXY_URL, http_proxy: PROXY_URL, npm_config_proxy: PROXY_URL, NODE_USE_ENV_PROXY: '1' };

/**
 * The bwrap arguments for one confined run.
 * @param {{ dir: string, gitDir?: string, home?: string, network: boolean, proxy?: string | null, read?: string[], write?: string[], env?: Record<string, string> }} opts
 *   proxy: the folder with the factory's proxy socket. Set, the run gets no network, that folder and the bridge read-only, and the proxy env.
 * @returns {string[]}
 */
export function bwrapArgs({ dir, gitDir, home = homedir(), network, proxy = null, read = [], write = [], env = {} }) {
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/run', '--tmpfs', '/tmp', '--tmpfs', home];
  if (network && existsSync(RESOLVER)) args.push('--ro-bind', RESOLVER, RESOLVER);
  for (const p of read.map((r) => expandHome(r, home))) if (existsSync(p)) args.push('--ro-bind', p, p);
  if (gitDir) args.push('--ro-bind', gitDir, gitDir); // a worktree's git data lives in the clone
  args.push('--bind', dir, dir);
  // The worktree's .git file says where its git data is; it must keep pointing into the clone.
  if (existsSync(join(dir, '.git'))) args.push('--ro-bind', join(dir, '.git'), join(dir, '.git'));
  for (const p of write.map((w) => expandHome(w, home))) { mkdirSync(p, { recursive: true }); args.push('--bind', p, p); }
  if (proxy) args.push('--ro-bind', proxy, proxy, '--ro-bind', BRIDGE, BRIDGE, '--ro-bind', process.execPath, process.execPath);
  if (!network || proxy) args.push('--unshare-net');
  // Own process tree (nothing outlives the run), no terminal, only the given environment.
  args.push('--unshare-pid', '--unshare-ipc', '--unshare-uts', '--new-session', '--die-with-parent', '--clearenv');
  for (const [k, v] of Object.entries(proxy ? { ...env, ...PROXY_ENV } : env)) args.push('--setenv', k, String(v));
  args.push('--chdir', dir);
  return args;
}

// The only variables a confined run sees from the factory's environment: no tokens, no sockets.
const PASSED_ON = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TERM', 'TZ'];
export const pick = (env, keys) => Object.fromEntries(keys.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));

/**
 * Runs one command under bwrap.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ dir: string, gitDir?: string, cfg: Config, port?: number, network: boolean, proxy?: string | null, read?: string[], write?: string[], timeoutMs?: number }} opts
 *   proxy: the folder with the factory's proxy socket; the command then runs behind the bridge, its only way out.
 * @returns {ReturnType<typeof run>}
 */
export async function runConfined(cmd, args, { dir, gitDir, cfg, port, network, proxy = null, read: extraRead = [], write = [], timeoutMs }) {
  const read = [...(cfg.runtimeRead ?? []), ...(cfg.sandboxRead ?? []), ...extraRead];
  const env = { ...pick(process.env, PASSED_ON), ...(await gitIdentityEnv()), ...targetEnv(cfg, port) };
  const bridge = proxy ? [process.execPath, BRIDGE, join(proxy, 'proxy.sock'), String(PROXY_PORT)] : [];
  return run('bwrap', [...bwrapArgs({ dir, gitDir, network, proxy, read, write: write.map((w) => fill(w, cfg, port)), env }), '--', ...bridge, cmd, ...args], { cwd: dir, timeoutMs });
}
