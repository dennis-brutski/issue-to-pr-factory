// Home dotfiles and editor folders a branch adds at the repo root. Pure: no I/O.
// The agents' sandbox puts stand-ins for these in the worktree (bound over /dev/null),
// so `git status` shows them; committed, they could carry the user's settings or logins.
// changes: from changesAgainstBase, so 'A' (or a rename's new path) is not on the base branch.
// onBase: from pathsOnBase (folders end in '/'). A folder the base already tracks, such as a
// target's own .vscode/ or .claude/skills/, may get new files.
const FILES = ['.bashrc', '.bash_profile', '.bash_login', '.bash_logout', '.profile', '.zshrc', '.zprofile', '.zshenv',
  '.gitconfig', '.git-credentials', '.netrc', '.ripgreprc', '.mcp.json'];
const DIRS = ['.claude', '.idea', '.vscode', '.config', '.ssh', '.gnupg', '.aws'];

const top = (path) => path.split('/')[0];
const stray = (path, onBase) => (path.includes('/') ? DIRS.includes(top(path)) && !onBase.has(`${top(path)}/`) : FILES.includes(path) || DIRS.includes(path));

export function strayDotfiles(changes, onBase = new Set()) {
  return changes.filter((c) => (c.status === 'A' || c.status === 'R') && stray(c.path, onBase)).map((c) => c.path);
}
