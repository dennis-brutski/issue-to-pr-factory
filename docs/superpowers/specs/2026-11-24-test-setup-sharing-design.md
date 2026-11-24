# Test cleanup, part 2: share identical setup helpers

Date: 2026-11-24 · Follows `2026-11-24-test-cleanup-design.md`

## Why

The merge left each old file's setup in its own `describe` group, so merged files repeat helpers (`ok` 18 times in `stages`, `ID`/`git`/`commit` 3 times in `verify`) and carry groups whose only reason was a name clash. The goal stays the same: a repo that is easy to maintain.

## Goals

- A helper whose copies are identical is declared once, at the top of its test file.
- A `describe` group that only existed to avoid a clash, and has no hook or differing setup of its own, is removed; its tests sit at the top level.
- Group names that only meant something as file names get a name that says what the tests cover (`readable` → `pull request body`, `comments` in `stages` → something that is not confused with `comments.test.mjs`).

## Non-goals

- No shared builders with overrides (`issue({...})`, one `deps()` for all of `stages`). That is a separate step, if ever.
- No change to any test's inputs, assertions or names. `issue` objects, `beforeEach` setups and `deps`/`fakes` builders that differ stay where they are.
- No new helper files; helpers stay in the test file that uses them.

## Anti-goals

- A test that now gets a different value than before (a helper hoisted over one that differed slightly, a shadowed name that now resolves elsewhere).

## Approaches

- **A. Hoist identical helpers, drop clash-only groups, rename unclear groups (picked).** Test inputs stay exactly the same.
- B. A plus shared builders with overrides. Saves most, but rewrites every `stages` test's inputs; a wrong default changes what a test checks.
- C. Rename only. Leaves the copies.

## How

- Two copies count as identical only when their text is the same, whitespace aside. `verify`'s `commit` with an extra `message = 'change'` parameter counts as compatible: the hoisted copy keeps that parameter and the other callers never pass a third argument.
- `T = '2026-11-01T10:00:00Z'` is hoisted; groups that declare more (`T2`, `lines`, ...) keep those extra names.
- Check after each file: `npm test` passes with 783 tests, and every `test()` block still has the same name and body, as checked last time.

## Left to the builder

The new group names, and which near-identical copies (`pairs`/`binds` in `confine`) are truly the same.
