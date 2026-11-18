#!/usr/bin/env node
// How the factory is doing for one target: node stats.mjs <target> [--since YYYY-MM-DD]
// Read only: it changes nothing on GitHub.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueOfBranch, issueOfWorktree } from './lib/names.mjs';
import { addUp, count, usageOf } from './lib/usage.mjs';

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

// The stages in the order a run uses them; any other session name comes after, by name.
const STAGES = ['explore', 'gate', 'implement', 'review', 'fix', 'rework', 'merge'];
const stageRank = (s) => (STAGES.includes(s) ? STAGES.indexOf(s) : STAGES.length);

// Sessions ({ issue, stage, at, usage }) → what they used by stage, the top 3 issues by
// cost, early stops by reason, unreadable sessions and refused tool calls. Pure.
export function groupAgentUse(sessions, since = null) {
  const ours = sessions.filter((s) => !since || s.at >= Date.parse(since));
  const byStage = new Map();
  for (const s of ours) byStage.set(s.stage, [...(byStage.get(s.stage) ?? []), s]);
  const sum = (list) => ({ sessions: list.length, ...addUp(list.map((s) => s.usage)) });
  const stages = [...byStage]
    .sort(([a], [b]) => stageRank(a) - stageRank(b) || a.localeCompare(b))
    .map(([name, list]) => [name, sum(list)]);
  const costByIssue = new Map();
  for (const s of ours) if (s.usage?.costUsd !== undefined) costByIssue.set(s.issue, (costByIssue.get(s.issue) ?? 0) + s.usage.costUsd);
  const top = [...costByIssue].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3);
  const early = new Map();
  for (const s of ours) {
    const reason = s.usage?.reason;
    if (reason !== undefined && reason !== 'completed') early.set(reason, (early.get(reason) ?? 0) + 1);
  }
  return {
    stages,
    total: sum(ours),
    top,
    early: [...early].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    unreadable: ours.filter((s) => s.usage === null).length,
    denials: ours.reduce((n, s) => n + (s.usage?.denials ?? 0), 0),
  };
}

const cached = (u) => (u.tokensIn > 0 && u.cachedIn !== undefined ? ` (${Math.round((100 * u.cachedIn) / u.tokensIn)}%)` : '');
const dollars = (x) => `$${x.toFixed(2)}`;
const row = (name, u) => `  ${name.padEnd(12)}${String(u.sessions).padStart(8)}${String(u.turns ?? '-').padStart(8)}`
  + `${(u.tokensIn === undefined ? '-' : count(u.tokensIn) + cached(u)).padStart(21)}${(u.tokensOut === undefined ? '-' : count(u.tokensOut)).padStart(9)}`
  + `${(u.costUsd === undefined ? '-' : dollars(u.costUsd)).padStart(9)}`;

// The "agent use" section. g is null when there is no log folder.
export function formatAgentUse(g, since = null) {
  if (!g || (!g.total.sessions && !since)) return 'agent use: no session logs yet';
  if (!g.total.sessions) return `agent use: no sessions since ${since}`;
  const early = [...g.early.map(([reason, n]) => `${n} ${reason}`), ...(g.unreadable ? [`${g.unreadable} unreadable (timed out or crashed)`] : [])];
  return [
    'agent use (from session logs; ≈ cost is an estimate at API list price, not your bill)',
    `  ${'stage'.padEnd(12)}${'sessions'.padStart(8)}${'turns'.padStart(8)}${'tokens in (cached)'.padStart(21)}${'out'.padStart(9)}${'≈ cost'.padStart(9)}`,
    ...g.stages.map(([name, u]) => row(name, u)),
    row('total', g.total),
    ...(g.top.length ? [`  most used: ${g.top.map(([n, cost]) => `#${n} ≈ ${dollars(cost)}`).join(' · ')}`] : []),
    `  stopped early: ${early.join(' · ') || 'none'}`,
    `  tool calls refused: ${g.denials}`,
  ].join('\n');
}

// Session logs are <logs>/issue-<n>/<ms>-<seq>-<session>.json; other files are left out.
const LOG = /^(\d+)-\d+-(.+)\.json$/;

// Every session log under the logs folder, or null when there is no such folder.
export function readSessions(logs) {
  let dirs;
  try { dirs = readdirSync(logs, { withFileTypes: true }); } catch { return null; }
  const sessions = [];
  for (const d of dirs) {
    const issue = issueOfWorktree(d.name);
    if (!d.isDirectory() || issue === null) continue;
    for (const f of readdirSync(join(logs, d.name))) {
      const m = LOG.exec(f);
      if (!m) continue;
      let text = '';
      try { text = readFileSync(join(logs, d.name, f), 'utf8'); } catch { /* unreadable */ }
      sessions.push({ issue, stage: m[2], at: Number(m[1]), usage: usageOf(text) });
    }
  }
  return sessions;
}

export function agentUseSection(logs, since = null) {
  const sessions = readSessions(logs);
  return formatAgentUse(sessions && groupAgentUse(sessions, since), since);
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
  console.log(agentUseSection(join(cfg.runDir, 'logs'), since));
  console.log(formatStats(countPullRequests(prs, cfg, since), groupStops(comments, cfg, since)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(`stats cannot run: ${e.message}`); process.exitCode = 1; });
}
