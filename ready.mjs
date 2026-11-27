#!/usr/bin/env node
// Lists the open issues of each target that are ready for the owner to approve, and the
// ones held back with why, as JSON for the factory-approve-issues skill.
// node ready.mjs [<target> | --current]
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseTargets } from './lib/settings.mjs';
import { readiness } from './lib/ready.mjs';
import { run } from './lib/exec.mjs';

/** @typedef {{ number: number, title: string, url: string }} Ready */
/** @typedef {{ target: string, repo?: string, ready?: Ready[], skipped?: (Ready & { reason: string })[], error?: string }} Report */

async function reportOf(cfg, gh) {
  const issues = await gh.listOpenIssues(cfg);
  const open = issues.map((i) => i.number);
  const ready = [], skipped = [];
  for (const i of issues) {
    const reason = readiness(i, cfg, open);
    const entry = { number: i.number, title: i.title, url: i.url };
    if (reason) skipped.push({ ...entry, reason }); else ready.push(entry);
  }
  return { target: cfg.target, repo: cfg.repo, ready, skipped };
}

/**
 * The ready and held-back issues of every target, one named target, or the current folder's target.
 * @param {string[]} argv `[]`, `[<target>]` or `['--current']`
 * @param {{ factoryRoot: string, gh: { listOpenIssues: Function }, remote: () => Promise<string> }} deps
 * @returns {Promise<{ ok: boolean, report: Report[] }>} ok is false when a target could not be read; its entry has `error`
 * @throws when the target is unknown, or --current runs outside a target's folder
 */
export async function runReady(argv, { factoryRoot, gh, remote }) {
  const configs = await chooseTargets(argv, { factoryRoot, remote });
  let ok = true;
  const report = [];
  for (const cfg of configs) {
    try { report.push(await reportOf(cfg, gh)); } catch (e) { ok = false; report.push({ target: cfg.target, error: e.message }); }
  }
  return { ok, report };
}

async function main(argv) {
  const gh = await import('./lib/github.mjs');
  const remote = async () => (await run('git', ['remote', 'get-url', 'origin'])).stdout.trim();
  const { ok, report } = await runReady(argv, { factoryRoot: dirname(fileURLToPath(import.meta.url)), gh, remote });
  console.log(JSON.stringify(report, null, 2));
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(`ready cannot run: ${e.message}`); process.exitCode = 1; });
}
