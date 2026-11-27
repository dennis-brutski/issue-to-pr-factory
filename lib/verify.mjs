// Judges a branch: every git read and brake call that decides whether the factory
// may go on. It only judges; it never pushes, opens pull requests or changes labels.
import { protectedPathViolations, attributionViolations, workflowChanges, skippedTests, strayDotfiles, additionsOnly, secretViolations, addedLines } from './brakes.mjs';
import { approveSetup } from './comments.mjs';
import { fence, list } from './text.mjs';

// Returns { park, flags }. park: why to stop, or null. flags: why the pull request is a draft.
// before: 'setup' (the branch as the run found it, before setup runs with network) or 'push'.
// since: a commit; only what changed after it and still differs from the base is flagged.
// testsThatChange: the test files the issue lists under "## Tests that change".
// approvals: the commits the owner approved setup for in their own comments (ADR 0007).
export async function verifyBranch(ws, cfg, dir, { since = null, before = 'push', testsThatChange = [], approvals = [] } = {}) {
  // Asked once: every read below judges against the same base commit.
  const base = await ws.againstBase(dir);
  if (before === 'setup') {
    // No test folders: tests do not run in setup, so only protected files and folders count here.
    const setupCfg = { ...cfg, testDirs: [] };
    const found = protectedPathViolations(await base.changes(), setupCfg);
    if (!found.length) return { park: null, flags: [] };
    // An approval holds while the protected files are exactly as in the approved commit. A sha git does not know fails the diff: not approved.
    for (const sha of approvals) {
      if (!/^[0-9a-f]{40}$/.test(sha)) continue;
      const after = await base.changes(sha).catch(() => null);
      if (after && !protectedPathViolations(after, setupCfg).length) return { park: null, flags: [] };
    }
    const { sha: head } = await ws.headInfo(dir);
    return {
      park: `The branch changes protected files, so the factory did not run setup with network on it:\n${list(found)}\nReview them in \`${dir}\`; to go ahead, merge or revert them, then remove the label.`
        + `\n\nOr, once you have read them and they are right, approve setup for the branch as it is now, at ${head}, with this comment, then remove the label:\n\n${fence(approveSetup(head))}`,
      flags: [],
    };
  }

  const messages = await base.messages();
  const attribution = attributionViolations(messages);
  if (attribution.length) return { park: `Commits must not carry attribution lines:\n${list(attribution)}`, flags: [] };
  // The findings name where and what kind, never the matched text: the park message is posted on GitHub.
  const secrets = secretViolations(addedLines(await base.diff([])), messages);
  if (secrets.length) return { park: `The branch adds what looks like a secret, so the factory did not push it:\n${list(secrets)}\nRemove it from the files and commits in \`${dir}\`, then remove the label.`, flags: [] };
  const changes = await base.changes();
  const dotfiles = strayDotfiles(changes);
  if (dotfiles.length) return { park: `The branch adds dotfiles or editor folders at the repo root that the base branch does not have, so the factory did not push it. They may hold your settings or logins:\n${list(dotfiles)}\nRemove them from the branch in \`${dir}\`, then remove the label.`, flags: [] };
  const workflows = workflowChanges(changes);
  if (workflows.length) {
    const diff = await base.diff('.github/workflows/');
    return { park: `The branch changes CI workflow files, so the factory did not push it. Read the change and push it yourself if it is right:\n${list(workflows)}\n\n${fence(diff.slice(-4000))}`, flags: [] };
  }

  let judged = changes;
  if (since) {
    // Earlier flags are already on the pull request, and restoring a file to its base state is fine.
    const differ = new Set(changes.flatMap((c) => [c.path, c.oldPath]).filter(Boolean));
    judged = (await base.changes(since)).filter((c) => differ.has(c.path) || differ.has(c.oldPath));
  }
  // Existing tests that may change without a draft, each with the note that says why:
  // test files the issue lists under "## Tests that change", and files that only gained lines
  // (new test cases; fakes and contract tests the rules ask agents to extend).
  const inside = (p, dirs) => (dirs ?? []).some((d) => p.startsWith(d));
  const lifted = new Map();
  for (const c of judged) {
    const existing = c.status === 'R' ? c.oldPath : c.path;
    if (!inside(existing, cfg.testDirs) && !inside(existing, cfg.testSupport)) continue;
    if (c.status !== 'A' && testsThatChange.some((p) => p === c.path || p === c.oldPath)) lifted.set(c, `test changed as the issue asks (${c.status}): ${existing}`);
    else if (c.status === 'M' && additionsOnly(await base.diff(c.path, since)))
      lifted.set(c, inside(c.path, cfg.testSupport) ? `test support extended, lines only added: ${c.path}` : `test cases added: ${c.path}`);
  }
  // Skips and focused tests added in the test folders, test support included, listed or not.
  const skips = cfg.testDirs?.length ? skippedTests(await base.diff(cfg.testDirs, since)) : [];
  // A lifted file that is also protected stays flagged.
  const flags = [...protectedPathViolations(judged.filter((c) => !lifted.has(c)), cfg), ...protectedPathViolations([...lifted.keys()], { ...cfg, testDirs: [] }), ...skips];
  // notes only when there are some, so the result stays { park, flags } otherwise.
  return { park: null, flags, ...(lifted.size ? { notes: [...lifted.values()] } : {}) };
}
