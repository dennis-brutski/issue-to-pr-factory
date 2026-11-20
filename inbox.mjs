#!/usr/bin/env node
// The factory's open stops as one JSON array, oldest first, for the /factory-inbox skill:
// node inbox.mjs [<target>]; no target means all of them.
// Read only: it changes nothing on GitHub or on disk.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueOf, worktreeFor } from './lib/names.mjs';
import { loadSettings, targetNames } from './lib/settings.mjs';
import { isFactory, newestPark } from './lib/comments.mjs';
import { stopLabel } from './stats.mjs';

const same = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();

// Items from listCandidates → the ones waiting on agent:needs-human, shaped for the skill.
// Pure apart from `exists`, which says whether the worktree folder is there.
export function toStops(items, cfg, exists = existsSync) {
  return items.filter((item) => item.labels.includes(cfg.states.needsHuman)).map((item) => {
    const park = newestPark(item.comments, cfg.owner);
    const from = park ? Date.parse(park.at) : -Infinity;
    const worktree = join(cfg.runDir, 'worktrees', worktreeFor(issueOf(item)));
    return {
      repo: cfg.repo,
      number: item.number,
      kind: item.kind,
      title: item.title,
      stage: park?.stage ?? null,
      label: park ? stopLabel(park.body) : 'no factory comment',
      stop: park?.body ?? '',
      stoppedAt: park?.at ?? null,
      worktree,
      worktreeExists: exists(worktree),
      since: item.comments.filter((c) => same(c.author, cfg.owner) && !isFactory(c.body) && Date.parse(c.at) > from).map((c) => c.body),
      url: `https://github.com/${cfg.repo}/${item.kind === 'pr' ? 'pull' : 'issues'}/${item.number}`,
      notebookId: cfg.notebookId ?? null,
    };
  });
}

// Items with no stop comment come first, then the oldest stop.
const when = (s) => (s.stoppedAt ? Date.parse(s.stoppedAt) : 0);

// With a target: its stops. Without: every target in targets/. Prints one JSON array; a target
// that fails goes to `warn` and the others are still listed. Returns false if any target failed.
export async function runInbox(argv, { factoryRoot, gh, log = console.log, warn = console.error }) {
  const names = argv[0] !== undefined ? [argv[0]] : targetNames(join(factoryRoot, 'targets'));
  if (!names.length) throw new Error('no targets in targets/');
  const stops = [];
  let ok = true;
  for (const name of names) {
    try {
      const cfg = await loadSettings(name, { factoryRoot });
      stops.push(...toStops(await gh.listCandidates(cfg), cfg));
    } catch (e) {
      ok = false;
      warn(`${name}: could not read the inbox: ${e.message}`);
    }
  }
  log(JSON.stringify(stops.sort((a, b) => when(a) - when(b)), null, 2));
  return ok;
}

async function main(argv) {
  const gh = await import('./lib/github.mjs');
  const ok = await runInbox(argv, { factoryRoot: dirname(fileURLToPath(import.meta.url)), gh });
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(`inbox cannot run: ${e.message}`); process.exitCode = 1; });
}
