// What a factory diff and its commits may contain. Pure: no I/O.
// changes: [{ status: 'A'|'M'|'D'|'R', path, oldPath? }] from `git diff --name-status -M`.

const PROTECTED_FILES = ['playwright.config.js', 'package.json', 'package-lock.json', 'AGENTS.md', 'CLAUDE.md'];
const PROTECTED_DIRS = ['.github/', '.claude/'];
const TEST_DIRS = ['test/', 'e2e/'];

const isProtected = (p) => PROTECTED_FILES.includes(p) || PROTECTED_DIRS.some((d) => p.startsWith(d));
const isTest = (p) => TEST_DIRS.some((d) => p.startsWith(d));

export function protectedPathViolations(changes) {
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

export function attributionViolations(commitMessages) {
  return commitMessages
    .filter((m) => /co-authored-by|generated with|claude-session/i.test(m))
    .map((m) => `commit message carries an attribution line: "${m.split('\n')[0]}"`);
}
