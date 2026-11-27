// The factory's own GitHub comments. They are written and read back here only,
// so a change to the wording cannot silently break the reader. Pure: no I/O.
import { same } from './text.mjs';

const MARK = '🏭';
const STOPPED = `${MARK} **Factory stopped`;

// A park for this says nothing about the code, so it never counts as the last stop.
export const NO_NEW_COMMENTS = 'There are no new comments from you since the last push.';

// A draft is already pushed: trying again would only build the same draft, so its stop says what to do instead.
const draftAdvice = (needsHuman, review) =>
  `Read these changes in the pull request. If they are right, mark it ready and merge it. To have them changed, comment on the pull request and add \`${review}\`. Removing \`${needsHuman}\` would only build the same draft again.`;

// `keptBranch`: the local branch that holds work so far, if any. `review`: the label that asks for a rework.
export const stopped = (stage, reason, needsHuman, keptBranch = null, review = 'agent:review') =>
  `${STOPPED} (${stage}).**\n\n${reason}\n\n${DRAFT.test(reason) ? draftAdvice(needsHuman, review)
    : `Remove the \`${needsHuman}\` label to try again.${keptBranch ? ` Work so far is kept on the factory's local branch \`${keptBranch}\`.` : ''}`}`;

const DID_NOT_START = `${MARK} **Factory did not start`;
export const didNotStart = (reason, needsHuman) =>
  `${DID_NOT_START}.**\n\nThe ${reason}. Check it, then remove the \`${needsHuman}\` label to approve it again.`;

// A stop reason: the text the owner reads, the short label stats counts it by, and what finds
// that label in a stop comment. `match` must keep finding older comments too.
const reason = (label, match, text) => Object.assign(text, { label, match });
// The old wording stays in DRAFT so stats still counts older stop comments.
const DRAFT = /touches protected files|changes files you should check/, COULD_NOT = /agent could not (finish|fix)/;

// Every stop reason lib/stages.mjs writes. Arguments that are lists or command output come formatted.
export const reasons = {
  stepFailed: reason('agent session failed', /step failed:/, (step, why) => `The ${step} step failed: ${why}`),
  readOnlyChanged: reason('read-only step changed files', /step is read-only but changed files/,
    (step) => `The ${step} step is read-only but changed files in the worktree.`),
  worktreeDirty: reason('worktree dirty', /worktree has uncommitted changes/,
    (worktree) => `The worktree has uncommitted changes, probably from a run that was killed. Commit or discard them in \`${worktree}\`, then remove the label.`),
  conflictsWithBase: reason('conflicts with base', /conflicts with the latest/,
    (branch, base, worktree) => `The branch \`${branch}\` conflicts with the latest \`${base}\`. Merge it by hand in \`${worktree}\`, then remove the label.`),
  setupFailed: reason('setup failed', /failed in the worktree \(setup\)/, (cmd, output) => `\`${cmd}\` failed in the worktree (setup):\n\n${output}`),
  factoryError: reason('factory error', /^The factory hit an error/, (message) => `The factory hit an error: ${message}`),
  notOnBranch: reason('worktree not on its branch', /worktree is not on its branch/,
    (branch, head) => `The worktree is not on its branch \`${branch}\` (HEAD is ${head ? `on \`${head}\`` : 'detached'}), so the factory did not push.`),
  uncommitted: reason('agent left uncommitted changes', /agent left uncommitted changes/, () => 'The agent left uncommitted changes in the worktree.'),
  heldOutFailed: reason('a held-out check failed', /held-out check failed/,
    (cmd) => `A held-out check failed: \`${cmd}\`. Its output is in the factory's terminal, not here, so agents do not learn the held-out tests.`),
  checkFailed: reason('a check failed', /failed when the factory ran the checks/, (cmd, output) => `\`${cmd}\` failed when the factory ran the checks:\n\n${output}`),
  needsDecision: reason('needs a decision (explore)', /needs your decision/,
    (explore, implement) => `This needs your decision: it is not clearly easy to undo and small in reach. To build it anyway, replace \`${explore}\` with \`${implement}\`.`),
  notClear: reason('not clear enough', /not clear enough to build without guessing/,
    (confidence, needs, questions, contradictions = '', missing = '') => [
      `This issue is not clear enough to build without guessing (confidence ${confidence} of 100, needs ${needs}).`,
      ...(contradictions ? [`Contradictions:\n\n${contradictions}`] : []), `Questions:\n\n${questions}`,
      ...(missing ? [`Missing:\n\n${missing}`] : []), 'Answer in a comment, then remove the label.',
    ].join('\n\n')),
  couldNotFinish: reason('agent could not finish', COULD_NOT, (detail) => `The agent could not finish:\n\n${detail}`),
  noChanges: reason('no changes', /produced no changes/, () => 'The agent produced no changes.'),
  couldNotFix: reason('agent could not finish', COULD_NOT, (detail) => `The agent could not fix the review findings:\n\n${detail}`),
  draft: reason('protected files (draft)', DRAFT, (url, list) => `The pull request ${url} is a draft because it changes files you should check:\n\n${list}`),
  couldNotRework: reason('agent could not finish', COULD_NOT, (detail) => `The agent could not finish the rework:\n\n${detail}`),
  reworkDraft: reason('protected files (draft)', DRAFT,
    (list) => `The rework was pushed, but it changes files you should check, so the pull request is now a draft:\n\n${list}`),
  mergeUnresolved: reason('merge unresolved', /merge is still unresolved/,
    (detail) => `The merge is still unresolved. The worktree is left mid-merge.\n\n${detail}`),
  mergeDraft: reason('protected files (draft)', DRAFT,
    (list) => `The merge was pushed, but the branch changes files you should check, so the pull request is now a draft:\n\n${list}`),
};

// Reasons lib/verify.mjs, lib/agent.mjs and lib/eligibility.mjs write; their text stays there.
const elsewhere = (label, match) => ({ label, match });
const WORKFLOWS = elsewhere('workflow files', /CI workflow files/); // verify
const EDITED = elsewhere('edited after approval', /(edited|changed) after it was approved/); // eligibility
const BUDGET = elsewhere('budget cap', /spent its budget/); // agent
const TIMED_OUT = elsewhere('timed out / max turns / usage limit', /step failed: (timed out|the agent session stopped)|usage limit/i); // agent
const ATTRIBUTION = elsewhere('attribution lines', /must not carry attribution lines/); // verify
const BEFORE_SETUP = elsewhere('protected files (before setup)', /did not run setup with network/); // verify
const NO_REPORT = elsewhere('no status report', /ended without the required status report/); // agent

// Checked in order: the first match wins. The older labels keep the order they always had.
const r = reasons;
const LABELS = [
  r.notClear, r.needsDecision, r.heldOutFailed, r.checkFailed, r.setupFailed, r.draft, WORKFLOWS, EDITED,
  r.couldNotFinish, r.noChanges, BUDGET, TIMED_OUT, r.worktreeDirty, r.conflictsWithBase, r.factoryError,
  ATTRIBUTION, BEFORE_SETUP, r.readOnlyChanged, r.notOnBranch, r.uncommitted, r.mergeUnresolved, NO_REPORT,
  r.stepFailed,
];

// A stop comment → its short label. The reason is the paragraph after the heading.
export function stopLabel(body) {
  const text = body.split(/\n\s*\n/)[1]?.trim() ?? '';
  const hit = LABELS.find(({ match }) => match.test(text));
  return hit ? hit.label : `other: ${text.replace(/\s+/g, ' ').slice(0, 60)}`;
}

// A stop comment stats counts: stopped or did not start, and not a park for want of new comments.
export const isCountedStop = (body) => (body.startsWith(STOPPED) || body.startsWith(DID_NOT_START)) && !body.includes(NO_NEW_COMMENTS);

// The first line of an explore write-up comment.
export const WRITEUP_HEADING = `${MARK} **Factory explore write-up**`;
export const explore = (writeup, easyToUndo, smallReach) =>
  `${WRITEUP_HEADING}\n\n${writeup}\n\nEasy to undo: ${easyToUndo ? 'yes' : 'no'} · Small reach: ${smallReach ? 'yes' : 'no'}`;

const REWORK = `${MARK} **Rework**`;
export const rework = (summary) => `${REWORK}\n\n${summary}`;
export const isRework = (body) => String(body).startsWith(REWORK);

export const pullRequest = (url) => `${MARK} Pull request: ${url}`;

// Posted after the merge stage pushed: it marks the last push.
export const merged = `${MARK} Merged the base branch and pushed.`;

// The first line stats.mjs counts by; a failed hand-over must never start with it.
const AUTO_MERGE = `${MARK} **Auto-merge**`;

// `reviewed`: 'clean' or 'clean after fix'.
export const autoMerged = (url, { reviewed, lines }) =>
  `${AUTO_MERGE}\n\n${url} was handed to auto-merge: simple · review ${reviewed} · ${lines} ${lines === 1 ? 'line' : 'lines'} changed · not a draft. GitHub merges it once it can; revert it if you do not like it.`;

export const autoMergeFailed = (url, reason) =>
  `${MARK} **Auto-merge did not start**\n\nGitHub refused auto-merge for ${url}:\n\n\`\`\`\n${String(reason).replaceAll('```', "'''")}\n\`\`\`\n\nMerge it by hand.`;

// The pull request number an Auto-merge comment names, or null for any other comment.
export function autoMergedPull(body) {
  const [first, , text = ''] = String(body).split('\n');
  const m = first === AUTO_MERGE ? /\/pull\/(\d+) was handed to auto-merge/.exec(text) : null;
  return m ? Number(m[1]) : null;
}

// gh posts the factory's comments as the owner; this tells them from the owner's own.
export const isFactory = (body) => String(body).startsWith(MARK);

/**
 * Whether a comment is one of the factory's stops: it stopped, or it did not start.
 * @param {string} body
 * @returns {boolean}
 */
export const isStop = (body) => String(body).startsWith(STOPPED) || String(body).startsWith(DID_NOT_START);

const newest = (comments) => comments.toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1);

// The commits the owner approved setup for (ADR 0007): a line `approve protected setup <sha>`, with the full sha,
// in the owner's own comments. Factory comments quote that line, so they never count; agents cannot post comments.
// The stop before setup shows this line, and the parser below reads it: one definition for both.
export const approveSetup = (sha) => `approve protected setup ${sha}`;
const APPROVAL = new RegExp(`^${approveSetup('([0-9a-f]{40})')}[ \\t]*\\r?$`, 'gm');
export function setupApprovals(comments, owner) {
  return comments.filter((c) => same(c.author, owner) && !isFactory(c.body))
    .flatMap((c) => [...String(c.body).matchAll(APPROVAL)].map((m) => m[1]));
}

// The last push: when `owner` posted the newest factory comment that is not a stop (pull request, rework, merge).
// GitHub sets that time and agents cannot post comments, unlike a commit date. ISO, or null when there is none.
export function lastPush(comments, owner) {
  const push = newest(comments.filter((c) => same(c.author, owner) && isFactory(c.body) && !isStop(c.body)));
  return push ? push.at : null;
}

/**
 * The newest explore write-up by `owner`, without its heading line.
 * @param {{ author: string, body: string, at: string }[]} comments
 * @param {string} owner
 * @returns {string} '' when there is none
 */
export function lastWriteup(comments, owner) {
  const w = newest(comments.filter((c) => same(c.author, owner) && c.body.startsWith(WRITEUP_HEADING)));
  return w ? w.body.slice(WRITEUP_HEADING.length).trim() : '';
}

// The body of the newest stop comment by `owner` not older than the last push; '' when none.
export function lastStop(comments, owner) {
  const since = lastPush(comments, owner);
  const from = since ? Date.parse(since) : -Infinity;
  const stop = newest(comments
    .filter((c) => same(c.author, owner) && c.body.startsWith(STOPPED) && !c.body.includes(NO_NEW_COMMENTS) && Date.parse(c.at) >= from));
  return stop ? stop.body : '';
}
