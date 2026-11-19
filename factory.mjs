#!/usr/bin/env node
// Start: npm start [-- <target>]    Stop: Ctrl-C (finish running work), Ctrl-C again (kill now).
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSettings, cloneUrl } from './lib/settings.mjs';
import { run, children, killGroup } from './lib/exec.mjs';
import * as gh from './lib/github.mjs';
import { workspace } from './lib/workspace.mjs';
import { runAgent } from './lib/agent.mjs';
import { runChecks, runSetup } from './lib/checks.mjs';
import { runItem } from './lib/stages.mjs';
import { recover, tick, cleanup, acquireLock, lockHolder, preflight } from './lib/loop.mjs';
import { driftWarnings, oldLayoutWarning, pollText } from './lib/startup.mjs';
import { look, paint } from './lib/look.mjs';
import { screen } from './lib/screen.mjs';

const cannotRun = (why) => { const msg = `factory cannot run: ${why}`; const { icon, tone } = look(msg); console.error(paint(`${icon} ${msg}`, tone, process.stderr)); };

const factoryRoot = dirname(fileURLToPath(import.meta.url));
let cfg;
try { cfg = await loadSettings(process.argv[2], { factoryRoot }); } catch (e) { cannotRun(e.message); process.exit(1); }
const root = cfg.runDir;
const ws = workspace({ root, url: cloneUrl(cfg), base: cfg.baseBranch }); // checks the clone before each git command
const show = screen({ repo: cfg.repo, columns: process.stdout.columns, stream: process.stdout, now: Date.now, pollSec: cfg.pollSec });
const log = (msg) => { const line = show(new Date().toTimeString().slice(0, 8), msg); if (line !== null) console.log(line); };
// Read once: which version of the factory built each pull request.
const head = await run('git', ['-C', factoryRoot, 'rev-parse', '--short', 'HEAD']);
const factoryCommit = head.code === 0 && head.stdout.trim() ? head.stdout.trim() : 'unknown';
const deps = { cfg, root, log, gh, ws, run, runAgent, runSetup, runChecks, runItem, factoryCommit };

let release;
// A factory from before targets locks the folder itself; it would poll the same repo.
const oldFactory = lockHolder(join(factoryRoot, 'factory.lock'));
if (oldFactory) { cannotRun(`an older factory is still running from this folder (pid ${oldFactory}). Stop it first.`); process.exit(1); }
try { mkdirSync(root, { recursive: true }); release = acquireLock(join(root, 'factory.lock')); } catch (e) { console.error(e.message); process.exit(1); }

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
  await ws.ensureClone();
  if (!(await ws.hasRemoteBranch())) throw new Error(`base branch "${cfg.baseBranch}" not found on ${cfg.repo}`);
  const onBase = await ws.pathsOnBase();
  for (const w of [oldLayoutWarning(factoryRoot), ...driftWarnings(cfg, (p) => onBase.has(p))].filter(Boolean)) log(`warning: ${w}`);
  const labels = await gh.listLabels(cfg);
  for (const l of [...Object.values(cfg.triggers), ...Object.values(cfg.states)])
    if (!labels.includes(l)) { await gh.createLabel(cfg, l); log(`created label ${l}`); }
  await recover(deps);
  log(`factory started for ${cfg.repo} (${cfg.target}) — polling every ${pollText(cfg.pollSec)}, up to ${cfg.maxParallel} at a time`);
  while (!stopping) {
    await ws.checkClone(); // a session may have planted config: stop the whole factory, not just one run
    await cleanup(deps, running);
    const started = await tick(deps, running);
    if (!started.length && !running.size) log('0 eligible');
    if (!stopping) await sleep(cfg.pollSec * 1000); // Ctrl-C during the poll: wake() had no sleep to end
  }
  await Promise.all(running.values());
  log('stopped');
} catch (e) {
  cannotRun(e.message);
  process.exitCode = 1;
} finally {
  release();
}
