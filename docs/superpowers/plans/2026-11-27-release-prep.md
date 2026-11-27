# Release prep, Part 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The by-hand half of the release prep: what a new user or a reviewer hits first is fixed, in one pull request.

**Architecture:** Small, separate fixes in existing modules; no new modules. Behaviour changes in `lib/loop.mjs` go test first; the rest are text, config and file moves checked by the existing suite.

**Tech Stack:** Node 26, `node:test`, Biome, TypeScript `checkJs`.

**Spec:** `docs/superpowers/specs/2026-11-27-release-prep-design.md` (Part 1). Part 2 (three factory issues) is not in this plan.

## Global Constraints

- No runtime dependency, no new dev dependency (AGENTS.md rule 2).
- Match the style of each file; plain short wording in messages and comments (AGENTS.md rules 5, 6).
- Protected files may change here: this is Dennis's own change, not an agent's.
- `npm test`, `npm run lint`, `npm run typecheck` pass after every task.
- Commits: only when Dennis says so; short imperative subject; no trailers of any kind.
- One branch from `main`: `release-prep`.

## Review Focus

1. **The lock file holds no number or garbage** (`''`, `abc`): `acquireLock` must take it over as stale, not throw. Pinned in Task 2.
2. **The label call fails when a run does not start:** no comment is posted, so the next poll can try again without a second comment. Pinned in Task 3.
3. **The label succeeds and the comment fails:** the item carries `agent:needs-human` with no explanation; the log line says it could not be parked. Accepted; pinned in Task 3 so it stays logged.
4. **The prompt's protected list after Task 4:** still names `AGENTS.md`, `CLAUDE.md`, `.github/`, `.claude/` in that order. Pinned in Task 4.
5. **A reference to the renamed ADR left behind:** `grep -rn "ADR 0006\|0006-owner"` outside `node_modules/` and `runs/` finds only the dev-tools record. Checked in Task 5.

---

### Task 1: The bwrap startup error points to the README

**Files:**
- Modify: `lib/loop.mjs:126` (in `preflight`)
- Test: `test/loop.test.mjs` (next to `preflight fails closed when the sandbox probe fails`)

- [ ] **Step 1: Write the failing test**

```js
test('the sandbox error names the probe and points to the README, not a plan', async () => {
  const e = await preflight(fakes({ failing: ['bwrap'] }).deps).catch((x) => x);
  assert.match(e.message, /bwrap --ro-bind \/ \/ --dev \/dev --unshare-net true/);
  assert.match(e.message, /Getting started.*README/);
  assert.doesNotMatch(e.message, /plan/i);
});
```

- [ ] **Step 2: Run it, expect FAIL** — `node --test --test-name-pattern="sandbox error names" test/loop.test.mjs`
- [ ] **Step 3: Change the message** to: `the sandbox cannot start (\`bwrap --ro-bind / / --dev /dev --unshare-net true\` failed), so agents would run uncontained. See "Getting started" in the README.`
- [ ] **Step 4: Run it, expect PASS;** then `npm test`.

### Task 2: The lock message says how to get out

**Files:**
- Modify: `lib/loop.mjs` (`acquireLock`)
- Test: `test/loop.test.mjs`

**Interfaces:** `acquireLock(file: string): () => void` unchanged; only the error text and stale handling change.

- [ ] **Step 1: Write the failing tests**

```js
test('a live lock names the file to delete if the pid is not the factory', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'factory-lock-')), 'factory.lock');
  const release = acquireLock(file);
  assert.throws(() => acquireLock(file), (e) => /already running \(pid \d+\)/.test(e.message) && e.message.includes(file));
  release();
});
test('a lock file without a pid is stale', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'factory-lock-')), 'factory.lock');
  for (const text of ['', 'abc']) { writeFileSync(file, text); acquireLock(file)(); }
});
```

- [ ] **Step 2: Run them; expect the first to FAIL** (the second may already pass: it pins Review Focus 1).
- [ ] **Step 3: Extend the message** to `already running (pid <n>). If that process is not the factory, delete <file> and start again.` The existing test's `/already running \(pid \d+\)/` must still match.
- [ ] **Step 4: Run, expect PASS;** then `npm test`.

### Task 3: Label before comment when a run does not start

**Files:**
- Modify: `lib/loop.mjs` (`tick`, the `c.action === 'park'` branch)
- Test: `test/loop.test.mjs`

- [ ] **Step 1: Write the failing tests.** Use an issue edited after approval: `issue(3, { author: 'mallory', bodyEditedAt: T2 })` (label at `T`, so `classify` parks it).

```js
test('a run that does not start is labelled before it is commented on', async () => {
  const d = fakes({ candidates: [issue(3, { author: 'mallory', bodyEditedAt: T2 })] });
  const calls = [];
  d.deps.gh.addLabel = async (c, n, l) => { calls.push(`label ${l}`); };
  d.deps.gh.comment = async () => { calls.push('comment'); };
  await tick(d.deps, new Map());
  assert.deepEqual(calls, ['label agent:needs-human', 'comment']);
});
test('a failed label posts no comment, so the next poll does not repeat it', async () => {
  const d = fakes({ candidates: [issue(3, { author: 'mallory', bodyEditedAt: T2 })] });
  d.deps.gh.addLabel = async () => { throw new Error('GitHub is down'); };
  await tick(d.deps, new Map());
  assert.deepEqual(d.comments, []);
  assert.ok(d.logs.some((l) => l === '#3 could not be parked: GitHub is down'));
});
test('a failed comment after the label is logged', async () => {
  const d = fakes({ candidates: [issue(3, { author: 'mallory', bodyEditedAt: T2 })] });
  d.deps.gh.comment = async () => { throw new Error('GitHub is down'); };
  await tick(d.deps, new Map());
  assert.deepEqual(d.labelsAdded, ['3:agent:needs-human']);
  assert.ok(d.logs.some((l) => l === '#3 could not be parked: GitHub is down'));
});
```

- [ ] **Step 2: Run, expect the first two to FAIL.**
- [ ] **Step 3: Swap the two awaits** in the park branch (`addLabel` first, then `comment`); the `try`/`catch` and log line stay.
- [ ] **Step 4: Run, expect PASS;** then `npm test` (behaviour tests in `test/behavior/` that read the fake `gh`'s call order may need nothing; if one asserts comment-before-label, that test changes as this task's behaviour change needs — name it in the report).

### Task 4: One built-in protected list

**Files:**
- Modify: `lib/brakes.mjs:5-6` (export), `lib/stages.mjs:19-22` (import, drop `BUILT_IN_PROTECTED`)
- Test: `test/prompts.test.mjs`

**Interfaces:** Produces `export const BUILT_IN_FILES = ['AGENTS.md', 'CLAUDE.md']` and `export const BUILT_IN_DIRS = ['.github/', '.claude/']` from `lib/brakes.mjs`. `targetVars` uses `[...BUILT_IN_FILES, ...BUILT_IN_DIRS, ...cfg.protectedFiles, ...cfg.protectedDirs]`.

- [ ] **Step 1: Write the test** (pins Review Focus 4; passes before and after, it guards the move):

```js
test('the rules name the built-in protected paths, as the brakes do', () => {
  const p = renderPrompt('implement', vars, {});
  assert.match(p, /`AGENTS\.md`, `CLAUDE\.md`, `\.github\/`, `\.claude\/`/);
});
```
Use the file's existing `vars` for `implement`.

- [ ] **Step 2: Run it, expect PASS.**
- [ ] **Step 3: Export the two lists from `brakes.mjs`; import them in `stages.mjs`; delete `BUILT_IN_PROTECTED`.**
- [ ] **Step 4: `npm test`, expect PASS.**

### Task 5: Leftovers, ADR number, package and Node 26

No new tests: text, config and file moves. The existing suite and the greps below are the check.

**Files:**
- Modify: `factory.mjs:35-37` (delete the "older factory" check, and `lockHolder` from its import if unused there), `.gitignore` (delete `repo/`, `worktrees/`, `logs/`, `factory.lock`)
- Delete: the empty `worktrees/` folder at the repo root
- Rename: `docs/adr/0006-owner-may-approve-setup-for-one-commit.md` → `docs/adr/0007-owner-may-approve-setup-for-one-commit.md`; its heading `# 6.` → `# 7.`
- Modify: "ADR 0006" → "ADR 0007" in `lib/comments.mjs:132`, `lib/stages.mjs:178`, `lib/verify.mjs:13`, `test/verify.test.mjs:75`, `test/comments.test.mjs:65`, `test/behavior/setup-guard.test.mjs:37` (only references to the setup-approval record; `docs/adr/0006-development-tools-…` keeps its number)
- Modify: `package.json`: add `"private": true` and `"engines": { "node": ">=26" }`
- Modify: `.github/workflows/ci.yml:16` `node-version: 25` → `26`; `AGENTS.md:16` "tested on 25" → "tested on 26"
- Modify: `ponytail:` → `shortcut:` in `lib/stages.mjs:169`, `lib/workspace.mjs:50`, `lib/workspace.mjs:112`

- [ ] **Step 1: Make the changes above.**
- [ ] **Step 2: Check nothing is left:**
  `grep -rn "ADR 0006\|0006-owner" --exclude-dir=node_modules --exclude-dir=runs .` → only lines about development tools.
  `grep -rn "ponytail:\|older factory\|Task 0" lib factory.mjs` → nothing.
  `lockHolder` is still exported and used by `acquireLock` (`grep -n lockHolder lib/loop.mjs`).
- [ ] **Step 3: `npm test && npm run lint && npm run typecheck`, all pass** (also `test/readme.test.mjs`, which reads the README and files).
- [ ] **Step 4: With Dennis's go: commit the whole branch, push, open the pull request** listing each finding number from the spec and its change.
