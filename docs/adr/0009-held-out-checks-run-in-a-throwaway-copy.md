# 9. Held-out checks run in a throwaway copy of the worktree

Date: 2026-11-28 · Status: accepted · Adds to [ADR 0005](0005-the-factorys-git-runs-confined.md)

## Context

Held-out checks run tests that agents never see, kept in `heldOutDir` outside the run folder. Auto-merge relies on them: an agent can read and change the target's `checks`, but not these. They ran the branch's code with `heldOutDir` readable and the worktree writable, so that code could copy the held-out tests into the worktree (#243). A git-ignored folder such as `node_modules/.cache/x` hides them from `git clean -f -d` and from `isClean`. Outside `testsOnBase`, which runs only in `implement` with `testFiles` set, nothing cleaned up after the held-out checks at all, so in `rework` and `merge` even tracked and untracked files stayed. The next session on that worktree could read the tests and tune the code to them.

## Decision

- Before the held-out checks, the factory copies the worktree, ignored files included (`node_modules`, `.venv`, …), into a new folder in the system temp folder, outside the run folder: `cp -a --reflink=auto`. That is a reflink where the filesystem has one and a plain copy where it does not. `cp` runs confined: no network, home hidden, writes only to the copy (`inCopy` in `lib/workspace.mjs`).
- Never a hardlink copy (`cp -al`): a write to an existing file would reach the original.
- bwrap binds the copy at the worktree's own path, so absolute paths (venv shebangs, config files) still resolve. The copy's `.git` file is bound read-only there, the clone's git data read-only and `heldOutDir` read-only, as before.
- After the held-out checks, pass, fail or throw, the copy is deleted. Folders the checks made unwritable are made writable first.
- The normal checks still run in the worktree.

Considered and not taken: a read-only worktree with writable folders listed per target (every target needs its own list, and it breaks easily); deleting the ignored files that are new after the checks (it misses writes into existing files, and a deny-list is easy to get wrong).

## Consequences

Held-out checks may write anything in the copy: test results, caches, coverage. None of it reaches the worktree, so the next agent session never sees the held-out tests or anything made from them. That is why auto-merge can trust them: the code they passed was not tuned to them. Each held-out run costs a copy of the worktree, near zero with reflinks and up to some seconds for a large `node_modules` without them. Do not run held-out checks in the worktree itself, and do not make the copy with hardlinks.
