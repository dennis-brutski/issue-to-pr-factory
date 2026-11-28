import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { classify } from './eligibility.mjs';
import { conflictToResolve, ciFailed } from './conflicts.mjs';
import { issueOf } from './names.mjs';
import { didNotStart, ciFailed as ciFailedComment } from './comments.mjs';
import { planLine } from './usage.mjs';
/** @import { Config } from './settings.mjs' */
/** @import { Gh, Item } from './github.mjs' */
/** @import { Ws } from './workspace.mjs' */


// After a kill or crash, items are still marked in-progress with nobody behind
// them. The lock guarantees we are the only factory, so all of them are orphans.
/** @param {{ gh: Partial<Gh>, cfg: Config, log?: (msg: string) => void }} deps */
export async function recover({ gh, cfg, log = () => {} }) {
  const orphans = (await gh.listCandidates(cfg)).filter((i) => i.labels.includes(cfg.states.inProgress));
  for (const i of orphans) { await gh.removeLabel(cfg, i.number, cfg.states.inProgress); log(`#${issueOf(i)} re-queued after an interrupted run`); }
  return orphans.map((i) => i.number);
}

// Ask the operating system for a port nobody uses, then let it go for the run to take.
export const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, () => { const { port } = /** @type {import('node:net').AddressInfo} */ (s.address()); s.close(() => resolve(port)); });
});

// The line after a poll: how many run, or "0 eligible" when nothing runs and nothing started; then the
// account's plan usage. null when the poll only started runs that are already over. A failed lookup leaves the plan out.
/**
 * @param {{ cfg: Config, planUsage?: () => Promise<unknown> }} deps
 * @param {number} running how many run now
 * @param {number} started how many this poll started
 * @returns {Promise<string | null>}
 */
export async function pollLine({ cfg, planUsage }, running, started) {
  if (!running && started) return null;
  const plan = cfg.localRun ? '' : planLine(await Promise.resolve().then(() => planUsage?.()).catch(() => null));
  return `${running ? `${running} running` : '0 eligible'}${plan ? ` · ${plan}` : ''}`;
}

// An issue title is text from GitHub: no control characters (escape codes included), one line, at most 80 characters.
export function shortTitle(title) {
  // Tabs and line breaks become spaces; other control characters go.
  const t = String(title ?? '').replace(/[\t\n\v\f\r]/g, ' ').replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim();
  // Count and cut by code points so an emoji is never split in half.
  const cs = [...t];
  return cs.length > 80 ? `${cs.slice(0, 79).join('')}…` : t;
}

/**
 * One poll: lists the labelled items, parks what may not run and starts what may, up to cfg.maxParallel.
 * It also turns auto-merge off on the factory's pull requests whose CI failed, and parks them.
 * Calls gh; the runs it starts go on in the background, in `running`.
 * @param {{ gh: Partial<Gh>, cfg: Config, log?: (msg: string) => void, classify?: Function, waiting?: Set<number>,
 *   runItem: (item: Item, stage: string, deps: object, port: number) => Promise<{ outcome: string, detail?: string }> }} deps
 *   classify stands in for the real one in tests; waiting is the issues that waited on the last poll, kept between polls
 * @param {Map<number, Promise<unknown>>} running
 * @returns {Promise<number[]>} the items started
 */
export async function tick(deps, running) {
  const { gh, cfg, log = () => {} } = deps;
  let items;
  try { items = await gh.listCandidates(cfg); } catch (e) { log(`could not list issues: ${e.message}`); return []; }
  // The factory's own pull requests that conflict get a merge without a label; labelled ones go by their label.
  let pulls = [];
  try { pulls = await gh.listPullRequests(cfg); } catch (e) { log(`could not list pull requests: ${e.message}`); }
  // Issues may wait for others; without this list every issue they wait for counts as open.
  let openIssues = null;
  try { openIssues = await gh.openIssueNumbers(cfg); } catch (e) { log(`could not list open issues: ${e.message}`); }
  // The factory's own pull requests on auto-merge whose CI failed: auto-merge off, so nothing merges unread, then parked.
  // Once: auto-merge is off on the next poll. A running issue is left for a later poll.
  const parked = new Set();
  for (const pr of pulls.filter((i) => ciFailed(i, cfg) && !running.has(issueOf(i)))) {
    const tag = `#${issueOf(pr)}`;
    try { await gh.disableAutoMerge(cfg, pr.number); } catch (e) { log(`${tag} could not turn auto-merge off: ${e.message}`); continue; }
    parked.add(pr.number);
    try {
      await gh.comment(cfg, pr.number, ciFailedComment(pr.url, pr.ci.failedUrl, cfg.states.needsHuman, cfg.triggers.review));
      await gh.addLabel(cfg, pr.number, cfg.states.needsHuman);
    } catch (e) { log(`${tag} could not be parked: ${e.message}`); }
    log(`${tag} parked: CI failed on ${pr.url}; auto-merge is off`);
  }
  const labelled = new Set(items.map((i) => i.number));
  const labelledDecide = deps.classify ?? classify; // tests may stand in for it
  // A pull request parked above is a human's now: no run on it this poll, labelled or not.
  const work = [...items.filter((i) => !parked.has(i.number)).map((item) => ({ item, decide: labelledDecide })),
    ...pulls.filter((i) => !labelled.has(i.number) && !parked.has(i.number)).map((item) => ({ item, decide: conflictToResolve }))];
  const started = [];
  // Which issues were waiting on the last poll, so "waits for" is said once while they wait.
  const waitedBefore = deps.waiting ?? new Set();
  deps.waiting = new Set();
  for (const { item, decide } of work.sort((a, b) => a.item.number - b.item.number)) {
    const slot = issueOf(item); // a pull request shares its issue's worktree
    const tag = `#${slot}`; // and its issue's log tag; labels and comments still go to the item
    if (running.has(slot)) continue;
    const c = decide(item, cfg, openIssues);
    if (c.waitsFor) {
      deps.waiting.add(item.number);
      if (!waitedBefore.has(item.number)) log(`${tag} ${c.reason}`);
    } else if (c.action === 'park') {
      try { // label first: if it fails, the next poll tries again without a second comment
        await gh.addLabel(cfg, item.number, cfg.states.needsHuman);
        await gh.comment(cfg, item.number, didNotStart(c.reason, cfg.states.needsHuman));
      } catch (e) { log(`${tag} could not be parked: ${e.message}`); }
      log(`${tag} parked: ${c.reason}`);
    } else if (c.action === 'run' && running.size < cfg.maxParallel) {
      const title = shortTitle(item.title);
      const on = item.kind === 'pr' ? ` on PR #${item.number}` : '';
      log(`${tag} ${c.stage} started${on}${title ? ` (${title})` : ''}`);
      const p = Promise.resolve()
        .then(() => freePort())
        .then((port) => deps.runItem(item, c.stage, deps, port))
        .then((r) => log(`${tag} ${c.stage} ${r.outcome}${r.detail ? `: ${String(r.detail).replaceAll('\n', `\n${' '.repeat(10)}`)}` : ''}`))
        .catch((e) => log(`${tag} ${c.stage} crashed: ${e.message}`))
        .finally(() => running.delete(slot));
      running.set(slot, p);
      started.push(item.number);
    }
  }
  return started;
}

/**
 * @param {{ gh: Partial<Gh>, ws: Partial<Ws>, cfg: Config, log?: (msg: string) => void }} deps
 * @param {Map<number, unknown>} running
 */
export async function cleanup({ gh, ws, cfg, log = () => {} }, running) {
  for (const n of await ws.listWorktrees()) {
    if (running.has(n)) continue;
    try { if (await gh.isFinished(cfg, n)) { await ws.removeWorktree(n); log(`#${n} finished; worktree removed`); } }
    catch (e) { log(`#${n} cleanup failed: ${e.message}`); }
  }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// The pid in a lock file, when that process is still running; otherwise null.
export function lockHolder(file) {
  let pid;
  try { pid = Number(readFileSync(file, 'utf8').trim()); } catch { return null; }
  return pid && alive(pid) ? pid : null;
}

export function acquireLock(file) {
  try { writeFileSync(file, String(process.pid), { flag: 'wx' }); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const pid = lockHolder(file);
    if (pid) throw new Error(`already running (pid ${pid}). If that process is not the factory, delete ${file} and start again.`);
    writeFileSync(file, String(process.pid)); // stale lock from a dead process
  }
  return () => rmSync(file, { force: true });
}

// Refuses to start unless agents can be contained and GitHub writes are the owner's.
/**
 * @param {{ run: Function, gh: Partial<Gh>, cfg: Config }} deps
 * @returns {Promise<void>} throws when bwrap or claude cannot start, or gh is not logged in as the owner
 */
export async function preflight({ run, gh, cfg }) {
  if ((await run('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-net', 'true'])).code !== 0)
    throw new Error('the sandbox cannot start (`bwrap --ro-bind / / --dev /dev --unshare-net true` failed), so agents would run uncontained. See "Getting started" in the README.');
  if ((await run('claude', ['--version'])).code !== 0) throw new Error('the claude CLI is not available.');
  const login = await gh.authenticatedLogin();
  if (login.toLowerCase() !== cfg.owner.toLowerCase()) throw new Error(`gh is logged in as ${login}, not ${cfg.owner}. Set your GitHub login as owner in local.mjs (see the README).`);
}
