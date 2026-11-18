// Issue number ↔ branch ↔ worktree folder: the one naming rule. Pure: no I/O.
const BRANCH = /^factory\/issue-(\d+)$/;
const WORKTREE = /^issue-(\d+)$/;
const number = (re, s) => { const m = re.exec(s ?? ''); return m ? Number(m[1]) : null; };

export const branchFor = (n) => `factory/issue-${n}`;
export const issueOfBranch = (ref) => number(BRANCH, ref);
export const worktreeFor = (n) => `issue-${n}`;
export const issueOfWorktree = (name) => number(WORKTREE, name);

// The issue an item belongs to: a factory pull request shares its issue's worktree.
export const issueOf = (item) => (item.kind === 'pr' && issueOfBranch(item.headRef)) || item.number;
