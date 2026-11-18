#!/usr/bin/env node
// How the factory is doing for one target: node stats.mjs <target> [--since YYYY-MM-DD]
// Read only: it changes nothing on GitHub.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueOfBranch } from './lib/names.mjs';

const same = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();
const after = (at, since) => !since || Date.parse(at) >= Date.parse(since);

// Pull requests from factory branches of the target repo itself (no forks), by outcome. Pure.
export function countPullRequests(prs, cfg, since = null) {
  const ours = prs.filter((p) => issueOfBranch(p.ref) !== null && same(p.repo, cfg.repo) && after(p.at, since));
  return {
    opened: ours.length,
    merged: ours.filter((p) => p.merged).length,
    closedUnmerged: ours.filter((p) => p.state === 'closed' && !p.merged).length,
    open: ours.filter((p) => p.state === 'open').length,
  };
}

// The stop reasons lib/stages.mjs and lib/loop.mjs write, checked in order: the first match wins.
const LABELS = [
  [/not clear enough to build without guessing/, 'not clear enough'],
  [/needs your decision/, 'needs a decision (explore)'],
  [/held-out check failed/, 'a held-out check failed'],
  [/failed when the factory ran the checks/, 'a check failed'],
  [/failed in the worktree \(setup\)/, 'setup failed'],
  [/touches protected files/, 'protected files (draft)'],
  [/CI workflow files/, 'workflow files'],
  [/(edited|changed) after it was approved/, 'edited after approval'],
  [/agent could not (finish|fix)/, 'agent could not finish'],
  [/produced no changes/, 'no changes'],
  [/step failed: (timed out|the agent session stopped)|usage limit/i, 'timed out / max turns / usage limit'],
  [/worktree has uncommitted changes/, 'worktree dirty'],
  [/conflicts with the latest/, 'conflicts with base'],
  [/^The factory hit an error/, 'factory error'],
];

const STOP = ['🏭 **Factory stopped', '🏭 **Factory did not start'];
const NO_NEW_COMMENTS = 'There are no new comments from you since the last push.';

// A stop comment → its short label. The reason is the paragraph after the heading. Pure.
export function stopLabel(body) {
  const reason = body.split(/\n\s*\n/)[1]?.trim() ?? '';
  const hit = LABELS.find(([re]) => re.test(reason));
  return hit ? hit[1] : `other: ${reason.replace(/\s+/g, ' ').slice(0, 60)}`;
}

// The owner's stop comments → [label, count], most first. Pure.
export function groupStops(comments, cfg, since = null) {
  const counts = new Map();
  for (const c of comments) {
    if (!same(c.author, cfg.owner) || !STOP.some((s) => c.body.startsWith(s)) || c.body.includes(NO_NEW_COMMENTS) || !after(c.at, since)) continue;
    const label = stopLabel(c.body);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function formatStats(p, stops) {
  return [
    `pull requests from factory/issue-* branches: ${p.opened} opened · ${p.merged} merged · ${p.closedUnmerged} closed unmerged · ${p.open} open`,
    'stops (agent:needs-human comments, by first line of the reason):',
    ...(stops.length ? stops.map(([label, n]) => `${String(n).padStart(4)}  ${label}`) : ['   none']),
  ].join('\n');
}

async function main(argv) {
  const { loadSettings } = await import('./lib/settings.mjs');
  const gh = await import('./lib/github.mjs');
  const args = [...argv];
  let since = null;
  const i = args.indexOf('--since');
  if (i >= 0) {
    since = args[i + 1];
    args.splice(i, 2);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since ?? '') || Number.isNaN(Date.parse(since))) throw new Error('--since needs a date: YYYY-MM-DD');
  }
  const cfg = await loadSettings(args[0], { factoryRoot: dirname(fileURLToPath(import.meta.url)) });
  const [prs, comments] = await Promise.all([gh.listAllPullRequests(cfg), gh.listAllIssueComments(cfg)]);
  console.log(`${cfg.repo}${since ? ` since ${since}` : ''}`);
  console.log(formatStats(countPullRequests(prs, cfg, since), groupStops(comments, cfg, since)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(`stats cannot run: ${e.message}`); process.exitCode = 1; });
}
