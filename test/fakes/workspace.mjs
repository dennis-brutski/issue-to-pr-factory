// An in-memory stand-in for the workspace handle (`workspace()` in lib/workspace.mjs),
// for unit tests of the stages and the loop. Every method returns a plain default;
// a test passes `over` to replace the ones it cares about. A contract test keeps its
// method names equal to the real handle's.
// ponytail: fixed answers, not a model of the branch; grow one if tests keep faking state by hand.
import { paths } from '../../lib/workspace.mjs';

export const BASE = 'b'.repeat(40);

// What againstBase gives: the branch judged against one base commit. `over` replaces
// changes(since), diff(paths, since) or messages(); `sha` is the base it was made with.
export function fakeView(over = {}, sha = BASE) {
  return {
    sha,
    changes: async () => [{ status: 'M', path: 'src/state.js' }],
    diff: async () => '',
    messages: async () => ['Fix undo'],
    ...over,
  };
}

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
    headInfo: async () => ({ sha: 'abc' }),
    againstBase: async () => fakeView(),
    isClean: async () => true,
    mergeBase: async () => 'clean',
    abortMerge: async () => {},
    mergeResolved: async () => true,
    push: async () => {},
    preparePush: async () => ({ sha: 'abc', reattached: false }),
    testsOnBase: async () => null,
    ...over,
  };
}
