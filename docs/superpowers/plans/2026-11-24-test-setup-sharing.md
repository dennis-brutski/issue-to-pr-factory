# Test setup sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Declare identical setup helpers once per test file, remove `describe` groups that only existed to avoid a clash, and give the remaining groups clear names.

**Architecture:** Edit the merged test files only. A helper moves to the top of its file only when every copy has the same full text. A group loses its wrapper only when, after that, it has no hook and no declaration that differs from another one in the file.

**Tech Stack:** Node 25 `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-24-test-setup-sharing-design.md`

## Global Constraints

- `npm test` passes after each task with `ℹ tests 783`, `ℹ fail 0`.
- No test's name, inputs or assertions change. Every `test()` block keeps its name and body (whitespace aside); check with `$S/same.mjs` against `main` (`$S` = `/tmp/claude-1000/-home-dennis-git-issue-to-pr-factory/30e3f989-86f8-4f7b-bdd3-b36decc5103a/scratchpad`; recreate the `main` worktree at `$S/main` for the check and remove it after).
- "Identical" means the whole declaration, every line, is the same text, whitespace aside. The first line alone is not enough: the 17 `const issue = {` objects in `stages` start the same and differ below.
- Helpers stay in the test file that uses them. No new files.
- Only test files under `test/` change. No commits.

## Review Focus

1. **A hoisted helper that differed from one of its copies.** Example: `verify`'s `commit` has a `message = 'change'` parameter in one group only. Expected: the hoisted copy is the superset, and no caller relied on the shorter form. Check: `same.mjs` plus the suite.
2. **A name that now resolves to a different binding.** After unwrapping, a test that used the group's `T` or `config` now sees the top-level one. Expected: the value is the same, or the group stays wrapped. `stages` groups with `const config = factoryConfig;` stay wrapped, because the top level uses the fixture `config`.
3. **A hook that now reaches more tests.** A group with `beforeEach` keeps its wrapper (`verify`, `workspace`, `behavior/fake-gh`).
4. **Order-dependent shared state.** Run each changed file alone three times; it passes each time.
5. **A renamed group that clashes with another group in the same file.** Group names in a file stay unique.

---

### Task 1: Hoist identical helpers and remove clash-only groups

**Files:** modify only these, each one at a time:

| File | Hoist to top (if all copies are fully identical) | Groups to try to unwrap |
|---|---|---|
| `test/stages.test.mjs` | `ok`, `T = '2026-11-01T10:00:00Z'` (groups with extra names on that line keep the extras as their own `const`) | `tests-that-change-pr`, `readable`, `implement-model`, `draft-stop`, `comments`, `automerge`, `last-stop`, `last-stop-base-merge` (each only if its `issue`/`deps`/`gate`/`work`/`pr` match the top-level text) |
| `test/verify.test.mjs` | `ID`, `git`, `commit` (keep the `message = 'change'` parameter) | none: all have `beforeEach` |
| `test/workspace.test.mjs` | `ID`, `git`, `commitFile` | none: all have `beforeEach` |
| `test/behavior/fake-gh.test.mjs` | `BIN`, `cfg`, `stateFile`, `T` | none: all have `beforeEach` |
| `test/screen.test.mjs` | `noColour` | groups whose `T` and `setup` match the top level |
| `test/readme.test.mjs` | `section`, `mermaid` | groups whose `README` matches the top level |
| `test/prompts.test.mjs` | `root`, `read` | `skills` |
| `test/agent.test.mjs` | `base` | `budget`, `trim` |
| `test/look.test.mjs` | none (`cases` tables differ) | none |
| `test/github.test.mjs` | `cfg` | `pages` if `node` matches |
| `test/comments.test.mjs` | none | `protected-reasons` |
| `test/eligibility.test.mjs` | none | `eligibility` if its names do not clash with the top-level `T` and `issue` after unwrapping |
| `test/stats.test.mjs` | `c` | `usage`; `stats` if `cfg` and `pr` match |
| `test/confine.test.mjs` | `pairs` and `binds` become one helper, only if they return the same thing for the same arguments; keep the name `pairs` | none |
| `test/behavior/base-merge.test.mjs` | `ID` | `base-conflict` |
| `test/behavior/stats.test.mjs` | `STATS`, `OWNER` | `automerge`, and `usage` if `stats` matches |
| `test/behavior/tests-that-change.test.mjs` | `seed`, `changed`, `listed` | `summary` if `finished` matches |

When a group is unwrapped, take away its `describe(...)` line and its closing `});`, indent its lines two spaces less (lines inside multi-line template strings stay as they are), and keep its leading comment above its first test.

- [ ] **Step 1:** Do one file. Compare each hoisted declaration's full text with every copy before deleting the copies.
- [ ] **Step 2:** `node --test <file>` three times. Expected: pass, with the same count as before.
- [ ] **Step 3:** Repeat for every file in the table.
- [ ] **Step 4:** `npm test`. Expected: `ℹ tests 783`, `ℹ fail 0`. Then `same.mjs` against `main`. Expected: `missing 0`, or only the known `prompts-owner` one-line test (an artifact of the checker).

### Task 2: Rename unclear groups

**Files:** the files that still have `describe` groups after Task 1.

A group name says what its tests cover, in a few plain words. It is not an old file name. Names in one file are unique. Candidates from the review: `readable`, `skip`, `detached` and `comments` in `stages`; `usage` in `stages` and `stats`; `title` in `loop` and `screen`. Groups that wrap a file's own original tests (`verify`, `workspace`, `fake-gh`, `stats`, `eligibility`) get a name for what those tests cover, or lose their wrapper if Task 1 made it unnecessary.

- [ ] **Step 1:** Rename. Test names don't change, only `describe` names.
- [ ] **Step 2:** `npm test`. Expected: `ℹ tests 783`, `ℹ fail 0`.

### Task 3: Report

- [ ] **Step 1:** Count lines before and after (`cat test/*.test.mjs test/behavior/*.test.mjs | wc -l`, before = 7966).
- [ ] **Step 2:** Final whole-change review by a fresh reviewer with this Review Focus.
- [ ] **Step 3:** Report: lines saved, groups removed, helpers hoisted, names changed, and every case where copies looked identical but were not.
