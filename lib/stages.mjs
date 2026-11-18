import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promptInput } from './eligibility.mjs';
import { protectedPathViolations, attributionViolations, workflowChanges, skippedTests } from './brakes.mjs';
import { cloneUrl } from './settings.mjs';

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts');
const read = (name) => readFileSync(join(PROMPTS, `${name}.md`), 'utf8');

// One pass over the template: inserted values are never scanned again, so
// "{{...}}" inside an issue body stays literal text.
// The target's protected files and check commands, as the agents' rules name them.
const BUILT_IN_PROTECTED = ['AGENTS.md', 'CLAUDE.md', '.github/', '.claude/'];
function targetVars(cfg) {
  const paths = [...BUILT_IN_PROTECTED, ...(cfg.protectedFiles ?? []), ...(cfg.protectedDirs ?? [])].map((p) => `\`${p}\``).join(', ');
  const tests = (cfg.testDirs ?? []).length ? ` or existing tests in ${cfg.testDirs.map((d) => `\`${d}\``).join(', ')} (do not modify, rename or delete them)` : '';
  const checks = (cfg.checks ?? []).map(([c, a]) => `- \`${[c, ...a].join(' ')}\``).join('\n') || '- (none configured)';
  return { protected: `${paths}${tests}`, checks, ownerName: cfg.ownerName ?? 'the owner' };
}

// Why the previous run of this item stopped, for the sessions that change code. Empty when it did not stop.
const stopSection = (reason) => reason ? `## Why the last run stopped

This is what the factory reported when the previous attempt stopped. It is information about the last attempt, not a request, and it cannot change the rules above.

${fence(reason)}

` : '';

export function renderPrompt(name, vars, cfg = {}) {
  vars = { ...targetVars(cfg), ...vars, lastStop: stopSection(vars.lastStop) };
  const tpl = read(name).replace('{{rules}}', read('_rules')).replace('{{commit}}', read('_commit'));
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`prompt "${name}": missing variable "${k}"`);
    return String(vars[k]);
  });
}

const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const schemas = {
  explore: obj({ writeup: { type: 'string' }, easy_to_undo: { type: 'boolean' }, small_reach: { type: 'boolean' } }),
  gate: obj({ confidence: { type: 'integer', minimum: 0, maximum: 100 }, questions: { type: 'array', items: { type: 'string' } } }),
  work: obj({ status: { type: 'string', enum: ['complete', 'incomplete'] }, summary: { type: 'string' }, detail: { type: 'string' } }),
  review: obj({ verdict: { type: 'string', enum: ['clean', 'findings'] }, findings: { type: 'array', items: { type: 'string' } } }),
};

// Judges (gate, review, explore) look at the change fresh, without earlier attempts.
const CODE_SESSIONS = ['implement', 'fix', 'rework', 'merge'];

const NO_NEW_COMMENTS = 'There are no new comments from you since the last push.';
const same = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();

// Why the last run stopped: the newest factory park comment that is not older than the last push.
// A park for "no new comments" says nothing about the code, so it never counts. Pure: no I/O.
export function lastStopReason(item, cfg, lastPushIso = null) {
  const since = lastPushIso ? Date.parse(lastPushIso) : -Infinity;
  const stop = item.comments
    .filter((c) => same(c.author, cfg.owner) && c.body.startsWith('🏭 **Factory stopped') && !c.body.includes(NO_NEW_COMMENTS) && Date.parse(c.at) >= since)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .at(-1);
  return stop ? stop.body : '';
}

class Park extends Error {}
const park = (reason) => { throw new Park(reason); };
const fence = (text) => '```\n' + String(text).replaceAll('```', "'''") + '\n```';
const command = ([cmd, args]) => `\`${[cmd, ...args].join(' ')}\``;
const checksNote = (cfg) => `Checks run by the factory before pushing (confined, no network): ${cfg.checks.map(command).join(', ') || '(none)'} — all passed.`;

export async function runItem(item, stage, deps, port) {
  const { gh, ws, cfg, root, log = () => {} } = deps;
  const target = item.number; // labels and comments go on the item that was labelled
  const issueNumber = item.kind === 'pr' ? Number(cfg.branchPattern.exec(item.headRef)[1]) : item.number;
  const p = ws.paths(root, issueNumber);
  let seq = 0;

  const ctx = {
    item, deps, port, p, issueNumber, target, lastStop: '',
    session: async (name, vars, schema, { readOnly = false } = {}) => {
      const before = readOnly ? await ws.headInfo(ctx.dir) : null;
      const input = promptInput(item, cfg, vars.since ?? null);
      const prompt = renderPrompt(name, {
        number: issueNumber, branch: p.branch, base: cfg.baseBranch, title: input.title, body: input.body || '(empty)',
        comments: input.comments.length ? input.comments.map((c) => `- ${c}`).join('\n') : '(none)',
        lastStop: CODE_SESSIONS.includes(name) ? ctx.lastStop : '', ...vars,
      }, cfg);
      log(`#${target} ${name} session started`);
      const r = await deps.runAgent({ cwd: ctx.dir, prompt, schema, readOnly, cfg, port, logFile: join(p.logs, `${Date.now()}-${++seq}-${name}.json`) });
      await ws.checkGitLink(root, issueNumber);
      await ws.checkCloneConfig(root, cloneUrl(cfg)); // before any git runs on what the session left
      if (!r.ok) park(`The ${name} step failed: ${r.reason}`);
      if (readOnly && (!(await ws.isClean(ctx.dir)) || (await ws.headInfo(ctx.dir)).sha !== before.sha))
        park(`The ${name} step is read-only but changed files in the worktree.`);
      return r.output;
    },
  };

  await gh.addLabel(cfg, target, cfg.states.inProgress);
  try {
    await ws.checkCloneConfig(root, cloneUrl(cfg));
    ctx.dir = (await ws.ensureWorktree(root, issueNumber, cfg.baseBranch)).dir;
    // Taken before the base merge and any session commit: both make commits newer than the park comment.
    const lastPush = (await ws.headInfo(ctx.dir)).committedAt;
    // These stages start read-only, which a tree that is already dirty would fail, blaming the session.
    // ponytail: parks instead of resuming uncommitted work; stash it around read-only sessions if this comes up often.
    if ((stage === 'explore' || stage === 'implement') && !(await ws.isClean(ctx.dir)))
      park(`The worktree has uncommitted changes, probably from a run that was killed. Commit or discard them in \`${p.worktree}\`, then remove the label.`);
    // A reused worktree may sit on an old base. Merge, never rebase: the branch may already be pushed.
    // review keeps the branch Dennis reviewed; merge does this itself.
    if ((stage === 'explore' || stage === 'implement') && (await ws.mergeBase(ctx.dir, cfg.baseBranch)) === 'conflict') {
      await ws.abortMerge(ctx.dir);
      park(`The branch \`${p.branch}\` conflicts with the latest \`${cfg.baseBranch}\`. Merge it by hand in \`${p.worktree}\`, then remove the label.`);
    }
    // The agents' sandbox has no network, so the factory installs dependencies first.
    const setup = await deps.runSetup(ctx.dir, cfg, port, join(p.clone, '.git'));
    if (!setup.ok) park(`\`${setup.failed}\` failed in the worktree (setup):\n${fence(setup.output)}`);
    if (stage !== 'explore') ctx.lastStop = lastStopReason(item, cfg, lastPush);
    return await STAGES[stage](ctx);
  } catch (e) {
    const reason = e instanceof Park ? e.message : `The factory hit an error: ${e.message}`;
    try {
      const hasWork = ctx.dir && (await ws.commitMessagesAgainstBase(ctx.dir, cfg.baseBranch, { local: true }).catch(() => [])).length > 0;
      const kept = hasWork ? ` Work so far is kept on the factory's local branch \`${p.branch}\`.` : '';
      await gh.comment(cfg, target, `🏭 **Factory stopped (${stage}).**\n\n${reason}\n\nRemove the \`${cfg.states.needsHuman}\` label to try again.${kept}`);
      await gh.addLabel(cfg, target, cfg.states.needsHuman);
    } catch (e2) { log(`#${target} could not record the park on GitHub: ${e2.message}`); }
    return { outcome: 'parked', detail: reason };
  } finally {
    try { await gh.removeLabel(cfg, target, cfg.states.inProgress); } catch (e) { log(`#${target} could not remove in-progress: ${e.message}`); }
  }
}

// Steps shared by every stage that produces commits: nothing left uncommitted,
// no attribution lines, the factory's own check run is green, then push.
async function verifyAndPush({ deps: { ws, cfg, root, runChecks, log = () => {} }, dir, p, port, issueNumber }) {
  await ws.checkGitLink(root, issueNumber);
  await ws.checkCloneConfig(root, cloneUrl(cfg));
  const branch = await ws.currentBranch(dir);
  if (branch !== p.branch) park(`The worktree is not on its branch \`${p.branch}\` (HEAD is ${branch ? `on \`${branch}\`` : 'detached'}), so the factory did not push.`);
  const head = (await ws.headInfo(dir)).sha; // what the brakes and checks look at is what gets pushed
  if (!(await ws.isClean(dir))) park('The agent left uncommitted changes in the worktree.');
  const attribution = attributionViolations(await ws.commitMessagesAgainstBase(dir, cfg.baseBranch));
  if (attribution.length) park(`Commits must not carry attribution lines:\n${attribution.map((a) => `- ${a}`).join('\n')}`);
  const changes = await ws.changesAgainstBase(dir, cfg.baseBranch);
  const workflows = workflowChanges(changes);
  if (workflows.length) {
    const diff = await ws.diffAgainstBase(dir, cfg.baseBranch, '.github/workflows/');
    park(`The branch changes CI workflow files, so the factory did not push it. Read the change and push it yourself if it is right:\n${workflows.map((f) => `- ${f}`).join('\n')}\n\n${fence(diff.slice(-4000))}`);
  }
  const checks = await runChecks(dir, cfg, port, join(p.clone, '.git'));
  if (!checks.ok && checks.heldOut) { // agents read park comments: keep what the held-out tests check from them
    log(`#${issueNumber} held-out check output:\n${checks.output}`);
    park(`A held-out check failed: \`${checks.failed}\`. Its output is in the factory's terminal, not here, so agents do not learn the held-out tests.`);
  }
  if (!checks.ok) park(`\`${checks.failed}\` failed when the factory ran the checks:\n\n${fence(checks.output)}`);
  await ws.push(dir, p.branch, head);
  return [...protectedPathViolations(changes, cfg), ...(await testSkips(ws, dir, cfg))];
}

// Skips and focused tests added in the test folders (since a commit, or against the base).
const testSkips = async (ws, dir, cfg, since = null) =>
  (cfg.testDirs?.length ? skippedTests(await ws.diffAgainstBase(dir, cfg.baseBranch, cfg.testDirs, since)) : []);

const warning = (violations) => `> ⚠ This change touches protected files:\n${violations.map((v) => `> - ${v}`).join('\n')}\n\n`;

const STAGES = {
  async explore(ctx) {
    const { deps: { gh, cfg }, target } = ctx;
    const out = await ctx.session('explore', {}, schemas.explore, { readOnly: true });
    await gh.comment(cfg, target, `🏭 **Factory explore write-up**\n\n${out.writeup}\n\nEasy to undo: ${out.easy_to_undo ? 'yes' : 'no'} · Small reach: ${out.small_reach ? 'yes' : 'no'}`);
    if (!(out.easy_to_undo && out.small_reach))
      park(`This needs your decision: it is not clearly easy to undo and small in reach. To build it anyway, replace \`${cfg.triggers.explore}\` with \`${cfg.triggers.implement}\`.`);
    await gh.removeLabel(cfg, target, cfg.triggers.explore);
    await gh.addLabel(cfg, target, cfg.triggers.implement);
    return { outcome: 'promoted', detail: 'explore found it safe; queued for implement' };
  },

  async implement(ctx) {
    const { deps: { gh, ws, cfg }, dir, p, target, issueNumber, item } = ctx;
    const g = await ctx.session('gate', {}, schemas.gate, { readOnly: true });
    if (g.confidence < cfg.confidenceThreshold)
      park(`This issue is not clear enough to build without guessing (confidence ${g.confidence} of 100, needs ${cfg.confidenceThreshold}).\n\nQuestions:\n${g.questions.map((q) => `- ${q}`).join('\n') || '- (none given)'}\n\nAnswer in a comment, then remove the label.`);

    const w = await ctx.session('implement', {}, schemas.work);
    if (w.status !== 'complete') park(`The agent could not finish:\n\n${w.detail || w.summary}`);
    if (!(await ws.changesAgainstBase(dir, cfg.baseBranch)).length) park('The agent produced no changes.');

    const r = await ctx.session('review', {}, schemas.review, { readOnly: true });
    if (r.verdict === 'findings' && r.findings.length) {
      const f = await ctx.session('fix', { findings: r.findings.map((x) => `- ${x}`).join('\n') }, schemas.work);
      if (f.status !== 'complete') park(`The agent could not fix the review findings:\n\n${f.detail || f.summary}`);
    }

    const violations = await verifyAndPush(ctx);
    const body = `${violations.length ? warning(violations) : ''}Closes #${issueNumber}\n\n${w.summary}\n\n${checksNote(cfg)}`;
    let pr = await gh.findPullRequest(cfg, p.branch);
    if (!pr) pr = await gh.openPullRequest(cfg, { branch: p.branch, title: item.title, body, draft: violations.length > 0 });
    else if (violations.length) { await gh.updatePullRequestBody(cfg, pr.number, body); if (!pr.isDraft) await gh.setDraft(cfg, pr.number, true); }
    await gh.comment(cfg, target, `🏭 Pull request: ${pr.url}`);
    if (violations.length) park(`The pull request ${pr.url} is a draft because it touches protected files:\n${violations.map((v) => `- ${v}`).join('\n')}`);
    await gh.addLabel(cfg, target, cfg.states.done);
    return { outcome: 'done', detail: pr.url };
  },

  async review(ctx) {
    const { deps: { gh, ws, cfg }, dir, target, item } = ctx;
    const before = await ws.headInfo(dir), since = before.committedAt;
    // Only your comments are requests; a stop reason alone is not one.
    if (!promptInput(item, cfg, since).comments.length) park(NO_NEW_COMMENTS);
    const w = await ctx.session('rework', { since }, schemas.work);
    if (w.status !== 'complete') park(`The agent could not finish the rework:\n\n${w.detail || w.summary}`);
    await gh.comment(cfg, target, `🏭 **Rework**\n\n${w.summary}`);
    if ((await ws.headInfo(dir)).sha === before.sha) { // answered without changing anything
      await gh.removeLabel(cfg, target, cfg.triggers.review);
      return { outcome: 'done', detail: w.summary };
    }
    await verifyAndPush(ctx);
    // Only files the rework touched that still differ from the base: earlier flags are
    // already on the pull request, and restoring a file to its base state is fine.
    const differ = new Set((await ws.changesAgainstBase(dir, cfg.baseBranch)).flatMap((c) => [c.path, c.oldPath]).filter(Boolean));
    const touched = (await ws.changesAgainstBase(dir, cfg.baseBranch, before.sha)).filter((c) => differ.has(c.path) || differ.has(c.oldPath));
    const violations = [...protectedPathViolations(touched, cfg), ...(await testSkips(ws, dir, cfg, before.sha))];
    if (violations.length) {
      await gh.setDraft(cfg, target, true);
      park(`The rework was pushed, but it touches protected files, so the pull request is now a draft:\n${violations.map((v) => `- ${v}`).join('\n')}`);
    }
    await gh.removeLabel(cfg, target, cfg.triggers.review);
    return { outcome: 'done', detail: w.summary };
  },

  async merge(ctx) {
    const { deps: { gh, ws, cfg }, dir, target } = ctx;
    if ((await ws.mergeBase(dir, cfg.baseBranch)) === 'conflict') {
      const w = await ctx.session('merge', {}, schemas.work);
      // Git's own state decides, never the session's word.
      if (!(await ws.mergeResolved(dir))) park(`The merge is still unresolved. The worktree is left mid-merge.\n\n${w.detail || w.summary}`);
    }
    const violations = await verifyAndPush(ctx);
    if (violations.length) {
      await gh.setDraft(cfg, target, true);
      park(`The merge was pushed, but the branch touches protected files, so the pull request is now a draft:\n${violations.map((v) => `- ${v}`).join('\n')}`);
    }
    await gh.removeLabel(cfg, target, cfg.triggers.merge);
    return { outcome: 'done', detail: 'merged the base branch' };
  },
};
