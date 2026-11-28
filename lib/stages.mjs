import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promptInput } from './eligibility.mjs';
import * as say from './comments.mjs';
import { issueOf, worktreeFor } from './names.mjs';
import { verifyBranch } from './verify.mjs';
import { protectedPathViolations } from './brakes.mjs';
import { renderPrompt, schemas } from './prompts.mjs';
import { usageOf, addUp, usageLine, localUse } from './usage.mjs';
import * as prBody from './pr-body.mjs';
import { fence, list, agentText } from './text.mjs';
/** @import { Config } from './settings.mjs' */
/** @import { Gh, Item } from './github.mjs' */
/** @import { Ws } from './workspace.mjs' */

/**
 * What a run needs from the factory. Tests pass fakes with only the gh and ws methods they use.
 * @typedef {{ cfg: Config, gh: Partial<Gh>, ws: Partial<Ws>, runAgent: Function, runSetup: Function, runChecks: Function,
 *   runTestFiles?: Function, log?: (msg: string) => void, factoryCommit?: string, root?: string, planUsage?: () => Promise<unknown> }} Deps
 */

// A test file's name: a.test.js, a.spec.ts, a_test.py, test_a.py.
const TEST_NAME = /^test_|[._-](test|spec)s?\./i;

// The test files an issue lists under "## Tests that change".
export const testsThatChange = (body) => prBody.listedPaths(body, 'Tests that change');

// The protected files an issue lets its run change. A pull request gives none: on every later run a branch
// that changes protected files parks before setup, so only the first implement run needs the list.
/** @type {(item: Pick<Item, 'kind' | 'body'> & Partial<Item>) => string[]} */
export const protectedThatChangeOf = (item) => (item.kind === 'issue' ? prBody.listedPaths(item.body, 'Protected files that change') : []);

// The test files that may change for this item: from the issue's body, or from the factory's part of the pull request's.
/** @type {(item: Item) => string[]} */
const testsThatChangeOf = (item) => (item.kind === 'pr' ? prBody.parse(item.body).testsThatChange : testsThatChange(item.body));

// The model for the first implement session. A cheaper one only drafts simple issues away from
// protected files, and never after a stop. Review and every fix stay on cfg.model.
/** @param {Pick<Config, 'model' | 'simpleModel'> & Partial<Config>} cfg */
export function implementModel(gate, cfg, { lastStop = '' } = {}) {
  const simple = cfg.simpleModel && gate.difficulty === 'simple' && !lastStop
    && !protectedPathViolations((gate.files ?? []).map((path) => ({ status: 'M', path })), cfg).length;
  return simple ? cfg.simpleModel : cfg.model;
}

// Judges (gate, review, explore) look at the change fresh, without earlier attempts.
const CODE_SESSIONS = ['implement', 'fix', 'rework', 'merge'];

// Why the last run stopped: the newest factory park comment that is not older than the last push,
// which is the newest factory comment that is not a stop (lib/comments.mjs).
/** @type {(item: Pick<Item, 'comments'> & Partial<Item>, cfg: Pick<Config, 'owner'> & Partial<Config>) => string} */
export const lastStopReason = (item, cfg) => say.lastStop(item.comments, cfg.owner);

class Park extends Error {}
const park = (reason) => { throw new Park(reason); };
// Command output folded away on GitHub, still in full for the agents that read the park comment.
const folded = (text) => {
  const n = String(text).replace(/\n+$/, '').split('\n').length;
  return `<details><summary>Output (${n} ${n === 1 ? 'line' : 'lines'})</summary>\n\n${fence(text)}\n\n</details>`;
};
const command = ([cmd, args]) => `\`${[cmd, ...args].join(' ')}\``;
/** @type {(cfg: Pick<Config, 'checks'>) => string} */
const checkList = (cfg) => cfg.checks.map(command).join(', ') || '(none)';
/** @type {(cfg: Pick<Config, 'checks'>) => string} */
const checkTicks = (cfg) => cfg.checks.map((c) => `✅ ${command(c)}`).join('\n');
/** @type {(cfg: Pick<Config, 'checks'>) => string} */
const checksNote = (cfg) => `Checks run by the factory before pushing (confined, no network): ${checkList(cfg)} — all passed.`;
// How the pull request was built, so it can be told weeks later without the factory's logs.
/** @type {(cfg: Config) => string} */
const models = (cfg) => (cfg.gateModel && cfg.gateModel !== cfg.model ? `${cfg.model} (gate ${cfg.gateModel})` : cfg.model);
/** @type {(cfg: Config, draft?: { model?: string, difficulty?: string }) => string} */
const drafted = (cfg, { model, difficulty } = {}) => (model && model !== cfg.model ? ` · implement ${model} (${difficulty})` : '');
/** @param {Deps} deps */
const provenance = ({ cfg, factoryCommit }, issueNumber, confidence, logs, draft) =>
  `---\n🏭 Built by issue-to-pr-factory ${factoryCommit || 'unknown'} · model ${models(cfg)}${drafted(cfg, draft)} · gate confidence ${confidence} · checks: ${checkList(cfg)}${agentUse(logs, cfg)} · session logs: runs/${cfg.target}/logs/${worktreeFor(issueNumber)}/`;
const readOrNull = (file) => { try { return readFileSync(file, 'utf8'); } catch { return null; } };
// What every session of this issue used so far, over all runs, from its log folder. Empty when there are no logs.
// A local run has no cost: it shows the token counts instead.
/** @param {string} dir @param {Config} cfg */
function agentUse(dir, cfg) {
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return ''; }
  const texts = files.map((f) => readOrNull(join(dir, f))).filter((t) => t !== null);
  if (!texts.length) return '';
  const u = addUp(texts.map(usageOf));
  return ` · agent use so far: ${texts.length} ${texts.length === 1 ? 'session' : 'sessions'}`
    + (u.turns !== undefined ? ` · ${u.turns} turns` : '')
    + (cfg.localRun ? ` · ${localUse(u)}` : u.costUsd !== undefined ? ` · ≈ $${u.costUsd.toFixed(2)}` : '');
}

/**
 * Runs one stage for one item: sessions, checks, push, labels and comments on GitHub.
 * @param {Item} item
 * @param {string} stage
 * @param {Deps} deps
 * @param {number} port
 * @returns {Promise<{ outcome: string, detail?: string }>}
 */
export async function runItem(item, stage, deps, port) {
  const { gh, ws, cfg, log = () => {} } = deps;
  const target = item.number; // labels and comments go on the item that was labelled
  const issueNumber = issueOf(item);
  const p = ws.paths(issueNumber);
  let seq = 0;

  const ctx = {
    item, deps, port, p, issueNumber, target, lastStop: '',
    /**
     * @param {string} name
     * @param {any} vars
     * @param {object} schema
     * @param {{ readOnly?: boolean, model?: string }} [opts]
     */
    session: async (name, vars, schema, { readOnly = false, model } = {}) => {
      const before = readOnly ? await ws.headInfo(ctx.dir) : null;
      const input = promptInput(item, cfg, vars.since ?? null);
      const prompt = renderPrompt(name, {
        number: issueNumber, branch: p.branch, base: cfg.baseBranch, title: input.title, body: input.body || '(empty)',
        comments: input.comments.length ? input.comments.map((c) => `- ${c}`).join('\n') : '(none)',
        lastStop: CODE_SESSIONS.includes(name) ? ctx.lastStop : '', writeup: say.lastWriteup(item.comments ?? [], cfg.owner), protectedThatChange: protectedThatChangeOf(item), ...vars,
      }, cfg);
      log(`#${issueNumber} ${name} session started`);
      const logFile = join(p.logs, `${Date.now()}-${++seq}-${name}.json`);
      const r = await deps.runAgent({ cwd: ctx.dir, prompt, schema, readOnly, session: name, cfg: model ? { ...cfg, model } : cfg, port, logFile });
      const text = readOrNull(logFile); // what the session used; never a reason to park
      const used = text === null ? null : usageLine(usageOf(text), { local: cfg.localRun });
      if (used !== null) log(`#${issueNumber} ${name} session ended${used ? ` · ${used}` : ''}`);
      if (!r.ok) park(say.reasons.stepFailed(name, r.reason));
      if (readOnly && (!(await ws.isClean(ctx.dir)) || (await ws.headInfo(ctx.dir)).sha !== before.sha))
        park(say.reasons.readOnlyChanged(name));
      return r.output;
    },
  };

  await gh.addLabel(cfg, target, cfg.states.inProgress);
  try {
    // The workspace checks the clone's config and .git link before each git command.
    ctx.dir = (await ws.ensureWorktree(issueNumber)).dir;
    // These stages start read-only, which a tree that is already dirty would fail, blaming the session.
    // shortcut: parks instead of resuming uncommitted work; stash it around read-only sessions if this comes up often.
    if ((stage === 'explore' || stage === 'implement') && !(await ws.isClean(ctx.dir)))
      park(say.reasons.worktreeDirty(p.worktree));
    // A reused worktree may sit on an old base. Merge, never rebase: the branch may already be pushed.
    // review keeps the branch Dennis reviewed; merge does this itself.
    // A conflict is undone for now, so setup never runs on a half-merged tree, and resolved after setup.
    const conflict = (stage === 'explore' || stage === 'implement') && (await ws.mergeBase(ctx.dir)) === 'conflict';
    if (conflict) await ws.abortMerge(ctx.dir);
    // Setup has network. A branch an agent changed earlier could make it install packages of the agent's choosing.
    // Unless the owner approved setup for a commit with exactly these protected files (ADR 0007).
    const before = await verifyBranch(ws, cfg, ctx.dir, { before: 'setup', approvals: say.setupApprovals(item.comments ?? [], cfg.owner) });
    if (before.park) park(before.park);
    // The agents' sandbox has no network, so the factory installs dependencies first.
    const setup = await deps.runSetup(ctx.dir, cfg, port, join(p.clone, '.git'));
    if (!setup.ok) park(say.reasons.setupFailed(setup.failed, folded(setup.output), setup));
    if (stage !== 'explore') ctx.lastStop = lastStopReason(item, cfg);
    // As the merge stage does.
    if (conflict && (await ws.mergeBase(ctx.dir)) === 'conflict') await resolveConflict(ctx);
    return await STAGES[stage](ctx);
  } catch (e) {
    const reason = e instanceof Park ? e.message : say.reasons.factoryError(e.message);
    try {
      const hasWork = ctx.dir && (await ws.againstBase(ctx.dir, { local: true }).then((b) => b.messages()).catch(() => [])).length > 0;
      await gh.comment(cfg, target, say.stopped(stage, reason, cfg.states.needsHuman, hasWork ? p.branch : null, cfg.triggers.review));
      await gh.addLabel(cfg, target, cfg.states.needsHuman);
    } catch (e2) { log(`#${issueNumber} could not record the park on GitHub: ${e2.message}`); }
    return { outcome: 'parked', detail: reason };
  } finally {
    try { await gh.removeLabel(cfg, target, cfg.states.inProgress); } catch (e) { log(`#${issueNumber} could not remove in-progress: ${e.message}`); }
  }
}

// A base merge stopped on a conflict: the merge session resolves it, git's own state decides, never the session's word.
async function resolveConflict(ctx) {
  const w = await ctx.session('merge', {}, schemas.work);
  if (!(await ctx.deps.ws.mergeResolved(ctx.dir))) park(say.reasons.mergeUnresolved(w.detail || w.summary));
}

// Steps shared by every stage that produces commits: nothing left uncommitted,
// the branch passes lib/verify.mjs, the factory's own check run is green, then push.
// Returns { flags, notes }: why the pull request should be a draft, and what it should mention; with `since`, only for what changed after it.
// With `base` (a pinned view) and cfg.testFiles set, it also gives passWithout: the branch's new and changed tests that pass on the base's code.
/**
 * @param {{ deps: Deps, dir: string, p: any, port: number, issueNumber: number, item: Item }} run
 * @param {{ since?: string | null, base?: { sha: string } | null }} [opts]
 */
async function verifyAndPush({ deps: { ws, cfg, runChecks, runTestFiles, log = () => {} }, dir, p, port, issueNumber, item }, { since = null, base = null } = {}) {
  const ready = await ws.preparePush(dir, p.branch);
  if (ready.refused === 'not-on-branch') park(say.reasons.notOnBranch(p.branch, ready.branch));
  if (ready.refused === 'uncommitted') park(say.reasons.uncommitted());
  const head = ready.sha; // what the brakes and checks look at is what gets pushed
  if (ready.reattached) log(`#${issueNumber} HEAD was detached; moved ${p.branch} to ${head.slice(0, 7)}`);
  /** @type {{ park: string | null, flags: string[], notes?: string[] }} */
  const verdict = await verifyBranch(ws, cfg, dir, { since, testsThatChange: testsThatChangeOf(item) });
  if (verdict.park) park(verdict.park);
  const checks = await runChecks(dir, cfg, port, join(p.clone, '.git'), { inCopy: ws.inCopy }); // held-out checks run in a throwaway copy
  if (!checks.ok && checks.heldOut) { // agents read park comments: keep what the held-out tests check from them
    log(`#${issueNumber} held-out check output:\n${checks.output}`);
    park(say.reasons.heldOutFailed(checks.failed));
  }
  if (!checks.ok) park(say.reasons.checkFailed(checks.failed, folded(checks.output)));
  let passWithout = [];
  if (base && cfg.testFiles) {
    // Fakes and contract helpers in testSupport are not tests of their own, nor are helper modules
    // (steps.mjs, helpers.mjs): a file with no tests passes, so only files named as tests run.
    const isSupport = (f) => (cfg.testSupport ?? []).some((d) => f.startsWith(d));
    const isTest = (f) => !isSupport(f) && TEST_NAME.test(basename(f));
    const onBase = await ws.testsOnBase(dir, base.sha, cfg.testDirs ?? [], (files) => runTestFiles(dir, cfg, port, join(p.clone, '.git'), files.filter(isTest)));
    if (onBase?.timedOut) park(say.reasons.checkFailed(onBase.timedOut.failed, folded(onBase.timedOut.output)));
    passWithout = onBase?.passed ?? [];
  }
  await ws.push(dir, p.branch, head);
  return { flags: verdict.flags, notes: verdict.notes ?? [], passWithout };
}

// Hands a non-draft implement pull request to GitHub's auto-merge when the target has held-out
// checks (the one check the agent cannot see, so cannot bend) and the pull request is simple,
// cleanly reviewed, under AUTO_MERGE_LINES lines and has no tests that pass without the change.
// Never parks. Returns what to add to the log line.
const AUTO_MERGE_LINES = 100;
/**
 * Why a pull request is not auto-merged, or null. Without `lines` (the size is not read yet) the size is not judged.
 * @param {{ heldOutChecks?: any[], isDraft?: boolean, passWithout?: string[], difficulty?: string, reviewed?: string | null, lines?: number }} facts
 * @returns {string | null}
 */
export function autoMergeRefusal({ heldOutChecks, isDraft, passWithout = [], difficulty, reviewed, lines }) {
  if (!heldOutChecks?.length) return 'no held-out checks';
  if (isDraft) return 'draft';
  if (passWithout.length) return 'tests pass without the change';
  if (difficulty !== 'simple') return `not simple (${difficulty})`;
  if (reviewed === 'findings after fix') return 'review not clean after the fix';
  if (!reviewed) return 'review not clean';
  if (lines !== undefined && !(lines < AUTO_MERGE_LINES)) return `${lines} lines changed, needs fewer than ${AUTO_MERGE_LINES}`;
  return null;
}

/** @param {{ deps: Deps, target: number }} ctx */
async function autoMerge({ deps: { gh, cfg }, target }, pr, difficulty, reviewed, passWithout = []) {
  const no = (why) => `not auto-merged: ${why}`;
  const facts = { heldOutChecks: cfg.heldOutChecks, isDraft: pr.isDraft, passWithout, difficulty, reviewed };
  const before = autoMergeRefusal(facts);
  if (before) return no(before);
  let lines;
  try {
    const size = await gh.pullRequestSize(cfg, pr.number);
    lines = size.additions + size.deletions;
  } catch (e) { return no(`could not read its size: ${e.message}`); }
  const refusal = autoMergeRefusal({ ...facts, lines });
  if (refusal) return no(refusal);
  try {
    await gh.autoMerge(cfg, pr.number);
  } catch (e) {
    await gh.comment(cfg, target, say.autoMergeFailed(pr.url, e.message));
    return no('the merge call failed');
  }
  await gh.comment(cfg, target, say.autoMerged(pr.url, { reviewed, lines }));
  return 'handed to auto-merge';
}

// The existing tests the sessions changed or deleted, as they reported them. An answer without the field has none.
const testChanges = (...answers) => answers.flatMap((a) => a?.test_changes ?? [])
  .map((c) => ({ file: agentText(c.file), test: agentText(c.test), reason: agentText(c.reason) }));
// Agent text in a list, made safe for GitHub.
const safe = (items) => (items ?? []).map(agentText);
const STAGES = {
  async explore(ctx) {
    const { deps: { gh, cfg }, target } = ctx;
    const out = await ctx.session('explore', {}, schemas.explore, { readOnly: true });
    await gh.comment(cfg, target, say.explore(out.writeup, out.easy_to_undo, out.small_reach));
    if (!(out.easy_to_undo && out.small_reach))
      park(say.reasons.needsDecision(cfg.triggers.explore, cfg.triggers.implement));
    await gh.removeLabel(cfg, target, cfg.triggers.explore);
    await gh.addLabel(cfg, target, cfg.triggers.implement);
    return { outcome: 'promoted', detail: 'explore found it safe; queued for implement' };
  },

  async implement(ctx) {
    const { deps: { gh, ws, cfg }, dir, p, target, issueNumber, item } = ctx;
    const g = await ctx.session('gate', {}, schemas.gate, { readOnly: true, model: cfg.gateModel }); // unset: cfg.model
    // Any contradiction means something would be guessed, whatever the confidence. An older gate's answer has neither list.
    const contradictions = safe(g.contradictions), missing = safe(g.missing);
    if (g.confidence < cfg.confidenceThreshold || contradictions.length)
      park(say.reasons.notClear(g.confidence, cfg.confidenceThreshold, list(safe(g.questions)) || '- (none given)', list(contradictions), list(missing)));

    const model = implementModel(g, cfg, { lastStop: ctx.lastStop }); // only the first draft; review and fix stay on cfg.model
    const w = await ctx.session('implement', {}, schemas.work, { model });
    if (w.status !== 'complete') park(say.reasons.couldNotFinish(w.detail || w.summary));
    const base = await ws.againstBase(dir); // the review diffs against this pinned commit, not the clone's origin ref
    if (!(await base.changes()).length) park(say.reasons.noChanges());

    const r = await ctx.session('review', { baseSha: base.sha }, schemas.review, { readOnly: true });
    let reviewed = r.verdict === 'clean' ? 'clean' : null; // for auto-merge: 'clean', 'clean after fix' or null
    // Test concerns are for you, not the fix session; each one makes the pull request a draft.
    const concerns = safe(r.test_concerns);
    let f = null, afterFix = [];
    if (r.verdict === 'findings' && r.findings.length) {
      f = await ctx.session('fix', { findings: r.findings.map((x) => `- ${x}`).join('\n') }, schemas.work);
      if (f.status !== 'complete') park(say.reasons.couldNotFix(f.detail || f.summary));
      // The fix is always reviewed again. Findings again are a note in the body for you: no second fix, no draft, never a park.
      const r2 = await ctx.session('review', { baseSha: base.sha }, schemas.review, { readOnly: true });
      reviewed = r2.verdict === 'clean' ? 'clean after fix' : 'findings after fix';
      if (r2.verdict === 'findings') afterFix = safe(r2.findings);
      concerns.push(...safe(r2.test_concerns).filter((c) => !concerns.includes(c)));
    }

    const { flags, notes, passWithout } = await verifyAndPush(ctx, { base });
    const violations = [...flags, ...concerns.map((c) => `test concern from the review: ${c}`)];
    const body = prBody.render({
      issueNumber, warnings: violations, testsThatChange: testsThatChange(item.body), summary: agentText(w.summary), notes, testChanges: testChanges(w, f), reviewFindingsAfterFix: afterFix, testsPassWithout: passWithout,
      checks: `${checkTicks(cfg)}\n\n${checksNote(cfg)}`, footer: provenance(ctx.deps, issueNumber, g.confidence, p.logs, { model, difficulty: g.difficulty }),
    });
    let pr = await gh.findPullRequest(cfg, p.branch);
    if (!pr) pr = await gh.openPullRequest(cfg, { branch: p.branch, title: item.title, body, draft: violations.length > 0 });
    else { // always: the issue may have changed since the body was written
      await gh.updatePullRequestBody(cfg, pr.number, body);
      if (violations.length && !pr.isDraft) await gh.setDraft(cfg, pr.number, true);
    }
    await gh.comment(cfg, target, say.pullRequest(pr.url));
    if (violations.length) park(say.reasons.draft(pr.url, list(violations)));
    const merged = cfg.autoMerge ? await autoMerge(ctx, pr, g.difficulty, reviewed, passWithout) : null;
    await gh.addLabel(cfg, target, cfg.states.done);
    return { outcome: 'done', detail: merged ? `${pr.url} (${merged})` : pr.url };
  },

  async review(ctx) {
    const { deps: { gh, ws, cfg }, dir, target, item } = ctx;
    const before = await ws.headInfo(dir), since = say.lastPush(item.comments, cfg.owner);
    // Only your comments are requests; a stop reason alone is not one.
    if (!promptInput(item, cfg, since).comments.length) park(say.NO_NEW_COMMENTS);
    const w = await ctx.session('rework', { since }, schemas.work);
    if (w.status !== 'complete') park(say.reasons.couldNotRework(w.detail || w.summary));
    await gh.comment(cfg, target, say.rework(w.summary));
    if ((await ws.headInfo(dir)).sha === before.sha) { // answered without changing anything
      await gh.removeLabel(cfg, target, cfg.triggers.review);
      return { outcome: 'done', detail: w.summary };
    }
    // Only what the rework changed: earlier flags are already on the pull request.
    const { flags: violations } = await verifyAndPush(ctx, { since: before.sha });
    const changes = testChanges(w);
    // The body as it is now: it may have been edited since the poll read it.
    if (changes.length) await gh.updatePullRequestBody(cfg, target, prBody.addTestChanges(await gh.pullRequestBody(cfg, target), changes));
    if (violations.length) {
      await gh.setDraft(cfg, target, true);
      park(say.reasons.reworkDraft(list(violations)));
    }
    await gh.removeLabel(cfg, target, cfg.triggers.review);
    return { outcome: 'done', detail: w.summary };
  },

  async merge(ctx) {
    const { deps: { gh, ws, cfg }, dir, target } = ctx;
    if ((await ws.mergeBase(dir)) === 'conflict') await resolveConflict(ctx);
    const { flags: violations } = await verifyAndPush(ctx);
    await gh.comment(cfg, target, say.merged); // marks the last push: older stops no longer count
    if (violations.length) {
      await gh.setDraft(cfg, target, true);
      park(say.reasons.mergeDraft(list(violations)));
    }
    await gh.removeLabel(cfg, target, cfg.triggers.merge);
    return { outcome: 'done', detail: 'merged the base branch' };
  },
};
