import { run } from './exec.mjs';

const STEPS = [['npm', ['ci']], ['npm', ['test']], ['npm', ['run', 'e2e']]];

// The factory's own check run — never the agent's word for it.
// ponytail: this runs agent-written code outside the sandbox, as the user.
// The approval rule and the protected-path list are the guards; run it under bwrap if that stops being enough.
export async function runChecks(dir, cfg, port) {
  for (const [cmd, args] of STEPS) {
    const r = await run(cmd, args, { cwd: dir, env: { E2E_PORT: String(port), CI: '1' }, timeoutMs: cfg.checkTimeoutMin * 60_000 });
    if (r.code !== 0) {
      const note = r.timedOut ? `\n(timed out after ${cfg.checkTimeoutMin} min)` : '';
      return { ok: false, failed: `${cmd} ${args.join(' ')}`, output: (r.stdout + r.stderr).slice(-4000) + note };
    }
  }
  return { ok: true, failed: null, output: '' };
}
