import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { classify } from './eligibility.mjs';
import { conflictToResolve } from './conflicts.mjs';
import { issueOf } from './names.mjs';
import { didNotStart } from './comments.mjs';


// After a kill or crash, items are still marked in-progress with nobody behind
// them. The lock guarantees we are the only factory, so all of them are orphans.
export async function recover({ gh, cfg, log = () => {} }) {
  const orphans = (await gh.listCandidates(cfg)).filter((i) => i.labels.includes(cfg.states.inProgress));
  for (const i of orphans) { await gh.removeLabel(cfg, i.number, cfg.states.inProgress); log(`#${i.number} re-queued after an interrupted run`); }
  return orphans.map((i) => i.number);
}

// Ask the operating system for a port nobody uses, then let it go for the run to take.
export const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

// An issue title is text from GitHub: no control characters (escape codes included), one line, at most 80 characters.
export function shortTitle(title) {
  // Tabs and line breaks become spaces; other control characters go.
  const t = String(title ?? '').replace(/[\t\n\v\f\r]/g, ' ').replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim();
  // Count and cut by code points so an emoji is never split in half.
  const cs = [...t];
  return cs.length > 80 ? `${cs.slice(0, 79).join('')}…` : t;
}

export async function tick(deps, running) {
  const { gh, cfg, log = () => {} } = deps;
  let items;
  try { items = await gh.listCandidates(cfg); } catch (e) { log(`could not list issues: ${e.message}`); return []; }
  // The factory's own pull requests that conflict get a merge without a label; labelled ones go by their label.
  let pulls = [];
  try { pulls = await gh.listPullRequests(cfg); } catch (e) { log(`could not list pull requests: ${e.message}`); }
  const labelled = new Set(items.map((i) => i.number));
  const work = [...items.map((item) => ({ item, decide: classify })),
    ...pulls.filter((i) => !labelled.has(i.number)).map((item) => ({ item, decide: conflictToResolve }))];
  const started = [];
  for (const { item, decide } of work.sort((a, b) => a.item.number - b.item.number)) {
    const slot = issueOf(item); // a pull request shares its issue's worktree
    if (running.has(slot)) continue;
    const c = decide(item, cfg);
    if (c.action === 'park') {
      try {
        await gh.comment(cfg, item.number, didNotStart(c.reason, cfg.states.needsHuman));
        await gh.addLabel(cfg, item.number, cfg.states.needsHuman);
      } catch (e) { log(`#${item.number} could not be parked: ${e.message}`); }
      log(`#${item.number} parked: ${c.reason}`);
    } else if (c.action === 'run' && running.size < cfg.maxParallel) {
      const title = shortTitle(item.title);
      log(`#${item.number} ${c.stage} started${title ? ` (${title})` : ''}`);
      const p = Promise.resolve()
        .then(() => freePort())
        .then((port) => deps.runItem(item, c.stage, deps, port))
        .then((r) => log(`#${item.number} ${c.stage} ${r.outcome}${r.detail ? `: ${String(r.detail).replaceAll('\n', `\n${' '.repeat(10)}`)}` : ''}`))
        .catch((e) => log(`#${item.number} ${c.stage} crashed: ${e.message}`))
        .finally(() => running.delete(slot));
      running.set(slot, p);
      started.push(item.number);
    }
  }
  return started;
}

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
    if (pid) throw new Error(`already running (pid ${pid})`);
    writeFileSync(file, String(process.pid)); // stale lock from a dead process
  }
  return () => rmSync(file, { force: true });
}

// Refuses to start unless agents can be contained and GitHub writes are the owner's.
export async function preflight({ run, gh, cfg }) {
  if ((await run('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-net', 'true'])).code !== 0)
    throw new Error('the sandbox cannot start (bwrap probe failed), so agents would run uncontained. See Task 0 of the plan.');
  if ((await run('claude', ['--version'])).code !== 0) throw new Error('the claude CLI is not available.');
  const login = await gh.authenticatedLogin();
  if (login.toLowerCase() !== cfg.owner.toLowerCase()) throw new Error(`gh is logged in as ${login}, not ${cfg.owner}. Set your GitHub login as owner in local.mjs (see the README).`);
}
