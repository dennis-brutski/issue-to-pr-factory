# Test cleanup: merge test files, remove duplicates

Date: 2026-11-24

## Why

Keep the repo maintainable. There are 125 unit and behaviour test files (737 tests, about 8,200 lines) for about 2,100 lines of code. Line coverage is already 100%, so tests are not missing. The problem is that the tests are spread out and repeat each other: most issues added their own small file (18 `stages-*`, 8 `screen-*`, 8 `workspace-*`, ...). When one behaviour changes, you have to hunt for its tests and fix the same check in several places.

## Goals

- One unit test file per `lib/` area, as `AGENTS.md` already says (`test/screen.test.mjs`, `test/stages.test.mjs`, ...).
- Behaviour tests grouped by topic in the same way (`fake-gh-*` into `fake-gh.test.mjs`, `stats-*` into `stats.test.mjs`, ...).
- Duplicate tests removed. Every deleted test is named, with the test that already covers it.
- Stop the sprawl from coming back: `prompts/_rules.md` no longer says "Adding new test files is expected".

## Non-goals

- No coverage tool in `package.json` or CI. Coverage is already 100%; the per-file coverage script is a throwaway helper.
- No new tests and no rewritten assertions. Untested branches (e.g. `checks.mjs` 75%, `confine.mjs` 88%) are left for later.
- No changes to code under `lib/`.

## Anti-goals

- A test that checks something no other test checks gets deleted. That is a failure even if `npm test` stays green.
- One huge diff that can't be reviewed.

## Approaches

- **A. Merge first, then remove duplicates by reading (picked).** Merging only moves tests, so it is safe and easy to review. With the siblings side by side in one file, duplicates are easy to spot.
- **B. Per-file coverage map first.** Gives suspects, not answers: covering the same lines is not checking the same thing, and the behaviour tests cover almost everything. Used only as a second opinion inside A, for the big areas (`stages`, `workspace`).
- **C. File the cleanup as factory issues.** Slow, every deletion is a draft anyway, and agents tend to add files, which is the habit this cleanup fixes.

## How

1. **Merge, one area per step.** Append each `<area>-*.test.mjs` to `<area>.test.mjs`, merge the imports, delete the old file. The test count stays the same and `npm test` passes after each step. Files that belong to an area under a different name go to their area (my calls, checked while merging: `last-stop*` and `held-out` go to `stages`, `dotfiles` goes to `verify`, `implement-model` goes to `stages` or `agent` depending on what it imports, and so on). Readme tests go into `readme.test.mjs`.
2. **Remove duplicates, one area per step.** Read the merged file and remove tests whose checks are fully covered by another test in the same file, or by a unit test in another file. For `stages` and `workspace`, a scratchpad script runs each test separately with `NODE_V8_COVERAGE` and lists the tests whose covered branches all appear in other tests too, which gives candidates to read. A behaviour test is never a reason to delete a unit test. Each step lists what was removed and why.
3. **Fix the source.** Dennis edits `prompts/_rules.md` (protected), changing line 5 to send new cases into the existing file for their area. `AGENTS.md` already says so.

Before and after counts (files, tests, lines, coverage per file) go in the final report. Coverage per file must not go down.

## Constraints

- `npm test` passes after every step.
- `test/fakes/workspace.mjs`, `test/behavior/fakes/` and `world.mjs` stay as they are; only `*.test.mjs` files move.
- Dennis commits. I make the changes one area at a time and stop for review between areas if Dennis wants that.

## Left to the builder

The order of areas (biggest first: `stages`, `workspace`, `screen`), and the destination for files whose prefix doesn't match their area.
