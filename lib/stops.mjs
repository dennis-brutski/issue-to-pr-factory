// The factory inbox: the open items that wait for the owner, with the stop and what the owner said since. Pure: no I/O.
import { join } from 'node:path';
import { isFactory, isStop } from './comments.mjs';
import { issueOf, worktreeFor } from './names.mjs';
import { same } from './text.mjs';

/**
 * The newest stop comment by the owner, and the owner's own comments after it.
 * @param {{ author: string, body: string, at: string }[]} comments oldest first
 * @param {string} owner
 * @returns {{ stop: string | null, at: string | null, answers: string[] }} stop and at are null when there is no stop
 *   (the label was set by hand); answers are then all the owner's own comments
 */
export function stopOf(comments, owner) {
  const mine = comments.filter((c) => same(c.author, owner));
  const i = mine.findLastIndex((c) => isStop(c.body));
  const answers = mine.slice(i + 1).filter((c) => !isFactory(c.body)).map((c) => c.body);
  return i < 0 ? { stop: null, at: null, answers } : { stop: mine[i].body, at: mine[i].at, answers };
}

/**
 * Where an item's worktree would be; a factory pull request shares its issue's.
 * @param {{ number: number, kind: string, headRef: string | null }} item
 * @param {{ runDir: string }} cfg
 * @returns {string}
 */
export const worktreeOf = (item, cfg) => join(cfg.runDir, 'worktrees', worktreeFor(issueOf(item)));

/**
 * The target's stops: its open items labelled needs-human, oldest stop first, hand-set labels last.
 * @param {{ number: number, kind: string, title: string, body: string, labels: string[], headRef: string | null,
 *   comments: { author: string, body: string, at: string }[] }[]} items
 * @param {{ repo: string, owner: string, runDir: string, states: { needsHuman: string } }} cfg
 * @param {(path: string) => boolean} exists whether a worktree folder exists
 * @returns {{ number: number, kind: string, title: string, url: string, body: string, stop: string | null, answers: string[],
 *   worktree: string | null }[]} body is what the item asks for; worktree is null when the folder does not exist
 */
export function inboxOf(items, cfg, exists) {
  const time = (s) => (s.at === null ? Infinity : Date.parse(s.at));
  return items.filter((i) => i.labels.includes(cfg.states.needsHuman))
    .map((i) => {
      const { stop, at, answers } = stopOf(i.comments, cfg.owner);
      const worktree = worktreeOf(i, cfg);
      return { at, entry: { number: i.number, kind: i.kind, title: i.title,
        url: `https://github.com/${cfg.repo}/${i.kind === 'pr' ? 'pull' : 'issues'}/${i.number}`,
        body: i.body, stop, answers, worktree: exists(worktree) ? worktree : null } };
    })
    .sort((a, b) => time(a) - time(b) || 0) // two hand-set labels give NaN: keep their order
    .map((s) => s.entry);
}
