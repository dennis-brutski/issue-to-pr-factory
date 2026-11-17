import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promptInput } from './eligibility.mjs';
import { protectedPathViolations, attributionViolations, workflowChanges } from './brakes.mjs';

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
  return { protected: `${paths}${tests}`, checks };
}

export function renderPrompt(name, vars, cfg = {}) {
  vars = { ...targetVars(cfg), ...vars };
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
    item, deps, port, p, issueNumber, target,
    session: async (name, vars, schema, { readOnly = false } = {}) => {
      const before = readOnly ? await ws.headInfo(ctx.dir) : null;
      const input = promptInput(item, cfg, vars.since ?? null);
      const prompt = renderPrompt(name, {
        number: issueNumber, branch: p.branch, base: cfg.baseBranch, title: input.title, body: input.body || '(empty)',
        comments: input.comments.length ? input.comments.map((c) => `- ${c}`).join('\n') : '(none)', ...vars,
      }, cfg);
      log(`#${target} ${name} session started`);
      const r = await deps.runAgent({ cwd: ctx.dir, prompt, schema, readOnly, cfg, port, logFile: join(p.logs, `${Date.now()}-${++seq}-${name}.json`) });
      if (!r.ok) park(`The ${name} step failed: ${r.reason}`);
      if (readOnly && (!(await ws.isClean(ctx.dir)) || (await ws.headInfo(ctx.dir)).sha !== before.sha))
        park(`The ${name} step is read-only but changed files in the worktree.`);
      return r.output;
    },
  };

  await gh.addLabel(cfg, target, cfg.states.inProgress);
  try {
    ctx.dir = (await ws.ensureWorktree(root, issueNumber, cfg.baseBranch)).dir;
    // The agents' sandbox has no network, so the factory installs dependencies first.
    const setup = await deps.runSetup(ctx.dir, cfg, port, join(p.clone, '.git'));
    if (!setup.ok) park(`\`${setup.failed}\` failed in the worktree (setup):\n${fence(setup.output)}`);
    return await STAGES[stage](ctx);
  } catch (e) {
    const reason = e instanceof Park ? e.message : `The factory hit an error: ${e.message}`;
    try {
      const hasWork = ctx.dir && (await ws.commitMessagesAgainstBase(ctx.dir, cfg.baseBranch).catch(() => [])).length > 0;
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
async function verifyAndPush({ deps: { ws, cfg, runChecks }, dir, p, port }) {
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
  if (!checks.ok) park(`\`${checks.failed}\` failed when the factory ran the checks:\n\n${fence(checks.output)}`);
  await ws.push(dir, p.branch);
  return protectedPathViolations(changes, cfg);
}

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
    if (!promptInput(item, cfg, since).comments.length) park('There are no new comments from you since the last push.');
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
    const violations = protectedPathViolations(touched, cfg);
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
