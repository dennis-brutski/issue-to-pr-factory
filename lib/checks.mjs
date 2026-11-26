import { resolve, sep } from 'node:path';
import { runConfined, expandHome } from './confine.mjs';

// Runs commands in order, confined; the first failure stops with its output.
async function runSteps(steps, dir, cfg, port, gitDir, { network, read = [], write }) {
  for (const [cmd, args] of steps) {
    const r = await runConfined(cmd, args, { dir, gitDir, cfg, port, network, read, write, timeoutMs: cfg.checkTimeoutMin * 60_000 });
    if (r.code !== 0) {
      const note = r.timedOut ? `\n(timed out after ${cfg.checkTimeoutMin} min)` : '';
      return { ok: false, failed: [cmd, ...args].join(' '), output: (r.stdout + r.stderr).slice(-4000) + note };
    }
  }
  return { ok: true, failed: null, output: '' };
}

// Before the first agent session: with network (dependencies download), home hidden.
export const runSetup = (dir, cfg, port, gitDir) => runSteps(cfg.setup ?? [], dir, cfg, port, gitDir, { network: true, write: cfg.setupWrite ?? [] });

// The factory's own check run — never the agent's word for it. No network.
// Then the held-out checks: tests kept outside the run folder, which agents cannot
// read, so a change cannot be tuned to them. '{heldOut}' in their args is that folder.
export async function runChecks(dir, cfg, port, gitDir) {
  const r = await runSteps(cfg.checks ?? [], dir, cfg, port, gitDir, { network: false, write: [] });
  if (!r.ok || !cfg.heldOutChecks?.length) return r;
  const held = resolve(expandHome(cfg.heldOutDir ?? ''));
  if (!cfg.heldOutDir || (cfg.runDir && (held + sep).startsWith(resolve(cfg.runDir) + sep)))
    return { ok: false, failed: 'held-out checks', output: 'heldOutDir must be set and lie outside the run folder, which agents can read (it is inside the run folder or missing).' };
  const steps = cfg.heldOutChecks.map(([cmd, args]) => [cmd, args.map((a) => String(a).replaceAll('{heldOut}', held))]);
  return { ...(await runSteps(steps, dir, cfg, port, gitDir, { network: false, read: [held], write: [] })), heldOut: true };
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
