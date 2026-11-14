// Proves an agent can run the app's end-to-end suite INSIDE the sandbox.
// Run: node smoke/e2e.mjs [playwright.config.js to overlay, until the app's own is pushed]
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../lib/exec.mjs';
import { runAgent } from '../lib/agent.mjs';
import * as ws from '../lib/workspace.mjs';
import { config } from '../config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const N = 0; // issue-0 is reserved for smoke runs
let ok = false;
try {
  await ws.ensureClone(root, `https://github.com/${config.repo}.git`);
  await ws.removeWorktree(root, N);
  const { dir } = await ws.ensureWorktree(root, N, config.baseBranch);
  if (process.argv[2]) copyFileSync(process.argv[2], join(dir, 'playwright.config.js'));
  const ci = await run('npm', ['ci'], { cwd: dir, timeoutMs: 300_000 });
  if (ci.code !== 0) throw new Error(`npm ci failed: ${ci.stderr.slice(-500)}`);
  console.log('running npm run e2e inside the agent sandbox…');
  const res = await runAgent({
    cwd: dir, cfg: { ...config, maxTurns: 15, sessionTimeoutMin: 10 }, logFile: join(root, 'logs', 'issue-0', 'e2e-smoke.json'),
    prompt: 'Run the bash command `npm run e2e` exactly once, with a 5 minute timeout. Do not retry and do not change any file. Report its exit code and the last 600 characters of its output.',
    schema: { type: 'object', required: ['exit', 'tail'], properties: { exit: { type: 'integer' }, tail: { type: 'string' } } },
  });
  if (!res.ok) throw new Error(res.reason);
  console.log(res.output.tail);
  ok = res.output.exit === 0 && /\d+ passed/.test(res.output.tail);
  console.log(ok ? 'PASS  the e2e suite runs inside the sandbox' : `FAIL  exit ${res.output.exit}`);
} catch (e) {
  console.log(`FAIL  ${e.message}`);
} finally {
  await ws.removeWorktree(root, N).catch(() => {});
}
process.exit(ok ? 0 : 1);
