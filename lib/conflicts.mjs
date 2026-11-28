// Decides whether the factory merges the base branch into one of its own pull requests
// that conflicts, without a label, and which of them on auto-merge failed CI. Pure: no I/O.
import { issueOfBranch } from './names.mjs';
import { same } from './text.mjs';
/** @import { Config } from './settings.mjs' */
/** @import { Item } from './github.mjs' */

const skip = (reason) => ({ action: 'skip', reason });
/** @type {(item: Item, cfg: Pick<Config, 'repo' | 'owner'>) => boolean} */
const isFactoryPull = (item, cfg) => item.kind === 'pr' && same(item.headRepo, cfg.repo) && issueOfBranch(item.headRef) !== null && same(item.author, cfg.owner);

/**
 * @param {Item} item
 * @param {Pick<Config, 'repo' | 'owner' | 'states' | 'triggers'>} cfg
 */
export function conflictToResolve(item, cfg) {
  if (!isFactoryPull(item, cfg)) return skip('not a factory pull request opened by the owner');
  if (item.mergeable !== 'CONFLICTING') return skip('does not conflict');
  const labels = [...Object.values(cfg.states), ...Object.values(cfg.triggers)];
  if (item.labels.some((l) => labels.includes(l))) return skip('has a factory label');
  return { action: 'run', stage: 'merge' };
}

/**
 * Whether one of the factory's own pull requests has auto-merge on and its CI finished and failed.
 * Pending, passing or no checks, or auto-merge off: false.
 * @param {Item} item
 * @param {Pick<Config, 'repo' | 'owner'>} cfg
 * @returns {boolean}
 */
export function ciFailed(item, cfg) {
  return isFactoryPull(item, cfg) && !!item.autoMerge && ['FAILURE', 'ERROR'].includes(item.ci?.state);
}
