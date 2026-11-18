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
