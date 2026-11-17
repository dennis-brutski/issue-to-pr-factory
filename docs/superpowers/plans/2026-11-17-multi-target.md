# Behaviour Tests and Any-Repo Targets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First give the factory behaviour tests that run it as a whole program against a fake GitHub and a fake Claude; then let one factory serve any repo through per-target settings, with setup and checks confined in `bwrap` and workflow changes never pushed.

**Architecture:** Phase 1 adds three small seams (settings file chosen at start, clone URL, run folder) and a test harness that starts the real `factory.mjs` with fake `gh` and `claude` programs first on `PATH`, a local bare repo as `origin`, and the GitHub state in a JSON file. Phase 2 moves every project-specific value into `targets/<name>.mjs` merged over `config.mjs`, confines setup and checks with a `bwrap` argument builder, adds a workflow brake, renders prompts from the target, and adds startup checks. Each phase-2 behaviour gets a scenario in the phase-1 harness.

**Tech Stack:** Node 22+ ES modules, `node --test`, git, `bwrap`, `gh` 2.45, Claude Code CLI. No dependencies.

**Spec:** `docs/superpowers/specs/2026-11-17-multi-target-design.md`. Read it first.

## Global Constraints

- Factory repo: `~/git/issue-to-pr-factory`, branch `main`. No dependencies.
- **Commits:** work happens on its own branch in its own worktree, never on `main`. The executor commits there itself at each commit checkpoint, with the suggested message. Never add co-author, "Generated with" or session trailers.
- Agents never run with `bypassPermissions` or `--dangerously-skip-permissions`.
- Every GitHub write is made by the factory program, never by an agent. The factory never merges and never pushes to the base branch.
- Nothing is installed as a service, timer or login item.
- Test first: write the failing test, watch it fail, then the code.
- Existing tests change only where this plan changes a signature they call; their assertions stay.
- Always protected, for every target, not removable by a target: `AGENTS.md`, `CLAUDE.md`, `.github/`, `.claude/`.
- A branch that adds, changes, deletes or renames anything under `.github/workflows/` is parked **without pushing**, in every stage, on every target.
- No agent-written code runs unconfined on Dennis's machine: setup and checks run under `bwrap` (home hidden; checks without network).
- `npm test` must pass at the end of every task; `npm run smoke` (8/8) must still pass at the end of phase 2.

## Review Focus

1. A target file with a syntax error or a thrown error → the factory exits non-zero naming the file and the error, never a stack trace from deep inside the loop (Task 7).
2. A target argument with path characters (`../x`, `targets/../config`) → treated as a path; only an existing `.mjs` file is accepted, anything else is "unknown target" (Task 7).
3. A check command that does not exist on the machine (`gradle` missing) → the run parks with "`gradle …` failed" and the missing-program message, the factory keeps running (Task 9).
4. Two items running setup or checks at the same time → each gets its own `{port}` value; env values without `{port}` pass through unchanged (Task 9).
5. The old single-target layout (`repo/`, `worktrees/` at the factory root) present at startup → a warning pointing at the README's moving section, not a silent second clone with orphaned worktrees (Task 11).

---

## Phase 1 — behaviour tests for today's factory

### Task 1: Settings file at start, clone URL and run folder

**Files:**
- Create: `lib/settings.mjs`, `test/settings.test.mjs`
- Modify: `config.mjs` (add `remoteUrl: null`, `runDir: null`), `factory.mjs` (use the seams)

**Interfaces:**
- Produces:
  - `loadSettings(arg: string|undefined, { factoryRoot: string }) → Promise<cfg>` — `undefined` returns `config` with `runDir` defaulted to `factoryRoot`; a path to an `.mjs` file imports it and merges its default export (or named `settings`) shallowly over `config`, then defaults `runDir`. Throws `Error('cannot load settings <path>: <message>')` on a failed import.
  - `cloneUrl(cfg) → string` — `cfg.remoteUrl ?? \`https://github.com/${cfg.repo}.git\``.
  - `factory.mjs` accepts one optional argument: `node factory.mjs [settings.mjs]`. It uses `cfg.runDir` wherever it used `root` for the lock (`factory.lock`), the clone and worktrees (`deps.root = cfg.runDir`), and `cloneUrl(cfg)` for `ensureClone`.

- [ ] **Step 1: Write the failing tests** in `test/settings.test.mjs`:
  - `loadSettings without an argument returns the defaults with runDir = factoryRoot` → `cfg.repo === config.repo`, `cfg.runDir === '/f'` for `{ factoryRoot: '/f' }`.
  - `a settings file overrides single fields` → write a temp `s.mjs` exporting `{ pollSec: 1, runDir: '/tmp/x' }`; `cfg.pollSec === 1`, `cfg.runDir === '/tmp/x'`, `cfg.triggers` deep-equals `config.triggers`.
  - `a broken settings file names the file` → temp file with `export default {` → rejects with `/cannot load settings .*s\.mjs/`.
  - `cloneUrl defaults to GitHub and honours remoteUrl` → `cloneUrl({ repo: 'a/b', remoteUrl: null }) === 'https://github.com/a/b.git'`; `cloneUrl({ repo: 'a/b', remoteUrl: '/tmp/o.git' }) === '/tmp/o.git'`.
- [ ] **Step 2: Run** `npm test` — expected: FAIL, module `lib/settings.mjs` not found.
- [ ] **Step 3: Implement `lib/settings.mjs`** and wire `factory.mjs` (`const cfg = await loadSettings(process.argv[2], { factoryRoot })`; on error print `factory cannot run: <message>` and exit 1).
- [ ] **Step 4: Run** `npm test` — expected: all pass. Then `npm start` with Ctrl-C after "started" — expected: same behaviour as before (clone in `repo/`, lock `factory.lock`).
- [ ] **Step 5: Commit** — `Let a settings file choose the clone URL and run folder`.

### Task 2: Fake `gh`

**Files:**
- Create: `test/behavior/fakes/bin/gh` (executable, `#!/usr/bin/env node`, imports `../gh.mjs`), `test/behavior/fakes/gh.mjs`, `test/behavior/fake-gh.test.mjs`
- Modify: `package.json` → `"test": "node --test test/*.test.mjs test/behavior/*.test.mjs"`

**Interfaces:**
- Produces: a program `gh` reading/writing the JSON file named by env `FAKE_GH_STATE`:
  ```
  { login, nextNumber, items: [{ number, kind: 'issue'|'pr', title, body, author, state: 'OPEN'|'CLOSED'|'MERGED',
    labels: [name], labelEvents: [{ label, actor, at }], comments: [{ author, body, at, path? }],
    headRefName?, headRepo?, baseRefName?, isDraft? }], calls: [argv] }
  ```
  Every call is appended to `calls`. Writes are serialised with an exclusive lock file next to the state (`openSync(lock, 'wx')`, retry every 10 ms, give up after 5 s). Supported commands — exactly those in `lib/github.mjs`:
  1. `api graphql -f query=… -f owner=O -f name=N -f labels[]=…` → `{ data: { repository: { issues: { nodes }, pullRequests: { nodes } } } }` with OPEN items whose labels intersect the given ones, in the shape `toItems` reads (see `test/fixtures/graphql-items.json`); `comments` with a `path` go into `reviewThreads` for pull requests.
  2. `api -X POST repos/O/N/issues/<n>/labels -f labels[]=L` → add label and a label event by `login`.
  3. `api -X DELETE repos/O/N/issues/<n>/labels/<urlencoded L>` → remove; when absent, stderr `Label does not exist` and exit 1.
  4. `api -X POST repos/O/N/issues/<n>/comments -F body=@-` → comment by `login` with stdin as body.
  5. `api -X PATCH repos/O/N/pulls/<n> -F body=@-` → set body.
  6. `api repos/O/N/issues/<n> --jq .state` → prints `open`/`closed` (MERGED pull requests' issues stay as they are).
  7. `api user --jq .login` → prints `login`.
  8. `pr list --repo R --head B --state open|all --json <fields>` → JSON array with the requested fields of pull requests whose `headRefName` is B (`state` as `OPEN`/`CLOSED`/`MERGED`, `url` `https://github.com/R/pull/<n>`).
  9. `pr create --repo R --head B --base M --title T --body-file - [--draft]` → new item (next number), prints its URL.
  10. `pr ready <n> --repo R [--undo]` → `isDraft = !!undo`.
  Anything else: stderr `fake gh: unsupported command: <argv>`, exit 2.

- [ ] **Step 1: Write the failing tests** in `test/behavior/fake-gh.test.mjs`. They call the **real** `lib/github.mjs` functions with `PATH=<fakes/bin>:$PATH` and `FAKE_GH_STATE` set (set `process.env` before the calls; `run` inherits it):
  - `listCandidates sees a labelled open issue and its label event` → seeded issue 1 labelled `agent:implement` by `dennis-brutski` → one item, `labelEvents[0].actor === 'dennis-brutski'`.
  - `addLabel, removeLabel and comment change the state` → state shows the label added then removed and the comment by `login`.
  - `removeLabel of a missing label is not an error` → resolves.
  - `openPullRequest, findPullRequest, setDraft and updatePullRequestBody round-trip` → `openPullRequest(cfg, { branch: 'factory/issue-1', title: 't', body: 'b', draft: true })` returns `{ number: 2, url: …/pull/2 }`; `findPullRequest` returns it with `isDraft: true`; after `setDraft(cfg, 2, false)` `isDraft` is false; body updated.
  - `isFinished is true once the pull request is merged` → set the PR's state to `MERGED` in the file → `true`.
  - `authenticatedLogin returns the login`.
  - `an unsupported command fails loudly` → `run('gh', ['repo', 'view'])` → code 2, stderr matches `/unsupported command/`.
- [ ] **Step 2: Run** `npm test` — expected: FAIL (`gh` not found on the fake path / wrong output).
- [ ] **Step 3: Implement** `test/behavior/fakes/gh.mjs` and the `bin/gh` wrapper (`chmod +x`).
- [ ] **Step 4: Run** `npm test` — expected: all pass.
- [ ] **Step 5: Commit** — `Add a fake gh for behaviour tests`.

### Task 3: Fake `claude` and the test world

**Files:**
- Create: `test/behavior/fakes/bin/claude`, `test/behavior/fakes/claude.mjs`, `test/behavior/world.mjs`, `test/behavior/world.test.mjs`

**Interfaces:**
- Consumes: Task 1 (`node factory.mjs <settings.mjs>`, `remoteUrl`, `runDir`), Task 2 (fake `gh` and its state shape).
- Produces:
  - Fake `claude`: `--version` prints `fake 0.0.0`. Otherwise reads the prompt on stdin, the session from its first line (`# Can issue` → `gate`, `# Implement` → `implement`, `# Review the change` → `review`, `# Fix review` → `fix`, `# Rework` → `rework`, `# Resolve the merge` → `merge`, `# Explore` → `explore`) and the issue number from `#<n>` in that line. It takes the next step for that issue from the JSON file named by `FAKE_CLAUDE_SCRIPT` (`{ "<n>": [step, …] }`, consumed in order, file rewritten), appends `{ issue, session, cwd, prompt, hadNodeModules: existsSync('node_modules'), pid }` to the JSON-lines file `FAKE_CLAUDE_LOG`, then performs the step in the cwd:
    ```
    step = { session, write?: { path: content }, remove?: [path], commit?: 'message',
             placeholders?: true, hang?: true, output: object }
    ```
    `write`/`remove` change files; `commit` runs `git add -A && git commit -m <message>`; `placeholders` creates empty mode-0444 `.bashrc`, `.claude/settings.json` in the cwd and `config.lock` in `git rev-parse --git-common-dir`; `hang` sleeps forever (after logging). It prints `{"type":"result","is_error":false,"session_id":"fake","structured_output":<output>}` and exits 0. A session that differs from the step's `session`, or no step left: stderr `fake claude: expected <step.session|nothing> for #<n>, got <session>`, exit 1.
  - `world.mjs` exports `async function world(opts?) → World`:
    - creates a temp folder; a bare repo `origin.git` on branch `master` seeded with: `package.json` (`scripts: { test: 'node --test', e2e: 'node -e ""' }`), a matching `package-lock.json` (lockfileVersion 3, no packages), `src/a.js`, `test/a.test.js` (one passing test); fake state `{ login: 'dennis-brutski', nextNumber: 1, items: [], calls: [] }`; a settings file `settings.mjs` exporting `{ repo: 'dennis-brutski/demo', remoteUrl: <origin.git>, runDir: <tmp>/run, pollSec: 1 }`.
    - `issue({ title, body = 'Do it.', labels = [], by = 'dennis-brutski', author = 'dennis-brutski' }) → number`
    - `label(n, label, by = 'dennis-brutski')`, `unlabel(n, label)`, `comment(n, body, { by = 'dennis-brutski', path } = {})`, `merge(prNumber)` (sets `MERGED`), `item(n)`, `state()`
    - `script(n, steps)` (appends to the fake Claude script)
    - `start(extraArgs = []) → Factory`: spawns `node <factoryRoot>/factory.mjs <settings.mjs>` with env `PATH=<fakes/bin>:$PATH`, `FAKE_GH_STATE`, `FAKE_CLAUDE_SCRIPT`, `FAKE_CLAUDE_LOG`, `npm_config_offline=true`, `npm_config_audit=false`, `npm_config_fund=false`; `Factory = { proc, output(): string, signal(sig), exited: Promise<number> }`
    - `until(fn, ms = 20000, what = 'condition')` → resolves when `fn()` is truthy (polls every 100 ms), rejects with `timed out waiting for <what>` plus the factory output.
    - `claudeCalls() → [{ issue, session, cwd, prompt, hadNodeModules, pid }]`
    - `branch(name) → { subjects: [string], files: [string] } | null` from `origin.git` (`git log --format=%s master..<name>`, `git diff --name-only master...<name>`)
    - `close()` → stops any running factory with SIGKILL to its group and removes the temp folder.
- [ ] **Step 1: Write the failing tests** in `test/behavior/world.test.mjs`:
  - `the fake claude follows its script and logs the call` → in a temp git repo, script `{ "3": [{ session: 'implement', write: { 'x.txt': 'x' }, commit: 'Add x', output: { status: 'complete', summary: 's', detail: '' } }] }`; call the real `runAgent` from `lib/agent.mjs` with a prompt starting `# Implement issue #3` and `cfg = { ...config, maxTurns: 1, sessionTimeoutMin: 1 }` → `{ ok: true, output.status: 'complete' }`; the repo's last subject is `Add x`; the log has one `implement` call for issue 3.
  - `a session out of script order fails` → prompt `# Can issue #3 …` against the same script → `ok: false`, reason matches `/expected implement/`.
  - `the factory starts in a world and reports 0 eligible` → `w = await world()`, `f = w.start()`, `await w.until(() => f.output().includes('0 eligible'))`, `f.signal('SIGINT')`, `await f.exited === 0`, output includes `stopped`.
- [ ] **Step 2: Run** `npm test` — expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the fake `claude`, its wrapper, and `world.mjs`.
- [ ] **Step 4: Run** `npm test` — expected: all pass.
- [ ] **Step 5: Commit** — `Add a fake claude and a test world that runs the real factory`.

### Task 4: Scenarios — the happy path, parks and trust

**Files:**
- Create: `test/behavior/implement.test.mjs`

**Interfaces:**
- Consumes: Task 3's `world()` API and step shape.

Common steps: `const ok = (summary) => ({ status: 'complete', summary, detail: '' })`; `gate = (c, q = []) => ({ session: 'gate', output: { confidence: c, questions: q } })`; `clean = { session: 'review', output: { verdict: 'clean', findings: [] } }`. Each test ends with `w.close()`.

- [ ] **Step 1: Write the failing tests:**
  - `a clear labelled issue becomes a pull request` → issue 1 labelled `agent:implement`; script `[gate(90), { session: 'implement', write: { 'src/a.js': 'export const a = 2;\n' }, commit: 'Change a', output: ok('Changed a') }, clean]`; start; until a PR exists. Then: PR body includes `Closes #1`, not draft; issue 1 has `agent:done` and not `agent:in-progress`; `branch('factory/issue-1').subjects` deep-equals `['Change a']`; every Claude call has `hadNodeModules === true`; issue comments include one starting `🏭 Pull request:`.
  - `a vague issue parks once and stays parked` → script `[gate(5, ['What exactly?'])]`; until issue has `agent:needs-human`; comment includes `What exactly?` and `confidence 5`; wait for two more `0 eligible` lines; still exactly one 🏭 comment, one Claude call, no PR. Stop and start again; after one more `0 eligible`, still one Claude call.
  - `an issue labelled by someone else is never touched` → issue labelled `agent:implement` by `mallory`; after two `0 eligible` lines: no Claude calls, no new comments, labels unchanged.
  - `changing an existing test opens a draft with the warning` → implement step writes `test/a.test.js`; until a PR exists: `isDraft === true`, body includes `existing test changed (M): test/a.test.js`; issue has `agent:needs-human`.
- [ ] **Step 2: Run** `npm test` — expected: the four tests fail only if the factory misbehaves; **they should pass against today's code**. If one fails, read the output: a harness bug is fixed in the harness; a factory bug stops the task and is reported to Dennis.
- [ ] **Step 3: Check they can fail** — temporarily break `lib/stages.mjs` (comment out the `addLabel(…done)` line), run, see `a clear labelled issue …` fail; restore. Record this in the task report.
- [ ] **Step 4: Commit** — `Add behaviour tests for implement, parks and trust`.

### Task 5: Scenarios — red checks and rework

**Files:**
- Create: `test/behavior/rework.test.mjs`

- [ ] **Step 1: Write the tests:**
  - `failing checks park with the output and push nothing` → implement step writes `test/b.test.js` with a test that does `assert.fail('boom')` and commits; until `agent:needs-human`; comment includes `npm test` and `boom`; `branch('factory/issue-1') === null`; no PR.
  - `a review comment brings a new commit and an answer` → run the happy path to a PR (number `p`); `comment(p, 'rename a to b', { path: 'src/a.js' })`; `label(p, 'agent:review')`; script for issue 1 `[{ session: 'rework', write: { 'src/a.js': 'export const b = 2;\n' }, commit: 'Rename a to b', output: ok('Renamed a') }]`; until PR lacks `agent:review` and `agent:in-progress`: branch subjects end with `Rename a to b`; PR comments include `🏭 **Rework**` and `Renamed a`; no `agent:needs-human`.
  - `a rework that changes nothing answers without pushing` → as above but the rework step has no `write`/`commit`; branch subjects unchanged; `🏭 **Rework**` comment present; label removed.
  - `the factory's own comments never reach the agent` → after the vague-issue park on issue 1 (Task 4 setup), `unlabel(1, 'agent:needs-human')`; script `[gate(90), …implement…, clean]`; until a PR exists; the gate call's recorded prompt does not contain `Factory stopped`.
- [ ] **Step 2: Run** `npm test` — expected: pass against today's code (same rule as Task 4 Step 2).
- [ ] **Step 3: Commit** — `Add behaviour tests for red checks and rework`.

### Task 6: Scenarios — stop, restart, cleanup, lock

**Files:**
- Create: `test/behavior/lifecycle.test.mjs`

- [ ] **Step 1: Write the tests:**
  - `Ctrl-C twice kills the agent; a restart resumes in the same worktree` → script `[gate(90), { session: 'implement', placeholders: true, hang: true, output: ok('x') }]`; until the log has an `implement` call; `signal('SIGINT')` twice; `await exited === 130`; the logged `pid` is not alive (`process.kill(pid, 0)` throws `ESRCH`); issue still has `agent:in-progress`. Script `[gate(90), { session: 'implement', write: { 'src/a.js': 'y' }, commit: 'Y', output: ok('y') }, clean]`; start again; until a PR exists; output includes `re-queued after an interrupted run`; both `implement` calls have the same `cwd`; `branch(…).files` contains neither `.bashrc` nor `.claude/settings.json`.
  - `a merged pull request's worktree is removed` → happy path to PR `p`; `merge(p)`; until output includes `#1 finished; worktree removed`; the worktree folder `<runDir>/worktrees/issue-1` no longer exists.
  - `a second start is refused` → start one; until `0 eligible`; start a second → it exits 1 and its output includes `already running`.
- [ ] **Step 2: Run** `npm test` — expected: pass. Note the total `npm test` time in the report. If the behaviour tests take more than 30 s together, move them to `"test:behavior": "node --test test/behavior/*.test.mjs"`, keep `"test"` for unit tests, and add the line "`npm test` and `npm run test:behavior` must both pass" to the README.
- [ ] **Step 3: Commit** — `Add behaviour tests for stop, restart, cleanup and the lock`.

---

## Phase 2 — any repo as a target

Every phase-2 task keeps all phase-1 scenarios green. The world's settings file becomes a target file in Task 7; phase-1 tests change only in how `world()` builds that file.

### Task 7: Targets, run folders, starting

**Files:**
- Create: `targets/gin-rummy-score-pad.mjs`
- Modify: `lib/settings.mjs`, `test/settings.test.mjs`, `config.mjs` (remove `repo` and `baseBranch`), `factory.mjs` (start line), `.gitignore` (add `runs/`), `test/behavior/world.mjs` (settings file now sets `baseBranch: 'master'` too)

**Interfaces:**
- Produces:
  - `loadSettings(arg, { factoryRoot, targetsDir = join(factoryRoot, 'targets') }) → Promise<cfg>`:
    - `arg` containing `/` or ending in `.mjs` is a path: must be an existing `.mjs` file, target name = its basename without `.mjs`.
    - Otherwise `arg` is a name matching `/^[a-z0-9][a-z0-9-]*$/` → `targets/<arg>.mjs`.
    - `arg` undefined: exactly one `*.mjs` in `targetsDir` → that one; else throw `Error('choose a target: <names joined by ", "> (npm start -- <target>)')` (or `'no targets in targets/'`).
    - Unknown or invalid → `Error('unknown target "<arg>". Available: <names>')`.
    - Result: `{ ...config, ...target, target: <name>, runDir: target.runDir ?? join(factoryRoot, 'runs', <name>) }`; throws `Error('target <name>: repo and baseBranch are required')` when either is missing.
  - `targets/gin-rummy-score-pad.mjs`: `export default { repo: 'dennis-brutski/gin-rummy-score-pad', baseBranch: 'master' }` (more fields arrive in Tasks 8–10).
  - Start line: `factory started for <repo> (<target>) — polling every …`.
- [ ] **Step 1: Write the failing tests** in `test/settings.test.mjs` (replace Task 1's no-argument test, keep the rest): with a temp `targetsDir`:
  - `a name loads targets/<name>.mjs and sets runs/<name>` → `cfg.target === 'one'`, `cfg.runDir === join(root, 'runs', 'one')`.
  - `no argument runs the only target` / `no argument with two targets lists them` (`/choose a target: one, two/`) / `no targets` (`/no targets/`).
  - `an unknown name is refused` (`/unknown target "nope"\. Available: one/`).
  - `a path outside .mjs is refused` → `'../x'` rejects with `/unknown target/`.
  - `a target without baseBranch is refused` (`/repo and baseBranch are required/`).
  - `a broken target names its file` (Review Focus 1) → `/cannot load settings .*bad\.mjs/`.
- [ ] **Step 2: Run** `npm test` — expected: FAIL on the new tests.
- [ ] **Step 3: Implement** as above; move `repo`/`baseBranch` out of `config.mjs` into the score-pad target.
- [ ] **Step 4: Add a behaviour test** `two targets run side by side` in `test/behavior/lifecycle.test.mjs` → two worlds (`demo-a`, `demo-b`), both started; each reaches `0 eligible`; each has its own `<runDir>/factory.lock`; stopping one leaves the other running.
- [ ] **Step 5: Run** `npm test` — expected: all pass. `node factory.mjs` in the factory folder (one target) starts the score pad with a fresh clone in `runs/gin-rummy-score-pad/`; Ctrl-C.
- [ ] **Step 6: Commit** — `Load one target per factory from targets/`.

### Task 8: Per-target brakes and the workflow rule

**Files:**
- Modify: `lib/brakes.mjs`, `test/brakes.test.mjs`, `lib/stages.mjs`, `test/stages.test.mjs`, `targets/gin-rummy-score-pad.mjs`, `test/behavior/world.mjs`
- Create: `test/behavior/workflow.test.mjs`

**Interfaces:**
- Produces:
  - `protectedPathViolations(changes, cfg)` — protected = built-in `['AGENTS.md', 'CLAUDE.md']` + `cfg.protectedFiles ?? []`; dirs = built-in `['.github/', '.claude/']` + `cfg.protectedDirs ?? []`; tests = `cfg.testDirs ?? []`. Messages unchanged.
  - `workflowChanges(changes) → string[]` — every `path`/`oldPath` starting with `.github/workflows/`, deduplicated.
  - `verifyAndPush(ctx)` (in `lib/stages.mjs`) calls `workflowChanges(await ws.changesAgainstBase(dir, cfg.baseBranch))` **before** the checks and the push; if any: `park` with ``The branch changes CI workflow files, so the factory did not push it. Read the change and push it yourself if it is right:\n- <file>…\n\n<fenced `git diff origin/<base>...HEAD -- .github/workflows/`, last 4,000 chars>``. Needs `ws.diffAgainstBase(dir, baseBranch, pathspec) → string` in `lib/workspace.mjs`.
  - Score-pad target gains `protectedFiles: ['playwright.config.js', 'package.json', 'package-lock.json']`, `testDirs: ['test/', 'e2e/']`. The world's target gains `protectedFiles: ['package.json', 'package-lock.json']`, `testDirs: ['test/']`.
- [ ] **Step 1: Write the failing tests:**
  - brakes: `built-in protected files cannot be removed by a target` → `cfg = { protectedFiles: [], protectedDirs: [] }`, change `M AGENTS.md` and `M .claude/x` → both flagged; `target lists add to the built-ins` → `M Makefile` flagged with `protectedFiles: ['Makefile']`; `test folders come from the target` → `M spec/a.js` flagged as existing test with `testDirs: ['spec/']`, not flagged with `testDirs: ['test/']`.
  - brakes: `workflowChanges finds added, changed, deleted and renamed workflows` → `[A .github/workflows/a.yml, M .github/workflows/b.yml, D .github/workflows/c.yml, R .github/x.yml→.github/workflows/d.yml, R .github/workflows/e.yml→old/e.yml, M .github/CODEOWNERS]` → `['.github/workflows/a.yml', '.github/workflows/b.yml', '.github/workflows/c.yml', '.github/workflows/d.yml', '.github/workflows/e.yml']`.
  - stages: `a workflow change parks before checks and push`, for `implement`, `review` (with new commits) and `merge` → fakes with `changes: [{ status: 'M', path: '.github/workflows/ci.yml' }]` → outcome `parked`, `d.pushed` empty, `runChecks` not called, comment includes `did not push` and the file.
  - behaviour (`test/behavior/workflow.test.mjs`): `a workflow change is never pushed` → implement step writes `.github/workflows/ci.yml`; until `agent:needs-human`; `branch('factory/issue-1') === null`; comment includes `.github/workflows/ci.yml`. `another .github change is pushed as a draft` → writes `.github/CODEOWNERS`; a draft PR exists.
- [ ] **Step 2: Run** `npm test` — expected: FAIL on the new tests.
- [ ] **Step 3: Implement.** Existing brakes/stages tests get `cfg` passed where the signature changed; their assertions stay.
- [ ] **Step 4: Run** `npm test` — expected: all pass.
- [ ] **Step 5: Commit** — `Take protected paths from the target and never push workflow changes`.

### Task 9: Confined setup and checks

**Files:**
- Create: `lib/confine.mjs`, `test/confine.test.mjs`
- Modify: `lib/checks.mjs`, `lib/stages.mjs`, `lib/agent.mjs`, `config.mjs`, `factory.mjs` (deps), `targets/gin-rummy-score-pad.mjs`, `test/behavior/world.mjs`, `test/stages.test.mjs`, `test/agent.test.mjs`

**Interfaces:**
- Produces:
  - `config.mjs` gains `setup: []`, `checks: []`, `env: {}`, `runtimeRead: ['~/.nvm']`, `sandboxRead: []`, `setupWrite: []`.
  - Score-pad target gains `setup: [['npm', ['ci']]]`, `checks: [['npm', ['test']], ['npm', ['run', 'e2e']]]`, `env: { E2E_PORT: '{port}', PW_CHROMIUM_NO_SANDBOX: '1' }`, `sandboxRead: ['~/.cache/ms-playwright']`, `setupWrite: ['~/.npm']`.
  - `expandHome(p, home) → string`; `targetEnv(cfg, port) → object` — `{ CI: '1', ...cfg.env }` with every `{port}` replaced by `String(port)`.
  - `bwrapArgs({ dir, gitDir, home, network, read, write }) → string[]`, in this order: `--ro-bind / /`, `--dev /dev`, `--proc /proc`, `--tmpfs /tmp`, `--tmpfs <home>`, then `--ro-bind p p` for each existing `read` path (home-expanded), `--ro-bind <gitDir> <gitDir>`, `--bind <dir> <dir>`, `--bind p p` for each `write` path (created first with `mkdirSync(…, { recursive: true })`), `--unshare-net` when `!network`, `--die-with-parent`, `--chdir <dir>`.
  - `runConfined(cmd, args, { dir, gitDir, cfg, port, network, write, timeoutMs }) → run() result` — runs `bwrap [...bwrapArgs, '--', cmd, ...args]` with `env: targetEnv(cfg, port)`; `read = [...cfg.runtimeRead, ...cfg.sandboxRead]`.
  - `runSetup(dir, cfg, port, gitDir) → { ok, failed, output }` — `cfg.setup` under `runConfined(…, network: true, write: cfg.setupWrite)`; same result shape as `runChecks`.
  - `runChecks(dir, cfg, port, gitDir)` — `cfg.checks` under `runConfined(…, network: false, write: [])`. A missing program reports `failed: '<cmd args>'` with the spawn error text (Review Focus 3).
  - `lib/stages.mjs`: replace `deps.run('npm', ['ci'], …)` with `deps.runSetup(ctx.dir, cfg, port, join(p.clone, '.git'))` (park on `!ok` with the fenced output, as today); `verifyAndPush` passes `gitDir` to `runChecks`; `CHECKS_NOTE` becomes `` `Checks run by the factory before pushing (confined, no network): ${cfg.checks.map(c => '`' + [c[0], ...c[1]].join(' ') + '`').join(', ')} — all passed.` ``.
  - `agentSettings(worktreeDir, cfg)` — `allowRead: [FACTORY_ROOT, ...cfg.runtimeRead, ...cfg.sandboxRead]`; `runAgent` passes `targetEnv(cfg, port)` into the session env (new `port` parameter, from `runItem`).
- [ ] **Step 1: Write the failing tests:**
  - `test/confine.test.mjs` (unit): `bwrapArgs` order for checks (`network: false`) contains `--unshare-net` and no write binds besides `dir`; for setup has no `--unshare-net` and binds the expanded `~/.npm`; a non-existing read path is skipped; `targetEnv` replaces `{port}` in every value and leaves others unchanged (Review Focus 4: ports 4201 and 4202 give different values).
  - `test/confine.test.mjs` (real `bwrap`, skipped with a message when the bwrap probe fails): create `~/.cache/factory-canary-<random>` with text `canary` and a temp worktree; `runChecks` with `checks: [['sh', ['-c', 'cat <canary>']]]` → not ok; `[['sh', ['-c', 'echo x > <home>/factory-escape-<random>']]]` → the file does not exist afterwards on the real home; `[['node', ['-e', "require('net').connect(443,'1.1.1.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(3))"]]]` → not ok; `runSetup` with the same network command → ok, and with the `cat` command → not ok; `[['definitely-missing-cmd', []]]` → `failed` is `definitely-missing-cmd`, output mentions `ENOENT` or `not found`. Remove the canary afterwards.
  - stages: `setup runs through runSetup before the first agent session` (replaces the Task-era `npm ci` fake test's mechanism: `d.deps.runSetup` records calls; assertion unchanged in meaning); agent: `agentSettings adds runtime and target read folders`.
  - behaviour: `a non-npm target goes from issue to pull request` → a world whose target has `setup: []`, `checks: [['node', ['--test']]]` and no `package.json` in the seed → PR opened, PR body names `` `node --test` ``.
- [ ] **Step 2: Run** `npm test` — expected: FAIL on the new tests.
- [ ] **Step 3: Implement.** The world's target gets `setup: [['npm', ['ci']]], checks: [['npm', ['test']]]` so phase-1 scenarios keep their meaning.
- [ ] **Step 4: Run** `npm test` — expected: all pass, the real-bwrap tests included.
- [ ] **Step 5: Live check** — `node smoke/containment.mjs` → 8/8.
- [ ] **Step 6: Commit** — `Run setup and checks confined in bwrap`.

### Task 10: Prompts from the target

**Files:**
- Modify: `lib/stages.mjs` (`renderPrompt`), `prompts/_rules.md`, `prompts/merge.md`, `test/stages.test.mjs`

**Interfaces:**
- Produces: `renderPrompt(name, vars)` gains two always-present variables filled by `runItem` from `cfg`: `{{checks}}` — the check commands as a bullet list of `` `cmd args` `` (or `(none)`), and `{{protected}}` — built-ins + target files/dirs as `` `a`, `b` `` + `, existing tests in ` + test dirs. `_rules.md`'s protected line becomes ``Do not modify, rename or delete existing tests ({{protected}}). Adding new test files is expected.``; `merge.md`'s test line becomes ``Run these checks before you finish; all must pass:\n{{checks}}``.
- [ ] **Step 1: Write the failing tests:** `prompts name the target's checks and protected files` → render `merge` for a target with `checks: [['gradle', ['test']]]`, `protectedFiles: ['build.gradle']`, `testDirs: ['src/test/']` → contains `` `gradle test` ``, `` `build.gradle` ``, `src/test/`, `AGENTS.md`; contains none of `npm`, `e2e`, `playwright`. Same check over every prompt name (`gate`, `implement`, `review`, `fix`, `rework`, `merge`, `explore`).
- [ ] **Step 2: Run** `npm test` — FAIL. **Step 3: Implement.** **Step 4: Run** — pass.
- [ ] **Step 5: Commit** — `Render the agents' rules from the target`.

### Task 11: Startup checks — base branch, drift, old layout, labels

**Files:**
- Create: `lib/startup.mjs`, `test/startup.test.mjs`
- Modify: `lib/github.mjs` (two functions), `test/behavior/fakes/gh.mjs` (two commands), `test/behavior/fake-gh.test.mjs`, `factory.mjs`, `lib/workspace.mjs` (one function)

**Interfaces:**
- Produces:
  - `driftWarnings(cfg, exists: (path) => boolean) → string[]` — for each `cfg.testDirs`, `cfg.protectedFiles`, `cfg.protectedDirs` entry where `!exists(entry)`: `` `<entry>` is in targets/<target>.mjs but not on <baseBranch> — update the target file `` (built-ins exempt).
  - `oldLayoutWarning(factoryRoot) → string|null` — when `<factoryRoot>/repo/.git` exists: `an old single-target clone is at <factoryRoot>/repo — see "Moving to runs/" in the README`.
  - `ws.pathsOnBase(clone, baseBranch) → Set<string>` — files and every parent folder with a trailing `/`, from `git ls-tree -r --name-only origin/<base>`.
  - `ws.hasRemoteBranch(clone, baseBranch) → boolean`.
  - `gh.listLabels(cfg) → string[]` (`api repos/<repo>/labels --paginate --jq .[].name`), `gh.createLabel(cfg, name)` (`api -X POST repos/<repo>/labels -f name=<name> -f color=ededed`); the fake `gh` supports both.
  - In `factory.mjs` after `ensureClone`: stop with `base branch "<b>" not found on <repo>` when missing; log each warning as `warning: …`; create each missing `agent:*` label and log `created label <name>`.
- [ ] **Step 1: Write the failing tests:** unit tests for `driftWarnings` (missing vs present; built-ins never warned), `oldLayoutWarning` (temp dir with and without `repo/.git`); fake-gh contract tests for `listLabels`/`createLabel`; behaviour: `startup creates missing labels and warns about drift` → world target with `testDirs: ['spec/']` → output includes ``warning: `spec/` is in targets/`` and the fake state has all seven `agent:*` labels; `a missing base branch stops the factory` → target `baseBranch: 'nope'` → exits 1, output includes `base branch "nope" not found`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — pass.
- [ ] **Step 5: Commit** — `Check the target at startup and create missing labels`.

### Task 12: The factory as its own target; smoke; README

**Files:**
- Create: `targets/issue-to-pr-factory.mjs`, `AGENTS.md`, `smoke/checks.mjs`
- Delete: `smoke/e2e.mjs`
- Modify: `package.json` (`"smoke:checks": "node smoke/checks.mjs"`), `README.md`

**Interfaces:**
- Produces:
  - `targets/issue-to-pr-factory.mjs`: `repo: 'dennis-brutski/issue-to-pr-factory'`, `baseBranch: 'main'`, `setup: []`, `checks: [['npm', ['test']]]`, `testDirs: ['test/']`, `protectedFiles: ['lib/agent.mjs', 'lib/brakes.mjs', 'lib/checks.mjs', 'lib/confine.mjs', 'lib/eligibility.mjs', 'prompts/_rules.md', 'config.mjs', 'package.json']`, `protectedDirs: ['targets/', 'smoke/']`.
  - `AGENTS.md` (under 60 lines): how to test (`npm test`, behaviour tests included); where things go (`lib/` pure logic vs adapters, `prompts/`, `targets/`, `test/`, `test/behavior/`, `smoke/`); test first; no dependencies; small changes, match the file's style; commit subject short and imperative, no trailers; the protected files above are off limits; a new `gh` call needs the fake `gh` to learn it.
  - `smoke/checks.mjs <target>`: loads the target, prepares worktree `issue-0` in its run folder, runs `runSetup` then one real agent session that runs each check command once inside the agents' sandbox and reports exit codes; then `runChecks` (confined). Prints `PASS`/`FAIL` per command; exit 0 only if all pass.
  - README: targets (adding one, `npm start [-- <target>]`), run folders, startup warnings, confinement of setup and checks (replacing the "known ceiling" paragraph), the workflow rule, behaviour tests, and **"Moving to runs/"**: stop the factory; `mkdir -p runs/gin-rummy-score-pad && mv repo worktrees logs runs/gin-rummy-score-pad/`; `git -C runs/gin-rummy-score-pad/repo worktree repair ../worktrees/*`; or delete them for a fresh clone.
- [ ] **Step 1: Write the failing test:** `the factory target protects its own confinement` in `test/settings.test.mjs` → load `issue-to-pr-factory`; `protectedPathViolations` flags `M lib/agent.mjs`, `M targets/x.mjs`, `M smoke/containment.mjs`; does not flag `M lib/loop.mjs`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Write the target, `AGENTS.md`, `smoke/checks.mjs`, README.** **Step 4: Run** `npm test` — pass.
- [ ] **Step 5: Live checks (Dennis present):**
  - `npm run smoke` → 8/8.
  - Move the score pad's state as the README says.
  - `npm run smoke:checks -- gin-rummy-score-pad` → all PASS (e2e with Chromium inside both sandboxes).
  - `npm run smoke:checks -- issue-to-pr-factory` → all PASS.
  - `npm start -- issue-to-pr-factory` → labels created on GitHub, no drift warnings, `0 eligible`; Ctrl-C. Same for `gin-rummy-score-pad`; `npm start` without a target lists both.
  - Dennis files one small real issue on `issue-to-pr-factory`, labels it; expected: a pull request (draft if it touches a protected file).
- [ ] **Step 6: Commit** — `Make the factory a target of itself`.

---

## Known ceilings (deliberate)

- The fake `gh` can drift from the real one; real-GitHub checks and real-Claude drills stay manual (spec, Phase 1 limits).
- Unchanged CI workflows still run agent-written code on GitHub's throwaway machines after a push.
- `gh` is logged in as Dennis, so labels the factory applies also count as "applied by the owner".
