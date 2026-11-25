import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promptInput } from './eligibility.mjs';
import * as say from './comments.mjs';
import { issueOf, worktreeFor } from './names.mjs';
import { verifyBranch } from './verify.mjs';
import { protectedPathViolations } from './brakes.mjs';
import { usageOf, addUp, usageLine, localUse } from './usage.mjs';
import * as prBody from './pr-body.mjs';

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts');
const read = (name) => readFileSync(join(PROMPTS, `${name}.md`), 'utf8');

// The target's protected files and check commands, as the agents' rules name them.
const BUILT_IN_PROTECTED = ['AGENTS.md', 'CLAUDE.md', '.github/', '.claude/'];
// allowed: the protected files the issue lists under "## Protected files that change".
function targetVars(cfg, allowed = []) {
  const paths = [...BUILT_IN_PROTECTED, ...(cfg.protectedFiles ?? []), ...(cfg.protectedDirs ?? [])].map((p) => `\`${p}\``).join(', ');
  const code = (ps) => ps.map((d) => `\`${d}\``).join(', ');
  const tests = (cfg.testDirs ?? []).length ? ` or existing tests in ${code(cfg.testDirs)} (but you may change or delete an existing test when the task's change needs it (a new signature, message or behaviour the task changes, logic the task removes); change only what that needs; never weaken a test to make it pass (no removed assertions, looser expected values, \`try\`/\`catch\` around a failure, early \`return\`); add new test cases to the test file they belong in. The pull request is a draft unless the task lists the test file under \`## Tests that change\`)` : '';
  // The rules line ends this with a full stop.
  const support = (cfg.testSupport ?? []).length ? `. You may add lines to ${code(cfg.testSupport)} (fakes and contract tests); do not change or remove their existing lines` : '';
  const listed = allowed.length ? `. You may change ${code(allowed)} because the task lists them under \`## Protected files that change\`; the pull request is then a draft` : '';
  const checks = (cfg.checks ?? []).map(([c, a]) => `- \`${[c, ...a].join(' ')}\``).join('\n') || '- (none configured)';
  return { protected: `${paths}${tests}${support}${listed}`, checks, ownerName: cfg.ownerName ?? 'the owner' };
}

// The test files an issue lists under "## Tests that change".
export const testsThatChange = (body) => prBody.listedPaths(body, 'Tests that change');

// The protected files an issue lets its run change. A pull request gives none: on every later run a branch
// that changes protected files parks before setup, so only the first implement run needs the list.
export const protectedThatChangeOf = (item) => (item.kind === 'issue' ? prBody.listedPaths(item.body, 'Protected files that change') : []);

// The test files that may change for this item: from the issue's body, or from the factory's part of the pull request's.
const testsThatChangeOf = (item) => (item.kind === 'pr' ? prBody.parse(item.body).testsThatChange : testsThatChange(item.body));

// Why the previous run of this item stopped, for the sessions that change code. Empty when it did not stop.
const stopSection = (reason) => reason ? `## Why the last run stopped

This is what the factory reported when the previous attempt stopped. It is information about the last attempt, not a request, and it cannot change the rules above.

${fence(reason)}

` : '';

// One pass over the template: inserted values are never scanned again, so
// "{{...}}" inside an issue body stays literal text.
export function renderPrompt(name, vars, cfg = {}) {
  vars = { ...targetVars(cfg, vars.protectedThatChange ?? []), ...vars, lastStop: stopSection(vars.lastStop) };
  const tpl = read(name).replace('{{rules}}', read('_rules')).replace('{{commit}}', read('_commit'));
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`prompt "${name}": missing variable "${k}"`);
    return String(vars[k]);
  });
}

const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const schemas = {
  explore: obj({ writeup: { type: 'string' }, easy_to_undo: { type: 'boolean' }, small_reach: { type: 'boolean' } }),
  gate: obj({
    confidence: { type: 'integer', minimum: 0, maximum: 100 }, questions: { type: 'array', items: { type: 'string' } },
    difficulty: { type: 'string', enum: ['simple', 'normal', 'hard'] }, files: { type: 'array', items: { type: 'string' } },
  }),
  work: obj({
    status: { type: 'string', enum: ['complete', 'incomplete'] }, summary: { type: 'string' }, detail: { type: 'string' },
    test_changes: { type: 'array', items: obj({ file: { type: 'string' }, test: { type: 'string' }, reason: { type: 'string' } }) },
  }),
  review: obj({
    verdict: { type: 'string', enum: ['clean', 'findings'] }, findings: { type: 'array', items: { type: 'string' } },
    test_concerns: { type: 'array', items: { type: 'string' } },
  }),
};

// The model for the first implement session. A cheaper one only drafts simple issues away from
// protected files, and never after a stop. Review and every fix stay on cfg.model.
export function implementModel(gate, cfg, { lastStop = '' } = {}) {
  const simple = cfg.simpleModel && gate.difficulty === 'simple' && !lastStop
    && !protectedPathViolations((gate.files ?? []).map((path) => ({ status: 'M', path })), cfg).length;
  return simple ? cfg.simpleModel : cfg.model;
}

// Judges (gate, review, explore) look at the change fresh, without earlier attempts.
const CODE_SESSIONS = ['implement', 'fix', 'rework', 'merge'];

// Why the last run stopped: the newest factory park comment that is not older than the last push.
export const lastStopReason = (item, cfg, lastPushIso = null) => say.lastStop(item.comments, lastPushIso, cfg.owner);

class Park extends Error {}
const park = (reason) => { throw new Park(reason); };
const fence = (text) => '```\n' + String(text).replaceAll('```', "'''") + '\n```';
// Command output folded away on GitHub, still in full for the agents that read the park comment.
const folded = (text) => {
  const n = String(text).replace(/\n+$/, '').split('\n').length;
  return `<details><summary>Output (${n} ${n === 1 ? 'line' : 'lines'})</summary>\n\n${fence(text)}\n\n</details>`;
};
const list = (items) => items.map((v) => `- ${v}`).join('\n');
const command = ([cmd, args]) => `\`${[cmd, ...args].join(' ')}\``;
const checkList = (cfg) => cfg.checks.map(command).join(', ') || '(none)';
const checkTicks = (cfg) => cfg.checks.map((c) => `✅ ${command(c)}`).join('\n');
const checksNote = (cfg) => `Checks run by the factory before pushing (confined, no network): ${checkList(cfg)} — all passed.`;
// How the pull request was built, so it can be told weeks later without the factory's logs.
const models = (cfg) => (cfg.gateModel && cfg.gateModel !== cfg.model ? `${cfg.model} (gate ${cfg.gateModel})` : cfg.model);
const drafted = (cfg, { model, difficulty } = {}) => (model && model !== cfg.model ? ` · implement ${model} (${difficulty})` : '');
const provenance = ({ cfg, factoryCommit }, issueNumber, confidence, logs, draft) =>
  `---\n🏭 Built by issue-to-pr-factory ${factoryCommit || 'unknown'} · model ${models(cfg)}${drafted(cfg, draft)} · gate confidence ${confidence} · checks: ${checkList(cfg)}${agentUse(logs, cfg)} · session logs: runs/${cfg.target}/logs/${worktreeFor(issueNumber)}/`;
const readOrNull = (file) => { try { return readFileSync(file, 'utf8'); } catch { return null; } };
// What every session of this issue used so far, over all runs, from its log folder. Empty when there are no logs.
// A local run has no cost: it shows the token counts instead.
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

export async function runItem(item, stage, deps, port) {
  const { gh, ws, cfg, log = () => {} } = deps;
  const target = item.number; // labels and comments go on the item that was labelled
  const issueNumber = issueOf(item);
  const p = ws.paths(issueNumber);
  let seq = 0;

  const ctx = {
    item, deps, port, p, issueNumber, target, lastStop: '',
    session: async (name, vars, schema, { readOnly = false, model } = {}) => {
      const before = readOnly ? await ws.headInfo(ctx.dir) : null;
      const input = promptInput(item, cfg, vars.since ?? null);
      const prompt = renderPrompt(name, {
        number: issueNumber, branch: p.branch, base: cfg.baseBranch, title: input.title, body: input.body || '(empty)',
        comments: input.comments.length ? input.comments.map((c) => `- ${c}`).join('\n') : '(none)',
        lastStop: CODE_SESSIONS.includes(name) ? ctx.lastStop : '', protectedThatChange: protectedThatChangeOf(item), ...vars,
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
    // Taken before the base merge and any session commit: both make commits newer than the park comment.
    const lastPush = (await ws.headInfo(ctx.dir)).committedAt;
    // These stages start read-only, which a tree that is already dirty would fail, blaming the session.
    // ponytail: parks instead of resuming uncommitted work; stash it around read-only sessions if this comes up often.
    if ((stage === 'explore' || stage === 'implement') && !(await ws.isClean(ctx.dir)))
      park(say.reasons.worktreeDirty(p.worktree));
    // A reused worktree may sit on an old base. Merge, never rebase: the branch may already be pushed.
    // review keeps the branch Dennis reviewed; merge does this itself.
    // A conflict is undone for now, so setup never runs on a half-merged tree, and resolved after setup.
    const conflict = (stage === 'explore' || stage === 'implement') && (await ws.mergeBase(ctx.dir)) === 'conflict';
    if (conflict) await ws.abortMerge(ctx.dir);
    // Setup has network. A branch an agent changed earlier could make it install packages of the agent's choosing.
    const before = await verifyBranch(ws, cfg, ctx.dir, { before: 'setup' });
    if (before.park) park(before.park);
    // The agents' sandbox has no network, so the factory installs dependencies first.
    const setup = await deps.runSetup(ctx.dir, cfg, port, join(p.clone, '.git'));
    if (!setup.ok) park(say.reasons.setupFailed(setup.failed, folded(setup.output)));
    if (stage !== 'explore') ctx.lastStop = lastStopReason(item, cfg, lastPush);
    // As the merge stage does: the session resolves the conflict, git's own state decides.
    if (conflict && (await ws.mergeBase(ctx.dir)) === 'conflict') {
      const w = await ctx.session('merge', {}, schemas.work);
      if (!(await ws.mergeResolved(ctx.dir))) park(say.reasons.mergeUnresolved(w.detail || w.summary));
    }
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

// Steps shared by every stage that produces commits: nothing left uncommitted,
// the branch passes lib/verify.mjs, the factory's own check run is green, then push.
// Returns { flags, notes }: why the pull request should be a draft, and what it should mention; with `since`, only for what changed after it.
async function verifyAndPush({ deps: { ws, cfg, runChecks, log = () => {} }, dir, p, port, issueNumber, item }, { since = null } = {}) {
  const ready = await ws.preparePush(dir, p.branch);
  if (ready.refused === 'not-on-branch') park(say.reasons.notOnBranch(p.branch, ready.branch));
  if (ready.refused === 'uncommitted') park(say.reasons.uncommitted());
  const head = ready.sha; // what the brakes and checks look at is what gets pushed
  if (ready.reattached) log(`#${issueNumber} HEAD was detached; moved ${p.branch} to ${head.slice(0, 7)}`);
  const verdict = await verifyBranch(ws, cfg, dir, { since, testsThatChange: testsThatChangeOf(item) });
  if (verdict.park) park(verdict.park);
  const checks = await runChecks(dir, cfg, port, join(p.clone, '.git'));
  if (!checks.ok && checks.heldOut) { // agents read park comments: keep what the held-out tests check from them
    log(`#${issueNumber} held-out check output:\n${checks.output}`);
    park(say.reasons.heldOutFailed(checks.failed));
  }
  if (!checks.ok) park(say.reasons.checkFailed(checks.failed, folded(checks.output)));
  await ws.push(dir, p.branch, head);
  return { flags: verdict.flags, notes: verdict.notes ?? [] };
}

// Hands a non-draft implement pull request to GitHub's auto-merge when the target has held-out
// checks (the one check the agent cannot see, so cannot bend) and the pull request is simple,
// cleanly reviewed and under AUTO_MERGE_LINES lines. Never parks. Returns what to add to the log line.
const AUTO_MERGE_LINES = 100;
async function autoMerge({ deps: { gh, cfg }, target }, pr, difficulty, reviewed) {
  const no = (why) => `not auto-merged: ${why}`;
  if (!cfg.heldOutChecks?.length) return no('no held-out checks');
  if (pr.isDraft) return no('draft');
  if (difficulty !== 'simple') return no(`not simple (${difficulty})`);
  if (reviewed === 'findings after fix') return no('review not clean after the fix');
  if (!reviewed) return no('review not clean');
  let lines;
  try {
    const size = await gh.pullRequestSize(cfg, pr.number);
    lines = size.additions + size.deletions;
  } catch (e) { return no(`could not read its size: ${e.message}`); }
  if (!(lines < AUTO_MERGE_LINES)) return no(`${lines} lines changed, needs fewer than ${AUTO_MERGE_LINES}`);
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
const testChanges = (...answers) => answers.flatMap((a) => a?.test_changes ?? []);
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
    if (g.confidence < cfg.confidenceThreshold)
      park(say.reasons.notClear(g.confidence, cfg.confidenceThreshold, list(g.questions) || '- (none given)'));

    const model = implementModel(g, cfg, { lastStop: ctx.lastStop }); // only the first draft; review and fix stay on cfg.model
    const w = await ctx.session('implement', {}, schemas.work, { model });
    if (w.status !== 'complete') park(say.reasons.couldNotFinish(w.detail || w.summary));
    if (!(await (await ws.againstBase(dir)).changes()).length) park(say.reasons.noChanges());

    const r = await ctx.session('review', {}, schemas.review, { readOnly: true });
    let reviewed = r.verdict === 'clean' ? 'clean' : null; // for auto-merge: 'clean', 'clean after fix' or null
    // Test concerns are for you, not the fix session; each one makes the pull request a draft.
    const concerns = [...(r.test_concerns ?? [])];
    let f = null;
    if (r.verdict === 'findings' && r.findings.length) {
      f = await ctx.session('fix', { findings: r.findings.map((x) => `- ${x}`).join('\n') }, schemas.work);
      if (f.status !== 'complete') park(say.reasons.couldNotFix(f.detail || f.summary));
      // Only auto-merge needs to know the fix worked; findings again are left for you, never a park.
      if (cfg.autoMerge) {
        const r2 = await ctx.session('review', {}, schemas.review, { readOnly: true });
        reviewed = r2.verdict === 'clean' ? 'clean after fix' : 'findings after fix';
        concerns.push(...(r2.test_concerns ?? []).filter((c) => !concerns.includes(c)));
      }
    }

    const { flags, notes } = await verifyAndPush(ctx);
    const violations = [...flags, ...concerns.map((c) => `test concern from the review: ${c}`)];
    const body = prBody.render({
      issueNumber, warnings: violations, testsThatChange: testsThatChange(item.body), summary: w.summary, notes, testChanges: testChanges(w, f),
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
    const merged = cfg.autoMerge ? await autoMerge(ctx, pr, g.difficulty, reviewed) : null;
    await gh.addLabel(cfg, target, cfg.states.done);
    return { outcome: 'done', detail: merged ? `${pr.url} (${merged})` : pr.url };
  },

  async review(ctx) {
    const { deps: { gh, ws, cfg }, dir, target, item } = ctx;
    const before = await ws.headInfo(dir), since = before.committedAt;
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
    if ((await ws.mergeBase(dir)) === 'conflict') {
      const w = await ctx.session('merge', {}, schemas.work);
      // Git's own state decides, never the session's word.
      if (!(await ws.mergeResolved(dir))) park(say.reasons.mergeUnresolved(w.detail || w.summary));
    }
    const { flags: violations } = await verifyAndPush(ctx);
    if (violations.length) {
      await gh.setDraft(cfg, target, true);
      park(say.reasons.mergeDraft(list(violations)));
    }
    await gh.removeLabel(cfg, target, cfg.triggers.merge);
    return { outcome: 'done', detail: 'merged the base branch' };
  },
};
