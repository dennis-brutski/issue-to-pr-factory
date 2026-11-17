// What a factory diff and its commits may contain. Pure: no I/O.
// changes: [{ status: 'A'|'M'|'D'|'R', path, oldPath? }] from `git diff --name-status -M`.

// Protected on every target; a target can add to these lists, never remove from them.
const BUILT_IN_FILES = ['AGENTS.md', 'CLAUDE.md'];
const BUILT_IN_DIRS = ['.github/', '.claude/'];
const WORKFLOWS = '.github/workflows/';

export function protectedPathViolations(changes, cfg = {}) {
  const files = [...BUILT_IN_FILES, ...(cfg.protectedFiles ?? [])];
  const dirs = [...BUILT_IN_DIRS, ...(cfg.protectedDirs ?? [])];
  const testDirs = cfg.testDirs ?? [];
  const isProtected = (p) => files.includes(p) || dirs.some((d) => p.startsWith(d));
  const isTest = (p) => testDirs.some((d) => p.startsWith(d));
  const out = [];
  for (const { status, path, oldPath } of changes) {
    const touched = [path, oldPath].filter(Boolean);
    const prot = touched.find(isProtected);
    if (prot) { out.push(`protected file changed: ${prot}`); continue; }
    // Adding tests is fine; changing, deleting or renaming an existing one is not.
    const existing = status === 'R' ? oldPath : path;
    if (status !== 'A' && isTest(existing)) out.push(`existing test changed (${status}): ${existing}`);
  }
  return out;
}

// CI workflow files the branch adds, changes, deletes or renames. GitHub runs a pushed
// branch's workflows at once, so the factory never pushes these.
export function workflowChanges(changes) {
  return [...new Set(changes.flatMap((c) => [c.oldPath, c.path]).filter((p) => p?.startsWith(WORKFLOWS)))];
}

export function attributionViolations(commitMessages) {
  return commitMessages
    .filter((m) => /co-authored-by|generated with|claude-session/i.test(m))
    .map((m) => `commit message carries an attribution line: "${m.split('\n')[0]}"`);
}
