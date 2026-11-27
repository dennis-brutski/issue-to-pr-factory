# Factory approve issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The factory waits for GitHub's blocked-by links; `node ready.mjs` lists the issues ready to approve; `/factory-approve-issues` walks Dennis through them.

**Architecture:** One shared `waitsFor(item, cfg, openIssues)` in `lib/eligibility.mjs` serves both the factory and `lib/ready.mjs`. `ready.mjs` is a root script like `stats.mjs`; the skill is prose like `factory-inbox/`.

**Tech Stack:** Node standard library, `gh api graphql`, node:test.

**Spec:** `docs/superpowers/specs/2026-11-27-factory-approve-issues-design.md`

## Global Constraints

- No dependencies (AGENTS.md rule 2). Test first (rule 1). JSDoc on touched exports (rule 8).
- A new `gh` call: the fake `gh` learns it by added lines and gets a contract test in `test/behavior/fake-gh.test.mjs` (rule 3).
- `lib/eligibility.mjs` is protected: tasks 1–3 go in their own pull request for review.
- Skip reasons read `waits for #12, owner/other#3`; other reasons `has agent:implement`, `has 3 open sub-issues`, `has an open pull request: #7`.
- Branches: tasks 1–3 on `factory-ready` (pull request A, with spec and plan); tasks 4–6 on `factory-approve-issues`, stacked on A (pull request B); task 7 after B is open.

## Review Focus

- A blocker the token cannot see comes back as a `null` node: drop it, never crash.
- A blocker listed both under `## Depends on` and as a link is named once.
- `--current` from an ssh remote (`git@github.com:o/r.git`) or https with or without `.git`, any case: still finds the target.
- One target whose `gh` call fails: the others still print, exit code 1.
- An issue whose only sub-issues are all closed is ready (not skipped).

---

### Task 1: Items carry their blocked-by links

**Files:** Modify `lib/github.mjs` (`COMMON`, `toItems`); Test `test/github.test.mjs`

**Interfaces:** Produces `item.blockedBy: { number: number, repo: string, open: boolean }[]` on every item from `toItems` (`[]` when absent).

- [ ] **Step 1: Failing tests** in `test/github.test.mjs`:
  - `toItems carries the blocked-by links of an issue`: an inline graphqlData whose issue has `blockedBy: { nodes: [{ number: 12, state: 'OPEN', repository: { nameWithOwner: 'o/r' } }, null, { number: 3, state: 'CLOSED', repository: { nameWithOwner: 'o/other' } }] }` → `[{ number: 12, repo: 'o/r', open: true }, { number: 3, repo: 'o/other', open: false }]`.
  - `an item without blocked-by links has none`: the existing fixture's issue 1 → `blockedBy` deep-equals `[]`.
- [ ] **Step 2:** `node --test test/github.test.mjs` → both fail.
- [ ] **Step 3:** add `blockedBy(first: 20) { nodes { number state repository { nameWithOwner } } }` to the issue fields only (not pull requests: add it in `PAGE('issues', …)` as extra), and map it in `toItems`, dropping `null` nodes.
- [ ] **Step 4:** tests pass.

### Task 2: `waitsFor` and `classify`

**Files:** Modify `lib/eligibility.mjs`; Test `test/eligibility.test.mjs`

**Interfaces:** Produces `waitsFor(item, cfg, openIssues = null): string[]`: `#n` for this repo (`cfg.repo`, compared with `same`), `owner/repo#n` for another; `## Depends on` first (filtered as today), then open links, no duplicates, never the issue itself. `classify` returns `{ action: 'skip', reason: 'waits for …', waitsFor }` with these strings.

- [ ] **Step 1: Failing tests** in the `depends on` describe:
  - `an open blocked-by link makes the issue wait`: `blockedBy: [{ number: 12, repo: config.repo, open: true }]` → reason `waits for #12`.
  - `a closed blocked-by link does not`: `open: false` → `action: 'run'`.
  - `a blocker in another repo is named with its repo`: repo `o/other` → `waits for o/other#3`.
  - `an issue listed under Depends on and linked is named once`: body depends on #151, link #151 open, open issues `[151]` → `waitsFor` deep-equals `['#151']`.
  - Change three existing assertions from numbers to strings, because the shape changes: `waitsFor: [151]` → `['#151']`, `[151, 152]` → `['#151', '#152']` (twice). Name them in the PR.
  - `config.repo` is null in the shared config: set `repo` in these tests' cfg.
- [ ] **Step 2:** run → fail.
- [ ] **Step 3:** implement `waitsFor`, export it with JSDoc, use it in `classify`.
- [ ] **Step 4:** `node --test test/eligibility.test.mjs test/loop.test.mjs` pass.

### Task 3: The fake knows links; the factory waits for them end to end

**Files:** Modify `test/behavior/fakes/gh.mjs` (add a `blockedBy` line to `node()` when the query asks for it), `test/behavior/world.mjs` (add `block(n, by)`), `README.md:145`; Create `test/behavior/blocked-by.test.mjs`; Test `test/behavior/fake-gh.test.mjs`

- [ ] **Step 1: Failing tests:**
  - contract: `listCandidates returns the blocked-by links`: state item 1 has `blockedBy: [2]`, item 2 an open issue → `item.blockedBy` deep-equals `[{ number: 2, repo: cfg.repo, open: true }]`.
  - behaviour, like `depends-on.test.mjs`: `an issue blocked by another starts on the poll after that one is closed`, with `w.block(second, first)` instead of the body section; the log says `waits for #<first>` once.
- [ ] **Step 2:** run → fail (fake has no `blockedBy`, world has no `block`).
- [ ] **Step 3:** fake: state `blockedBy` is a list of same-repo numbers, resolved to `{ number, state, repository: { nameWithOwner: <repo from the query's owner/name fields> } }`. World: `block(n, by)` pushes `by` onto item `n`'s `blockedBy`. README line 145: add "or is blocked by an open issue in GitHub's *Relationships* (a blocked-by link)".
- [ ] **Step 4:** `npm test`, `npm run lint`, `npm run typecheck` pass.
- [ ] **Step 5:** commit "Wait for GitHub's blocked-by links"; push `factory-ready`; open pull request A (lists the protected `lib/eligibility.mjs` and the three changed assertions).

### Task 4: Which open issues are ready

**Files:** Create `lib/ready.mjs`, `test/ready.test.mjs`; Modify `lib/github.mjs`, `test/behavior/fakes/gh.mjs`, `test/behavior/fake-gh.test.mjs`

**Interfaces:**
- `listOpenIssues(cfg): Promise<OpenIssue[]>`, every open issue whatever its labels, paged by 50: `{ number, title, url, body, labels: string[], blockedBy (as task 1), subIssues: { total, completed }, pullRequests: { number, open }[] }`. Query fields: `url`, `subIssuesSummary { total completed }`, `closedByPullRequestsReferences(first: 10, includeClosedPrs: true) { nodes { number state } }`.
- `readiness(issue, cfg, openIssues): { ready: true } | { ready: false, reason: string }`, checks in this order: trigger/state label (`has <label>`), `waitsFor` (`waits for …`), open sub-issues (`has n open sub-issues`), open pull request (`has an open pull request: #7`).

- [ ] **Step 1: Failing tests** in `test/ready.test.mjs`: one per reason, plus `ready when nothing holds it back`, `ready when every sub-issue is closed` (13/13), `ready when its pull request is closed`. Contract test `listOpenIssues lists every open issue, labelled or not` (a labelled and an unlabelled issue, a closed one left out).
- [ ] **Step 2:** run → fail.
- [ ] **Step 3:** implement; the fake adds `url`, `subIssuesSummary`, `closedByPullRequestsReferences` to `node()` when the query names them (state fields `subIssues`, `pullRequests`; defaults `{ total: 0, completed: 0 }`, `[]`).
- [ ] **Step 4:** pass.

### Task 5: `ready.mjs` and `--current`

**Files:** Create `ready.mjs`, `test/ready-script.test.mjs`; Modify `lib/settings.mjs`, `test/settings.test.mjs`

**Interfaces:**
- `repoOfRemote(url): string | null` in `lib/settings.mjs`: `owner/name` from `https://github.com/o/r(.git)`, `git@github.com:o/r(.git)`, `ssh://git@github.com/o/r(.git)`; else `null`.
- `runReady(argv, { factoryRoot, gh, remote }): Promise<{ ok: boolean, report: Report[] }>`, `Report = { target, repo, ready: Ready[], skipped: (Ready & { reason })[] } | { target, error }`, `Ready = { number, title, url }`. `argv`: `[]` all targets, `[<name>]` one, `['--current']` the target whose `repo` matches `repoOfRemote(await remote())` case-insensitively, else throws `this folder is not a target: <url>`. `openIssues` for `readiness` = the numbers `listOpenIssues` returned.
- CLI prints `JSON.stringify(report, null, 2)`; exit 1 if not `ok` or on a thrown error (`ready cannot run: …` on stderr). `remote` runs `git remote get-url origin` in `process.cwd()`.

- [ ] **Step 1: Failing tests:** `repoOfRemote` for the three forms, uppercase, and `/tmp/x` → `null`. `runReady` with a fake `gh` object (like `runStats` tests): all targets; one target failing still reports the others and `ok: false`; `--current` match; `--current` no match throws; the script run as a child with an unknown target exits 1.
- [ ] **Step 2–4:** fail, implement, pass.

### Task 6: The skill and its setting

**Files:** Create `factory-approve-issues/SKILL.md`; Modify `factory-inbox/config.example.json` (`"currentTargetOnly": false`), `README.md` (a section after the inbox one, install line, file list), `AGENTS.md` (add `lib/ready.mjs` to the pure-decisions row)

- [ ] **Step 1:** write `SKILL.md` from the spec, part 1 steps 1–4, with the five recommendations, the show block, and "Mistakes to avoid" (labelling before the edit; approval covers one item). Settings come from `<factoryDir>/factory-inbox/config.json`.
- [ ] **Step 2:** `npm test` (the README test), lint, typecheck pass; `node ready.mjs` on the real targets prints sane JSON.
- [ ] **Step 3:** commit "Add the factory-approve-issues skill and ready.mjs"; push `factory-approve-issues`; open pull request B against `factory-ready`, `Closes #<part 1 issue>`.

### Task 7: Issues for the work left

- [ ] File the part 1 issue (small, for the record; pull request B closes it).
- [ ] File the part 2 issue: `inbox.mjs [<target> | --current]` from the spec, the `/factory-inbox` changes, `currentTargetOnly`, tests and fake as in task 4. Link it as blocked by the part 1 issue (`gh api repos/<repo>/issues/<part2>/dependencies/blocked_by -X POST -F issue_id=<part1 database id>`). No label: Dennis approves it.
