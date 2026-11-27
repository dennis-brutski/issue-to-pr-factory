#!/usr/bin/env node
// Lists the open factory stops of each target, oldest first, with the stop comment, the owner's
// answers since and the worktree, as JSON for the factory-inbox skill.
// node inbox.mjs [<target> | --current]
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseTargets } from './lib/settings.mjs';
import { inboxOf } from './lib/inbox.mjs';
import { run } from './lib/exec.mjs';

/** @typedef {{ number: number, kind: string, title: string, url: string, stop: string | null, answers: string[], worktree: string | null }} Stop */
/** @typedef {{ target: string, repo?: string, stops?: Stop[], error?: string }} Report */

/**
 * The open stops of every target, one named target, or the current folder's target.
 * @param {string[]} argv `[]`, `[<target>]` or `['--current']`
 * @param {{ factoryRoot: string, gh: { listCandidates: Function }, remote: () => Promise<string> }} deps
 * @returns {Promise<{ ok: boolean, report: Report[] }>} ok is false when a target could not be read; its entry has `error`
 * @throws when the target is unknown, or --current runs outside a target's folder
 */
export async function runInbox(argv, { factoryRoot, gh, remote }) {
  const configs = await chooseTargets(argv, { factoryRoot, remote });
  let ok = true;
  const report = [];
  for (const cfg of configs) {
    try {
      report.push({ target: cfg.target, repo: cfg.repo, stops: inboxOf(await gh.listCandidates(cfg), cfg, existsSync) });
    } catch (e) { ok = false; report.push({ target: cfg.target, error: e.message }); }
  }
  return { ok, report };
}

async function main(argv) {
  const gh = await import('./lib/github.mjs');
  const remote = async () => (await run('git', ['remote', 'get-url', 'origin'])).stdout.trim();
  const { ok, report } = await runInbox(argv, { factoryRoot: dirname(fileURLToPath(import.meta.url)), gh, remote });
  console.log(JSON.stringify(report, null, 2));
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(`inbox cannot run: ${e.message}`); process.exitCode = 1; });
}
