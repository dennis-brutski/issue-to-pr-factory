// Decides whether the factory merges the base branch into one of its own pull requests
// that conflicts, without a label. Pure: no I/O.
import { issueOfBranch } from './names.mjs';
import { same } from './text.mjs';
/** @import { Config } from './settings.mjs' */
/** @import { Item } from './github.mjs' */

const skip = (reason) => ({ action: 'skip', reason });

/**
 * @param {Item} item
 * @param {Pick<Config, 'repo' | 'owner' | 'states' | 'triggers'>} cfg
 */
export function conflictToResolve(item, cfg) {
  if (item.kind !== 'pr') return skip('not a pull request');
  if (!same(item.headRepo, cfg.repo) || issueOfBranch(item.headRef) === null) return skip('not a factory pull request');
  if (!same(item.author, cfg.owner)) return skip('not opened by the owner');
  if (item.mergeable !== 'CONFLICTING') return skip('does not conflict');
  const labels = [...Object.values(cfg.states), ...Object.values(cfg.triggers)];
  if (item.labels.some((l) => labels.includes(l))) return skip('has a factory label');
  return { action: 'run', stage: 'merge' };
}
