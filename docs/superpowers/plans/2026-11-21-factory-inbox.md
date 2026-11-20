# Factory Inbox: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `node inbox.mjs` lists every open factory stop across all targets as JSON, and a `/factory-inbox` skill walks Dennis through answering them.

**Architecture:** A read-only entry point `inbox.mjs` next to `stats.mjs`, built the same way: a pure function shapes the items `listCandidates` returns, a thin `runInbox` loops over targets. The skill (outside the repo) only reads that JSON and acts after Dennis approves.

**Tech Stack:** Node standard library, `gh` through the existing `lib/github.mjs`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-21-factory-inbox-design.md`

## Global Constraints

- No dependencies. Read only: `inbox.mjs` never comments, labels or changes files.
- No new `gh` command: use `listCandidates` from `lib/github.mjs` as it is.
- Tasks 1 and 2 touch no protected file (`package.json`, `config.mjs` are Task 3, by hand).
- No notebook id in git. `notebookId` comes from settings, `null` when unset.
- `npm test` passes after every task.

## Review Focus

- A pull request stop: its worktree is its issue's (`issueOf(item)`), not `issue-<pr number>`. Test in Task 2.
- A "no new comments" stop (`NO_NEW_COMMENTS`): `lastStop` skips it, but it is still waiting for Dennis, so the inbox lists it. Test in Task 1.
- An item with `agent:needs-human` but no 🏭 comment by the owner (label set by hand): listed with `stop: ""`, `stage: null`, `label: "no factory comment"`. Test in Task 2.
- One target's `gh` fails: the others are still listed, the failure goes to stderr, exit code 1 (as `runStats`). Test in Task 2.
- A 🏭 comment by someone other than the owner is never taken as the factory's. Test in Task 1.

---

### Task 1: The newest park comment

**Files:**
- Modify: `lib/comments.mjs`
- Create: `test/inbox.test.mjs`

**Interfaces:**
- Produces: `newestPark(comments: {author, body, at}[], owner: string) → { body: string, at: string, stage: string | null } | null`. The newest comment by `owner` that starts with `🏭 **Factory stopped` or `🏭 **Factory did not start`. `stage` is the word in `Factory stopped (<stage>)`, `null` for did-not-start.

- [ ] **Step 1: Write the failing tests** in `test/inbox.test.mjs`, building comments with `stopped(...)` and `didNotStart(...)` from `lib/comments.mjs`:
  - `newestPark picks the newest stop and its stage`: two stops (`gate`, then `implement`) → `stage === 'implement'`, `at` of the second.
  - `newestPark counts a no-new-comments stop`: a `stopped('review', NO_NEW_COMMENTS, …)` is returned.
  - `newestPark returns a did-not-start park with no stage`: `stage === null`.
  - `newestPark ignores 🏭 comments by others and plain owner comments`: → `null`.
- [ ] **Step 2: Run** `node --test test/inbox.test.mjs`. Expected: fails, `newestPark` is not exported.
- [ ] **Step 3: Implement `newestPark`** in `lib/comments.mjs`, next to `lastStop`, reusing `STOPPED` and the did-not-start heading from `didNotStart`.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit:** `Find the newest park comment for the inbox`

### Task 2: `inbox.mjs`

**Files:**
- Create: `inbox.mjs`
- Modify: `test/inbox.test.mjs`
- Modify: `README.md` (a short *Inbox* section after *Statistics*)

**Interfaces:**
- Consumes: `newestPark` (Task 1); `stopLabel` from `stats.mjs`; `issueOf`, `worktreeFor` from `lib/names.mjs`; `loadSettings`, `targetNames` from `lib/settings.mjs`; `listCandidates` from `lib/github.mjs`.
- Produces:
  - `toStops(items, cfg, exists = existsSync) → Stop[]`, pure apart from `exists`. Keeps items labelled `cfg.states.needsHuman`. A `Stop` is `{ repo, number, kind, title, stage, label, stop, stoppedAt, worktree, worktreeExists, since, url, notebookId }`: `stop`/`stoppedAt`/`stage` from `newestPark` (`""`/`null`/`null` when none); `label` is `stopLabel(stop)`, or `"no factory comment"`; `worktree` is `join(cfg.runDir, 'worktrees', worktreeFor(issueOf(item)))`; `since` are the bodies of the owner's comments after `stoppedAt` that do not start with 🏭; `url` is `https://github.com/<repo>/issues/<n>` or `/pull/<n>`; `notebookId` is `cfg.notebookId ?? null`.
  - `runInbox(argv, { factoryRoot, gh = { listCandidates }, log = console.log, warn = console.error }) → Promise<boolean>`: one target if `argv[0]` is given, else all of `targetNames`; prints one JSON array of all stops, sorted by `stoppedAt` (no stop text sorts first); returns `false` when a target failed.
  - CLI: `node inbox.mjs [<target>]`, guarded like `stats.mjs`.

- [ ] **Step 1: Write the failing tests** in `test/inbox.test.mjs` (targets in a temp `factoryRoot`, as `test/stats-all.test.mjs`; a fake `gh.listCandidates` returning items shaped like `toItems`):
  - `toStops keeps only items with agent:needs-human`.
  - `toStops gives a pull request its issue's worktree`: a PR on `factory/issue-7` numbered 9 → `worktree` ends with `worktrees/issue-7`, `url` ends with `/pull/9`.
  - `toStops lists a hand-set needs-human with no factory comment`: `stop === ''`, `label === 'no factory comment'`.
  - `toStops passes on only the owner's own comments after the stop`.
  - `toStops carries the target's notebookId, null when unset`.
  - `runInbox prints every target's stops in one array, oldest first`.
  - `runInbox keeps going when one target fails and returns false`.
- [ ] **Step 2: Run** `node --test test/inbox.test.mjs`. Expected: the new tests fail, `inbox.mjs` is missing.
- [ ] **Step 3: Implement** `toStops`, `runInbox` and the CLI in `inbox.mjs`. Header comment like `stats.mjs`: what it does, how to run it, "Read only".
- [ ] **Step 4: Add** a README *Inbox* section: `node inbox.mjs [<target>]` prints the open stops as JSON for the `/factory-inbox` skill; `notebookId` in `local.mjs` lets the skill ask a NotebookLM notebook.
- [ ] **Step 5: Run** `npm test` and `node inbox.mjs` (needs `gh`). Expected: all pass; a JSON array.
- [ ] **Step 6: Commit:** `List the factory's open stops as JSON for the inbox skill`

### Task 3: Protected settings (by hand)

**Files:** `package.json`, `config.mjs`, `local.mjs` (not in git)

- [ ] `package.json` scripts: `"inbox": "node inbox.mjs"`.
- [ ] `config.mjs`, after `ownerName`: `notebookId: null, // NotebookLM notebook the inbox skill may ask for background; set yours in local.mjs`.
- [ ] `local.mjs`: add Dennis's `notebookId`. Never committed.
- [ ] `npm test` passes; `npm run -s inbox` prints the array with `notebookId` set.
- [ ] Commit (`package.json`, `config.mjs` only): `Add npm run inbox and the notebookId setting`

### Task 4: The skill (by hand, outside the repo)

**Files:** `~/.claude/skills/factory-inbox/SKILL.md`

- [ ] Frontmatter: `name: factory-inbox`, a description that triggers on "factory inbox", "answer the factory", "factory stops", `/factory-inbox`.
- [ ] Body, following the spec's five steps: run `npm run -s inbox` in the factory repo; go through the stops oldest first; read issue, stop and the named code; ask the stop's notebook only when `notebookId` is set; ask before any web search; show summary plus reply or hand fix; act only on approve; a reply never starts with 🏭; a hand fix runs `npm test` and commits in the worktree, then removes `agent:needs-human`; end with answered / fixed / skipped.
- [ ] Try it on the open stops; Dennis approves each action.
