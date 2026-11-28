import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { runConfined, expandHome } from './confine.mjs';
import { startProxy } from './proxy.mjs';
import { inCopy as copyOf, copiesOf } from './workspace.mjs';

// Runs commands in order, confined; the first failure stops with its output.
async function runSteps(steps, dir, cfg, port, gitDir, { network, proxy = null, read = [], write, source = dir, confined = runConfined }) {
  for (const [cmd, args] of steps) {
    const r = await confined(cmd, args, { dir, source, gitDir, cfg, port, network, proxy, read, write, timeoutMs: cfg.checkTimeoutMin * 60_000 });
    if (r.code !== 0) {
      const note = r.timedOut ? `\n(timed out after ${cfg.checkTimeoutMin} min)` : '';
      return { ok: false, failed: [cmd, ...args].join(' '), output: (r.stdout + r.stderr).slice(-4000) + note };
    }
  }
  return { ok: true, failed: null, output: '' };
}

/**
 * Runs setup before the first agent session, confined, home hidden. With `cfg.setupHosts` a list,
 * setup has no network of its own: it reaches only those hosts, through the factory's proxy (ADR 0008).
 * With `setupHosts` null it has the host's full network.
 * @param {string} dir the worktree
 * @param {Partial<import('./settings.mjs').Config>} cfg
 * @param {number} port
 * @param {string} [gitDir]
 * @param {{ start?: (opts: { dir: string, hosts: string[] }) => Promise<{ socket: string, refused: () => import('./proxy.mjs').Refusal[], moreRefused: () => number,
 *   requests: () => number, close: () => Promise<void> }>,
 *   confined?: typeof runConfined }} [deps] for tests
 * @returns {Promise<{ ok: boolean, failed: string | null, output: string, refused?: import('./proxy.mjs').Refusal[], moreRefused?: number, requests?: number }>}
 *   refused, moreRefused and requests only through the proxy: the hosts it refused and why, how many refusals past those, and how many requests it saw.
 *   Starts the proxy in a temp folder and always stops it and removes the folder.
 */
export async function runSetup(dir, cfg, port, gitDir, { start = startProxy, confined = runConfined } = {}) {
  const steps = cfg.setup ?? [], write = cfg.setupWrite ?? [];
  if (!Array.isArray(cfg.setupHosts) || !steps.length) return runSteps(steps, dir, cfg, port, gitDir, { network: true, write, confined });
  // In the temp dir, not the run folder: a socket's path must stay short (about 100 bytes).
  const folder = mkdtempSync(join(tmpdir(), 'factory-proxy-'));
  try {
    const proxy = await start({ dir: folder, hosts: cfg.setupHosts });
    try {
      const r = await runSteps(steps, dir, cfg, port, gitDir, { network: false, proxy: proxy.socket, write, confined });
      return { ...r, refused: proxy.refused(), moreRefused: proxy.moreRefused(), requests: proxy.requests() };
    } finally { await proxy.close(); }
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

// The copy next to the run folder (ADR 0009); without a run folder there is nowhere safe to put it.
/** @param {string | undefined} runDir */
const copyNextTo = (runDir) => (/** @type {string} */ d, /** @type {(copy: string) => Promise<any>} */ fn) => {
  if (!runDir) throw new Error('held-out checks need a run folder: their copy sits next to it');
  return copyOf(d, fn, copiesOf(runDir));
};

/**
 * The factory's own check run — never the agent's word for it. No network. Then the held-out checks: tests kept
 * outside the run folder, which agents cannot read, so a change cannot be tuned to them. '{heldOut}' in their args
 * is that folder. They run in a throwaway copy of the worktree, bound at the worktree's path and deleted afterwards,
 * so nothing they write (the tests themselves included) stays where the next session can read it (ADR 0009).
 * @param {string} dir the worktree
 * @param {Partial<import('./settings.mjs').Config>} cfg
 * @param {number} port
 * @param {string} [gitDir]
 * @param {{ confined?: typeof runConfined, inCopy?: (dir: string, fn: (copy: string) => Promise<any>) => Promise<any> }} [deps] inCopy makes and removes
 *   the copy (next to cfg.runDir by default); the stages pass the workspace's checked one
 * @returns {Promise<{ ok: boolean, failed: string | null, output: string, heldOut?: boolean }>} heldOut: the held-out checks ran
 */
export async function runChecks(dir, cfg, port, gitDir, { confined = runConfined, inCopy = copyNextTo(cfg.runDir) } = {}) {
  const r = await runSteps(cfg.checks ?? [], dir, cfg, port, gitDir, { network: false, write: [], confined });
  if (!r.ok || !cfg.heldOutChecks?.length) return r;
  const held = resolve(expandHome(cfg.heldOutDir ?? ''));
  if (!cfg.heldOutDir || (cfg.runDir && (held + sep).startsWith(resolve(cfg.runDir) + sep)))
    return { ok: false, failed: 'held-out checks', output: 'heldOutDir must be set and lie outside the run folder, which agents can read (it is inside the run folder or missing).' };
  const steps = cfg.heldOutChecks.map(([cmd, args]) => [cmd, args.map((a) => String(a).replaceAll('{heldOut}', held))]);
  const out = await inCopy(dir, (copy) => runSteps(steps, dir, cfg, port, gitDir, { network: false, read: [held], write: [], source: copy, confined }));
  return { ...out, heldOut: true };
}

// The testFiles command on each file alone, confined, no network: '{files}' in its args is the file.
// Returns { passed, timedOut }: the files whose run passed, and the first run that timed out
// ({ failed, output }), after which nothing more runs. Any other failure is just not a pass.
export async function runTestFiles(dir, cfg, port, gitDir, files) {
  const passed = [];
  for (const file of files) {
    let ok = true;
    for (const [cmd, args] of cfg.testFiles ?? []) {
      const filled = args.map((a) => String(a).replaceAll('{files}', file));
      const r = await runConfined(cmd, filled, { dir, gitDir, cfg, port, network: false, timeoutMs: cfg.checkTimeoutMin * 60_000 });
      if (r.timedOut) return { passed, timedOut: { failed: [cmd, ...filled].join(' '), output: `${(r.stdout + r.stderr).slice(-4000)}\n(timed out after ${cfg.checkTimeoutMin} min)` } };
      if (r.code !== 0) { ok = false; break; }
    }
    if (ok) passed.push(file);
  }
  return { passed, timedOut: null };
}
