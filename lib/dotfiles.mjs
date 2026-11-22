// Home dotfiles and editor folders a branch adds at the repo root. Pure: no I/O.
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
