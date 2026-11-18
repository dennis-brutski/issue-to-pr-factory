// Which session a prompt starts and for which issue, as the fake claude sees it.
// The session comes from the prompt's first line, `<!-- session: <name> -->`; the issue
// from the worktree folder the session runs in (`.../issue-<n>`). Prompts written by hand
// in tests may have no marker and run outside a worktree: for them, the old heading match
// and the `#<n>` on the first line still work.
import { basename } from 'node:path';

const MARKER = /^<!-- session: (\w+) -->$/;
const HEADINGS = [['# Can issue', 'gate'], ['# Implement', 'implement'], ['# Review the change', 'review'], ['# Fix review', 'fix'],
  ['# Rework', 'rework'], ['# Resolve the merge', 'merge'], ['# Explore', 'explore']];

export function sessionOf(prompt, cwd) {
  const first = prompt.split('\n')[0];
  const session = MARKER.exec(first)?.[1] ?? HEADINGS.find(([p]) => first.startsWith(p))?.[1] ?? null;
  const fromDir = /^issue-(\d+)$/.exec(basename(cwd))?.[1], fromHeading = /#(\d+)/.exec(first)?.[1];
  return { session, issue: Number(fromDir ?? fromHeading) };
}
