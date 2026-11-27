// What a factory diff and its commits may contain. Pure: no I/O.
// changes: [{ status: 'A'|'M'|'D'|'R', path, oldPath? }] from `git diff --name-status -M`.

// Protected on every target; a target can add to these lists, never remove from them.
export const BUILT_IN_FILES = ['AGENTS.md', 'CLAUDE.md'];
export const BUILT_IN_DIRS = ['.github/', '.claude/'];
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

// Added lines that skip a test or run only some: checks that pass that way prove nothing.
const SKIP = /\b(?:it|test|describe)\.(?:skip|only|todo)\b|\bx(?:it|describe)\(|[{,]\s*(?:skip|only|todo)\s*:|@pytest\.mark\.skip/;

// What is inside quotes is data (a test that commits a skipped test as its fixture), not code.
const STRINGS = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

export function skippedTests(diff) {
  return diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++') && SKIP.test(l.replace(STRINGS, "''")))
    .map((l) => `test skipped or singled out: ${l.slice(1).trim().slice(0, 120)}`);
}

// Home dotfiles and editor folders a branch adds at the repo root.
// The agents' sandbox puts stand-ins for these in the worktree (bound over /dev/null),
// so `git status` shows them; committed, they could carry the user's settings or logins.
// changes: from changesAgainstBase, so 'A' (or a rename's new path) is not on the base branch.
const FILES = ['.bashrc', '.bash_profile', '.bash_login', '.bash_logout', '.profile', '.zshrc', '.zprofile', '.zshenv',
  '.gitconfig', '.git-credentials', '.netrc', '.ripgreprc', '.mcp.json'];
const DIRS = ['.claude', '.idea', '.vscode', '.config', '.ssh', '.gnupg', '.aws'];

const stray = (path) => (path.includes('/') ? DIRS.includes(path.split('/')[0]) : FILES.includes(path) || DIRS.includes(path));

export function strayDotfiles(changes) {
  return changes.filter((c) => (c.status === 'A' || c.status === 'R') && stray(c.path)).map((c) => c.path);
}

// True when a `git diff` only adds lines. A removed line, or a change with no text hunk
// (binary, mode only), is not. A removed "--i;" shows as "---i;": only lines before the
// first hunk of a file are headers.
export function additionsOnly(diff) {
  let inHunk = false, hunks = 0;
  for (const l of diff.split('\n')) {
    if (l.startsWith('diff --git ')) inHunk = false;
    else if (l.startsWith('@@')) { inHunk = true; hunks++; }
    else if (!inHunk && /^(Binary files|GIT binary patch)/.test(l)) return false;
    else if (inHunk && l.startsWith('-')) return false;
  }
  return hunks > 0;
}
