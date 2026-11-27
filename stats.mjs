#!/usr/bin/env node
// How the factory is doing: node stats.mjs [<target>] [--since YYYY-MM-DD]; no target means all of them.
// Read only: it changes nothing on GitHub.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueOfBranch, issueOfWorktree } from './lib/names.mjs';
import { addUp, count, usageOf } from './lib/usage.mjs';
import { loadSettings, targetNames } from './lib/settings.mjs';
import { autoMergedPull, isCountedStop, isRework, stopLabel } from './lib/comments.mjs';

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

// The owner's Auto-merge comments, and how many of those pull requests a merged revert undid.
// `prs` carry titles: GitHub's revert button opens a pull request titled Revert "<title>". Pure.
const handedOver = (comments, cfg, since) => comments.filter((c) => same(c.author, cfg.owner) && after(c.at, since)).map((c) => autoMergedPull(c.body)).filter((n) => n !== null);
export function countAutoMerges(comments, prs, cfg, since = null) {
  const handed = handedOver(comments, cfg, since);
  const reverts = new Set(prs.filter((p) => p.merged && same(p.repo, cfg.repo)).map((p) => p.title));
  const reverted = new Set(handed.filter((n) => {
    const title = prs.find((p) => p.number === n)?.title;
    return title !== undefined && reverts.has(`Revert "${title}"`);
  }));
  return { autoMerged: handed.length, reverted: reverted.size };
}

export const formatAutoMerges = (a) => `auto-merged: ${a.autoMerged} · reverted: ${a.reverted}`;

// Merged factory pull requests opened since `since` ({ number, ref, repo, at, mergedAt }), and comments
// with the number they are on: how many reworks and stops the owner had to answer on each pull request
// or its issue, whenever they were made, and the median wait from opened to merged. Pure.
export function countReviewLoad(merged, comments, cfg, since = null) {
  const ours = merged.filter((p) => issueOfBranch(p.ref) !== null && same(p.repo, cfg.repo) && after(p.at, since));
  // Each comment counts once, even when two merged pull requests come from the same issue.
  const steps = comments.filter((c) => same(c.author, cfg.owner) && (isRework(c.body) || isCountedStop(c.body))
    && ours.some((p) => c.on === p.number || c.on === issueOfBranch(p.ref))).length;
  const waits = ours.map((p) => Date.parse(p.mergedAt) - Date.parse(p.at)).sort((a, b) => a - b);
  const mid = Math.floor(waits.length / 2);
  const medianMs = !waits.length ? null : waits.length % 2 ? waits[mid] : (waits[mid - 1] + waits[mid]) / 2;
  return { merged: ours.length, steps, medianMs };
}

// Whole minutes under an hour, otherwise whole hours.
const wait = (ms) => (ms < 3600000 ? `${Math.floor(ms / 60000)}m` : `${Math.floor(ms / 3600000)}h`);
export const formatReviewLoad = (l) => `review load: ${l.merged ? (l.steps / l.merged).toFixed(1) : '-'} reworks or stops per merged PR`
  + ` · median ${l.medianMs === null ? '-' : wait(l.medianMs)} to merge`;

// Closed factory pull requests ({ number, ref, repo, state, merged, at }) by the gate confidence in
// their footer (bodies: { number, body }), and the owner's "not clear enough" stops. A rework is a
// Rework comment of the owner's on the pull request or its issue (comments with the number they are on). Pure.
const GATE_GROUPS = ['70–79', '80–89', '90+', 'other'];
// The confidence comes from the last footer line only: the text above it may mention "gate confidence" too.
const gateGroup = (body) => {
  const footer = (body ?? '').split('\n').filter((l) => l.startsWith('🏭 Built by issue-to-pr-factory ')).at(-1) ?? '';
  const m = / · gate confidence (\d+) · /.exec(footer);
  const n = m ? Number(m[1]) : -1;
  return n >= 90 ? '90+' : n >= 80 ? '80–89' : n >= 70 ? '70–79' : 'other';
};
export function countGate(prs, bodies, commentsOn, comments, cfg, since = null) {
  const groups = new Map(GATE_GROUPS.map((g) => [g, [0, 0, 0]]));
  const reworked = (p) => commentsOn.some((c) => same(c.author, cfg.owner) && isRework(c.body) && (c.on === p.number || c.on === issueOfBranch(p.ref)));
  for (const p of prs) {
    if (issueOfBranch(p.ref) === null || !same(p.repo, cfg.repo) || !after(p.at, since) || p.state === 'open') continue;
    const row = groups.get(gateGroup(bodies.find((b) => b.number === p.number)?.body));
    row[!p.merged ? 2 : reworked(p) ? 1 : 0] += 1;
  }
  const stops = comments.filter((c) => same(c.author, cfg.owner) && isCountedStop(c.body) && after(c.at, since)
    && stopLabel(c.body) === 'not clear enough').length;
  return { groups: [...groups], stops };
}

export const formatGate = (g) => [
  'gate confidence of factory pull requests: merged without rework · merged after rework · closed unmerged',
  ...g.groups.map(([label, counts]) => `${label.padStart(8)}  ${counts.join(' · ')}`),
  `gate stops (not clear enough): ${g.stops}`,
].join('\n');

// The stop labels and reasons live in lib/comments.mjs, next to the text they label.
export { stopLabel };

// The owner's stop comments → [label, count], most first. Pure.
export function groupStops(comments, cfg, since = null) {
  const counts = new Map();
  for (const c of comments) {
    if (!same(c.author, cfg.owner) || !isCountedStop(c.body) || !after(c.at, since)) continue;
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

// One target's stats as text, under the repo as its heading.
async function statsOf(cfg, gh, since) {
  // One read of each list; the counts below filter them in memory.
  const [prs, comments] = await Promise.all([gh.listAllPullRequests(cfg), gh.listAllIssueComments(cfg)]);
  const merged = prs.filter((p) => p.merged === true);
  const pulls = countPullRequests(prs, cfg, since);
  return [
    `${cfg.repo}${since ? ` since ${since}` : ''}`,
    agentUseSection(join(cfg.runDir, 'logs'), since),
    formatAutoMerges(countAutoMerges(comments, prs, cfg, since)),
    formatReviewLoad(countReviewLoad(merged, comments, cfg, since)),
    formatGate(countGate(prs, prs, comments, comments, cfg, since)),
    formatStats(pulls, groupStops(comments, cfg, since)),
  ].join('\n');
}

// With a target: its stats. Without: every target in targets/, one blank line apart; a target
// that fails prints one line and the others still print. Returns false if any target failed.
export async function runStats(argv, { factoryRoot, gh, log = console.log }) {
  const args = [...argv];
  let since = null;
  const i = args.indexOf('--since');
  if (i >= 0) {
    since = args[i + 1];
    args.splice(i, 2);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since ?? '') || Number.isNaN(Date.parse(since))) throw new Error('--since needs a date: YYYY-MM-DD');
  }
  if (args[0] !== undefined) {
    log(await statsOf(await loadSettings(args[0], { factoryRoot }), gh, since));
    return true;
  }
  const names = targetNames(join(factoryRoot, 'targets'));
  if (!names.length) throw new Error('no targets in targets/');
  let ok = true;
  for (const [n, name] of names.entries()) {
    if (n > 0) log('');
    try {
      log(await statsOf(await loadSettings(name, { factoryRoot }), gh, since));
    } catch (e) {
      ok = false;
      log(`${name}: could not read stats: ${e.message}`);
    }
  }
  return ok;
}

async function main(argv) {
  const gh = await import('./lib/github.mjs');
  const ok = await runStats(argv, { factoryRoot: dirname(fileURLToPath(import.meta.url)), gh });
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(`stats cannot run: ${e.message}`); process.exitCode = 1; });
}
