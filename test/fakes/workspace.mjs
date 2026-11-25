// An in-memory stand-in for the workspace handle (`workspace()` in lib/workspace.mjs),
// for unit tests of the stages and the loop. Every method returns a plain default;
// a test passes `over` to replace the ones it cares about. A contract test keeps its
// method names equal to the real handle's.
// ponytail: fixed answers, not a model of the branch; grow one if tests keep faking state by hand.
import { basename } from 'node:path';
import { paths } from '../../lib/workspace.mjs';

export const T = '2026-11-01T10:00:00Z';

export function fakeWorkspace(over = {}, root = '/f') {
  return {
    paths: (n) => paths(root, n),
    checkClone: async () => {},
    ensureClone: async () => {},
    hasRemoteBranch: async () => true,
    pathsOnBase: async () => new Set(),
    ignoredOnBase: async () => new Set(),
    ensureWorktree: async (n) => ({ dir: paths(root, n).worktree, created: true }),
    removeWorktree: async () => {},
    listWorktrees: async () => [],
    headInfo: async () => ({ sha: 'abc', committedAt: T }),
    remoteBase: async () => 'b'.repeat(40),
    changesAgainstBase: async () => [{ status: 'M', path: 'src/state.js' }],
    diffAgainstBase: async () => '',
    commitMessagesAgainstBase: async () => ['Fix undo'],
    isClean: async () => true,
    mergeBase: async () => 'clean',
    abortMerge: async () => {},
    mergeResolved: async () => true,
    push: async () => {},
    currentBranch: async (dir) => `factory/${basename(dir)}`,
    attachBranch: async () => false,
    removeSandboxLeftovers: async () => {},
    ...over,
  };
}
