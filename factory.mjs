#!/usr/bin/env node
// Start: npm start    Stop: Ctrl-C (finish running work), Ctrl-C again (kill now).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as cfg } from './config.mjs';
import { run, children, killGroup } from './lib/exec.mjs';
import * as gh from './lib/github.mjs';
import * as ws from './lib/workspace.mjs';
import { runAgent } from './lib/agent.mjs';
import { runChecks } from './lib/checks.mjs';
import { runItem } from './lib/stages.mjs';
import { recover, tick, cleanup, acquireLock, preflight } from './lib/loop.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const log = (msg) => console.log(`${new Date().toTimeString().slice(0, 8)}  ${msg}`);
const deps = { cfg, root, log, gh, ws, run, runAgent, runChecks, runItem };

let release;
try { release = acquireLock(join(root, 'factory.lock')); } catch (e) { console.error(e.message); process.exit(1); }

const running = new Map();
let stopping = false, wake = () => {};
const sleep = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); wake = () => { clearTimeout(t); resolve(); }; });

process.on('SIGINT', () => {
  if (stopping) {
    log('killing running agents');
    for (const child of children) killGroup(child);
    release();
    process.exit(130);
  }
  stopping = true;
  log(running.size ? `finishing ${running.size} running — Ctrl-C again to kill` : 'stopping');
  wake();
});
process.on('SIGTERM', () => process.emit('SIGINT'));

try {
  await preflight(deps);
  await ws.ensureClone(root, `https://github.com/${cfg.repo}.git`);
  await recover(deps);
  log(`factory started for ${cfg.repo} — polling every ${cfg.pollSec}s, up to ${cfg.maxParallel} at a time`);
  while (!stopping) {
    await cleanup(deps, running);
    const started = await tick(deps, running);
    if (!started.length && !running.size) log('0 eligible');
    await sleep(cfg.pollSec * 1000);
  }
  await Promise.all(running.values());
  log('stopped');
} catch (e) {
  console.error(`factory cannot run: ${e.message}`);
  process.exitCode = 1;
} finally {
  release();
}
