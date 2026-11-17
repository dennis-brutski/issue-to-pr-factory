// Proves a target's checks work where they run: once inside the agents' sandbox
// (one real agent session, uses Claude usage) and once confined by the factory.
// Run: npm run smoke:checks -- <target>
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSettings, cloneUrl } from '../lib/settings.mjs';
import { runAgent } from '../lib/agent.mjs';
import { runSetup, runChecks } from '../lib/checks.mjs';
import * as ws from '../lib/workspace.mjs';

const factoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const N = 0; // issue-0 is reserved for smoke runs
const cmd = ([c, a]) => [c, ...a].join(' ');
let ok = true;
const report = (pass, what) => { ok &&= pass; console.log(`${pass ? 'PASS' : 'FAIL'}  ${what}`); };

const cfg = await loadSettings(process.argv[2], { factoryRoot });
const root = cfg.runDir, gitDir = join(root, 'repo', '.git');
try {
  await ws.ensureClone(root, cloneUrl(cfg));
  await ws.removeWorktree(root, N);
  const { dir } = await ws.ensureWorktree(root, N, cfg.baseBranch);
  const setup = await runSetup(dir, cfg, 4990, gitDir);
  report(setup.ok, `setup (confined) ${setup.ok ? '' : `\`${setup.failed}\`\n${setup.output.slice(-600)}`}`);
  if (!setup.ok) throw new Error('setup failed');

  console.log(`running the checks inside the agent sandbox for ${cfg.target}…`);
  const res = await runAgent({
    cwd: dir, cfg: { ...cfg, maxTurns: 20, sessionTimeoutMin: 15 }, port: 4991, logFile: join(root, 'logs', `issue-${N}`, 'checks-smoke.json'),
    prompt: `Run each of these bash commands exactly once, in order, each with a 10 minute timeout. Do not retry, do not change any file.\n${cfg.checks.map((c) => `- \`${cmd(c)}\``).join('\n')}\nReport each command with its exit code and the last 300 characters of its output.`,
    schema: { type: 'object', required: ['results'], properties: { results: { type: 'array', items: { type: 'object', required: ['command', 'exit', 'tail'], properties: { command: { type: 'string' }, exit: { type: 'integer' }, tail: { type: 'string' } } } } } },
  });
  if (!res.ok) report(false, `agent session: ${res.reason}`);
  else for (const c of cfg.checks) {
    const r = res.output.results.find((x) => x.command.trim() === cmd(c));
    report(r?.exit === 0, `${cmd(c)} inside the agent sandbox${r && r.exit !== 0 ? ` (exit ${r.exit})\n${r.tail}` : r ? '' : ' (not reported)'}`);
  }

  const checks = await runChecks(dir, cfg, 4992, gitDir);
  report(checks.ok, `checks confined by the factory${checks.ok ? '' : `: \`${checks.failed}\`\n${checks.output.slice(-600)}`}`);
} catch (e) {
  report(false, e.message);
} finally {
  await ws.removeWorktree(root, N).catch(() => {});
}
process.exit(ok ? 0 : 1);
