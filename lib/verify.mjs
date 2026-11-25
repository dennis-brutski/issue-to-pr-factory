// Judges a branch: every git read and brake call that decides whether the factory
// may go on. It only judges; it never pushes, opens pull requests or changes labels.
import { protectedPathViolations, attributionViolations, workflowChanges, skippedTests, strayDotfiles, additionsOnly } from './brakes.mjs';

const fence = (text) => '```\n' + String(text).replaceAll('```', "'''") + '\n```';
const list = (items) => items.map((x) => `- ${x}`).join('\n');

// Returns { park, flags }. park: why to stop, or null. flags: why the pull request is a draft.
// before: 'setup' (the branch as the run found it, before setup runs with network) or 'push'.
// since: a commit; only what changed after it and still differs from the base is flagged.
// testsThatChange: the test files the issue lists under "## Tests that change".
export async function verifyBranch(ws, cfg, dir, { since = null, before = 'push', testsThatChange = [] } = {}) {
  // Asked once: every read below judges against the same base commit.
  const at = { at: await ws.remoteBase(dir) };
  if (before === 'setup') {
    // No test folders: tests do not run in setup, so only protected files and folders count here.
    const found = protectedPathViolations(await ws.changesAgainstBase(dir, null, at), { ...cfg, testDirs: [] });
    const park = found.length
      ? `The branch changes protected files, so the factory did not run setup with network on it:\n${list(found)}\nReview them in \`${dir}\`; to go ahead, merge or revert them, then remove the label.`
      : null;
    return { park, flags: [] };
  }

  const attribution = attributionViolations(await ws.commitMessagesAgainstBase(dir, at));
  if (attribution.length) return { park: `Commits must not carry attribution lines:\n${list(attribution)}`, flags: [] };
  const changes = await ws.changesAgainstBase(dir, null, at);
  const dotfiles = strayDotfiles(changes);
  if (dotfiles.length) return { park: `The branch adds dotfiles or editor folders at the repo root that the base branch does not have, so the factory did not push it. They may hold your settings or logins:\n${list(dotfiles)}\nRemove them from the branch in \`${dir}\`, then remove the label.`, flags: [] };
  const workflows = workflowChanges(changes);
  if (workflows.length) {
    const diff = await ws.diffAgainstBase(dir, '.github/workflows/', null, at);
    return { park: `The branch changes CI workflow files, so the factory did not push it. Read the change and push it yourself if it is right:\n${list(workflows)}\n\n${fence(diff.slice(-4000))}`, flags: [] };
  }

  let judged = changes;
  if (since) {
    // Earlier flags are already on the pull request, and restoring a file to its base state is fine.
    const differ = new Set(changes.flatMap((c) => [c.path, c.oldPath]).filter(Boolean));
    judged = (await ws.changesAgainstBase(dir, since, at)).filter((c) => differ.has(c.path) || differ.has(c.oldPath));
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
    else if (c.status === 'M' && additionsOnly(await ws.diffAgainstBase(dir, c.path, since, at)))
      lifted.set(c, inside(c.path, cfg.testSupport) ? `test support extended, lines only added: ${c.path}` : `test cases added: ${c.path}`);
  }
  // Skips and focused tests added in the test folders, test support included, listed or not.
  const skips = cfg.testDirs?.length ? skippedTests(await ws.diffAgainstBase(dir, cfg.testDirs, since, at)) : [];
  // A lifted file that is also protected stays flagged.
  const flags = [...protectedPathViolations(judged.filter((c) => !lifted.has(c)), cfg), ...protectedPathViolations([...lifted.keys()], { ...cfg, testDirs: [] }), ...skips];
  // notes only when there are some, so the result stays { park, flags } otherwise.
  return { park: null, flags, ...(lifted.size ? { notes: [...lifted.values()] } : {}) };
}
