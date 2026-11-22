// Judges a branch: every git read and brake call that decides whether the factory
// may go on. It only judges; it never pushes, opens pull requests or changes labels.
import { protectedPathViolations, attributionViolations, workflowChanges, skippedTests, strayDotfiles } from './brakes.mjs';

const fence = (text) => '```\n' + String(text).replaceAll('```', "'''") + '\n```';
const list = (items) => items.map((x) => `- ${x}`).join('\n');

// Returns { park, flags }. park: why to stop, or null. flags: why the pull request is a draft.
// before: 'setup' (the branch as the run found it, before setup runs with network) or 'push'.
// since: a commit; only what changed after it and still differs from the base is flagged.
export async function verifyBranch(ws, cfg, dir, { since = null, before = 'push' } = {}) {
  if (before === 'setup') {
    // No test folders: tests do not run in setup, so only protected files and folders count here.
    const found = protectedPathViolations(await ws.changesAgainstBase(dir), { ...cfg, testDirs: [] });
    const park = found.length
      ? `The branch changes protected files, so the factory did not run setup with network on it:\n${list(found)}\nReview them in \`${dir}\`; to go ahead, merge or revert them, then remove the label.`
      : null;
    return { park, flags: [] };
  }

  const attribution = attributionViolations(await ws.commitMessagesAgainstBase(dir));
  if (attribution.length) return { park: `Commits must not carry attribution lines:\n${list(attribution)}`, flags: [] };
  const changes = await ws.changesAgainstBase(dir);
  const dotfiles = strayDotfiles(changes);
  if (dotfiles.length) return { park: `The branch adds dotfiles or editor folders at the repo root that the base branch does not have, so the factory did not push it. They may hold your settings or logins:\n${list(dotfiles)}\nRemove them from the branch in \`${dir}\`, then remove the label.`, flags: [] };
  const workflows = workflowChanges(changes);
  if (workflows.length) {
    const diff = await ws.diffAgainstBase(dir, '.github/workflows/');
    return { park: `The branch changes CI workflow files, so the factory did not push it. Read the change and push it yourself if it is right:\n${list(workflows)}\n\n${fence(diff.slice(-4000))}`, flags: [] };
  }

  let judged = changes;
  if (since) {
    // Earlier flags are already on the pull request, and restoring a file to its base state is fine.
    const differ = new Set(changes.flatMap((c) => [c.path, c.oldPath]).filter(Boolean));
    judged = (await ws.changesAgainstBase(dir, since)).filter((c) => differ.has(c.path) || differ.has(c.oldPath));
  }
  // Skips and focused tests added in the test folders.
  const skips = cfg.testDirs?.length ? skippedTests(await ws.diffAgainstBase(dir, cfg.testDirs, since)) : [];
  return { park: null, flags: [...protectedPathViolations(judged, cfg), ...skips] };
}
