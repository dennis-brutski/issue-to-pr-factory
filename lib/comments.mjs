// The factory's own GitHub comments. They are written and read back here only,
// so a change to the wording cannot silently break the reader. Pure: no I/O.

const MARK = '🏭';
const STOPPED = `${MARK} **Factory stopped`;

// A park for this says nothing about the code, so it never counts as the last stop.
export const NO_NEW_COMMENTS = 'There are no new comments from you since the last push.';

// `keptBranch`: the local branch that holds work so far, if any.
export const stopped = (stage, reason, needsHuman, keptBranch = null) =>
  `${STOPPED} (${stage}).**\n\n${reason}\n\nRemove the \`${needsHuman}\` label to try again.${keptBranch ? ` Work so far is kept on the factory's local branch \`${keptBranch}\`.` : ''}`;

export const didNotStart = (reason, needsHuman) =>
  `${MARK} **Factory did not start.**\n\nThe ${reason}. Check it, then remove the \`${needsHuman}\` label to approve it again.`;

export const explore = (writeup, easyToUndo, smallReach) =>
  `${MARK} **Factory explore write-up**\n\n${writeup}\n\nEasy to undo: ${easyToUndo ? 'yes' : 'no'} · Small reach: ${smallReach ? 'yes' : 'no'}`;

export const rework = (summary) => `${MARK} **Rework**\n\n${summary}`;

export const pullRequest = (url) => `${MARK} Pull request: ${url}`;

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

const same = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();

// The body of the newest stop comment by `owner` not older than `since` (ISO, or null for any time); '' when none.
export function lastStop(comments, since, owner) {
  const from = since ? Date.parse(since) : -Infinity;
  const stop = comments
    .filter((c) => same(c.author, owner) && c.body.startsWith(STOPPED) && !c.body.includes(NO_NEW_COMMENTS) && Date.parse(c.at) >= from)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .at(-1);
  return stop ? stop.body : '';
}
