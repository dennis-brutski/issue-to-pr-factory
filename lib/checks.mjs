import { runConfined } from './confine.mjs';

// Runs commands in order, confined; the first failure stops with its output.
async function runSteps(steps, dir, cfg, port, gitDir, { network, write }) {
  for (const [cmd, args] of steps) {
    const r = await runConfined(cmd, args, { dir, gitDir, cfg, port, network, write, timeoutMs: cfg.checkTimeoutMin * 60_000 });
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
export const runChecks = (dir, cfg, port, gitDir) => runSteps(cfg.checks ?? [], dir, cfg, port, gitDir, { network: false, write: [] });
