// Decides whether an open issue is ready for the owner to approve for the factory. Pure: no I/O.
import { waitsFor } from './eligibility.mjs';

/**
 * What holds an open issue back from being built now.
 * @param {{ number: number, body: string, labels: string[], blockedBy: { number: number, repo: string, open: boolean }[],
 *   subIssues: { total: number, completed: number }, pullRequests: { number: number, open: boolean }[] }} issue
 * @param {{ repo: string, triggers: Record<string, string>, states: Record<string, string> }} cfg
 * @param {number[]} openIssues the repo's open issue numbers
 * @returns {string | null} the reason, such as `waits for #3`; null when it is ready
 */
export function readiness(issue, cfg, openIssues) {
  const factoryLabels = [...Object.values(cfg.triggers), ...Object.values(cfg.states)];
  const label = issue.labels.find((l) => factoryLabels.includes(l));
  if (label) return `has ${label}`;
  const waits = waitsFor(issue, cfg, openIssues);
  if (waits.length) return `waits for ${waits.join(', ')}`;
  const openSubIssues = issue.subIssues.total - issue.subIssues.completed;
  if (openSubIssues > 0) return `has ${openSubIssues} open sub-issue${openSubIssues === 1 ? '' : 's'}`;
  const pr = issue.pullRequests.find((p) => p.open);
  if (pr) return `has an open pull request: #${pr.number}`;
  return null;
}
