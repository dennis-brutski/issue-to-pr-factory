# Test cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One test file per area, with duplicate tests removed and nothing lost.

**Architecture:** First merge each group of `<area>-*.test.mjs` files into `<area>.test.mjs`, which only moves tests. Then read each merged file and delete tests that only repeat another test. A throwaway coverage script in the scratchpad points out likely duplicates in `stages` and `workspace`.

**Tech Stack:** Node 25 `node:test`, built-in `--experimental-test-coverage`.

**Spec:** `docs/superpowers/specs/2026-11-24-test-cleanup-design.md`

## Global Constraints

- `npm test` passes after every task. Baseline: `ℹ tests 783`, `ℹ pass 783`, `ℹ fail 0`.
- Merge tasks keep the test count at exactly 783. Only dedupe tasks lower it.
- No changes under `lib/`, `prompts/`, `test/fakes/`, `test/behavior/fakes/`, `test/behavior/world.mjs`, `test/behavior/steps.mjs`, `test/fixtures/`, or any protected file listed in `AGENTS.md`.
- No dependencies, no changes to `package.json`.
- No commits: Dennis commits. No review stops between areas; one review at the end.
- Assertions in a test that is kept are never edited. A test is either kept as it is or deleted.

## Review Focus

1. **Top-level hooks clash after merging.** All `workspace-*` and `verify-*` files have top-level `before`/`after`. Appended as they are, those hooks would run for every test in the merged file. Wrap each appended file's body in `describe('<old file name without .test.mjs>', () => { ... })` whenever it has top-level hooks or top-level `let`/`const` names that clash. Check: the per-file test count of the merged file equals the sum of the old files.
2. **Duplicate helper names.** Two old files both declare `function commit(...)`, `const cfg = ...` and so on. Keep one copy at the top of the merged file if the copies are the same; otherwise scope them inside the `describe` block from point 1.
3. **A deleted test that was the only check of something.** A test counts as a duplicate only if another kept test asserts the same outcome for the same input case, not just because it covers the same lines. Check: coverage per file (line %, branch %) in the final report is no lower than the baseline.
4. **Async tests that relied on running in their own process.** `node --test` runs each file in its own process, so merged tests now share module state (env vars, `process.chdir`, module-level caches). Check: run the merged file on its own 3 times; it passes each time.
5. **Old file names in issues.** Open issues that list old files under `## Tests that change` would point at files that no longer exist. Checked on 2026-11-24: none do. Recheck once with `gh issue list --state open --json number,body` at the end.

---

### Task 0: Baseline

**Files:** scratchpad only (`$S` = `/tmp/claude-1000/-home-dennis-git-issue-to-pr-factory/30e3f989-86f8-4f7b-bdd3-b36decc5103a/scratchpad`)

- [ ] **Step 1:** `node --test --experimental-test-coverage test/*.test.mjs test/behavior/*.test.mjs > $S/coverage-before.txt 2>&1`. Expected: `ℹ tests 783`, `ℹ fail 0`.
- [ ] **Step 2:** Save `ls test/*.test.mjs test/behavior/*.test.mjs | wc -l` (125) and `cat test/*.test.mjs test/behavior/*.test.mjs | wc -l` to `$S/counts-before.txt`.

### Task 1: Merge unit test files

**Files:** for each row, append the sources to the target, then delete the sources.

| Target | Sources |
|---|---|
| `test/stages.test.mjs` | `stages-*.test.mjs` (17), `last-stop.test.mjs`, `last-stop-base-merge.test.mjs`, `implement-model.test.mjs`, `held-out.test.mjs` |
| `test/workspace.test.mjs` | `workspace-*.test.mjs` (7) |
| `test/screen.test.mjs` | `screen-*.test.mjs` (7) |
| `test/readme.test.mjs` | `readme-*.test.mjs` (5) |
| `test/stats.test.mjs` | `stats-*.test.mjs` (4) |
| `test/prompts.test.mjs` (new) | `prompts-*.test.mjs` (5) |
| `test/loop.test.mjs` | `loop-*.test.mjs` (4) |
| `test/comments.test.mjs` | `comments-*.test.mjs` (3) |
| `test/verify.test.mjs` | `verify-*.test.mjs` (2) |
| `test/look.test.mjs` | `look-*.test.mjs` (2) |
| `test/github.test.mjs` | `github-*.test.mjs` (2) |
| `test/brakes.test.mjs` | `brakes-*.test.mjs` (2), `dotfiles.test.mjs` (it imports only `lib/brakes.mjs`) |
| `test/agent.test.mjs` | `agent-*.test.mjs` (2) |
| `test/startup.test.mjs` | `startup-*.test.mjs` |
| `test/settings.test.mjs` | `settings-*.test.mjs` |
| `test/eligibility.test.mjs` | `eligibility-*.test.mjs` |
| `test/confine.test.mjs` | `confine-*.test.mjs` |

`held-out.test.mjs` imports `stages`, `agent` and `checks`; it goes to `stages` because it tests a stage. `conflicts`, `usage`, `plan`, `sync-skills` and `names` stay as they are.

Merge rule for each source: its imports go into the target's import lines (one import per module, names joined), its leading comment goes on top of its tests, and its body goes after the target's existing tests, wrapped as Review Focus 1 and 2 say.

- [ ] **Step 1:** Do one row. Run `node --test test/<target>.test.mjs` three times. Expected: pass, and the test count equals the sum of the old files' counts (`node --test <old files>` before deleting them).
- [ ] **Step 2:** Repeat for every row.
- [ ] **Step 3:** `npm test`. Expected: `ℹ tests 783`, `ℹ fail 0`.

### Task 2: Merge behaviour test files

**Files** (all under `test/behavior/`):

| Target | Sources |
|---|---|
| `fake-gh.test.mjs` | `fake-gh-pages.test.mjs`, `fake-gh-stats.test.mjs`, `fake-gh-titles.test.mjs` |
| `stats.test.mjs` | `stats-automerge.test.mjs`, `stats-usage.test.mjs` |
| `tests-that-change.test.mjs` | `tests-that-change-summary.test.mjs`, `test-changes.test.mjs` |
| `poll.test.mjs` (new) | `poll-running.test.mjs`, `poll-started.test.mjs` |
| `base-merge.test.mjs` | `base-conflict.test.mjs`, `base-ref.test.mjs` |

Leave the other behaviour files alone; they are one scenario each. The merge rule is the same as in Task 1.

- [ ] **Step 1:** Do each row; run the target file alone three times. Expected: pass, with a count equal to the sum of the old files.
- [ ] **Step 2:** `npm test`. Expected: `ℹ tests 783`, `ℹ fail 0`.

### Task 3: Duplicate finder (throwaway)

**Files:** Create `$S/dupes.mjs`. Not in the repo.

**Interface:** `node $S/dupes.mjs test/stages.test.mjs lib/stages.mjs`. It prints one line per test whose covered branch set for the given lib file is a subset of the union of the other tests' sets in that test file: `<test name>  ⊆  <names of the tests that cover it>`.

- [ ] **Step 1:** List the test names (`node --test --test-reporter=tap <file>`, lines `# Subtest: `). For each name, run `node --test --experimental-test-coverage --test-reporter=lcov --test-name-pattern="^<escaped name>$" <file>` and collect the `BRDA` lines with a hit count above 0 and the `DA` lines with a hit count above 0 for the lib file.
- [ ] **Step 2:** Check on a known case: make two copies of one test in a temp copy of the file. Expected: both are listed as covered by the other.
- [ ] **Step 3:** Run it for `stages` and for `workspace`, and save the output to `$S/dupes-stages.txt` and `$S/dupes-workspace.txt`.

### Task 4: Remove duplicates

**Files:** every merged target from Tasks 1–2, plus the unmerged unit files.

- [ ] **Step 1:** For each file, read every test. Delete a test only if another kept test (same file, or a unit test elsewhere) asserts the same outcome for the same input case. For `stages` and `workspace`, start from the finder's list, but the finder only suggests; reading decides. A behaviour test is never a reason to delete a unit test.
- [ ] **Step 2:** For each deletion, add a line to `$S/removed.md`: `file — deleted test name — kept test that covers it`.
- [ ] **Step 3:** After each file, run `node --test <file>`. Expected: pass.

### Task 5: Final report

- [ ] **Step 1:** `node --test --experimental-test-coverage test/*.test.mjs test/behavior/*.test.mjs > $S/coverage-after.txt 2>&1`. Expected: `ℹ fail 0`; for every lib file, line % and branch % are at or above `coverage-before.txt`. If one dropped, restore the deleted tests that covered it.
- [ ] **Step 2:** Recheck open issues for old test file names (Review Focus 5).
- [ ] **Step 3:** Report to Dennis: files, tests and lines before → after; the contents of `removed.md`; the suggested line 5 for `prompts/_rules.md`: "Add new test cases to the existing test file for their area; create a new test file only for a new area."
