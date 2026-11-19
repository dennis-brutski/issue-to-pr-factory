# issue-to-pr-factory

Turns labelled GitHub issues into checked pull requests, for any repository you
add as a target. It runs only while you have started it. It never merges unless
you turn on `autoMerge` for a target, and then only small, simple, cleanly
reviewed pull requests. It never pushes to a target's base branch.

Design and plan: `docs/superpowers/specs/2026-11-17-multi-target-design.md` and
`docs/superpowers/plans/2026-11-17-multi-target.md` (earlier: the score pad's
`docs/superpowers/specs/2026-11-10-software-factory-design.md`).

## Getting started

You need:
- **Linux with `bwrap`** (bubblewrap), with unprivileged user namespaces allowed. `bwrap --ro-bind / / --dev /dev true` must succeed.
- **`socat`**, which Claude Code's sandbox needs on Linux next to `bwrap` (see its docs). Without it every agent session fails; `npm run smoke` shows it.
- **Node.js.** The factory has no dependencies. If Node lives in your home folder but not in `~/.nvm` (fnm, volta, `~/.local`), add that folder to `runtimeRead` in `local.mjs` (step 1).
- **Claude Code** (`claude`), logged in with your Claude account, with access to the model in `config.mjs`.
- **`gh`**, logged in as you (`gh auth login`). For a **private repo**, also run `gh auth setup-git`: the factory clones, fetches and pushes over https.
- **A git identity** (`git config --global user.name` and `user.email`).

Then:
1. Create `local.mjs` next to `config.mjs` for your own settings. It is git-ignored and goes over `config.mjs`; a target file goes over both.
   ```js
   export default { owner: 'your-github-login', ownerName: 'Alex' };
   ```
   Only labels and comments by `owner` count, and `gh` must be logged in as that account. `ownerName` is what the agents call you.
2. Write `targets/<name>.mjs` (fields below). Leave the two example targets in place: the tests use them. A minimal one:
   ```js
   export default {
     repo: 'you/your-repo', baseBranch: 'main',
     setup: [['npm', ['ci', '--ignore-scripts']]], checks: [['npm', ['test']]], testDirs: ['test/'],
     protectedFiles: ['package.json', 'package-lock.json'],
     env: { npm_config_cache: '{runDir}/npm-cache' }, setupWrite: ['{runDir}/npm-cache'],
   };
   ```
   Setup has network but no home folder; checks have no network at all. Install scripts run with network, so turn them off unless the repo needs them.
3. Give your repo an `AGENTS.md`: how to run its tests, where things go, its rules. Copy `.github/ISSUE_TEMPLATE/agent-task.md` into it, so issues come with acceptance criteria.
4. Run `npm run smoke` once, and `npm run smoke:checks -- <name>` for each target. Both use Claude usage.
5. `npm start -- <name>`.

Day to day: write an issue as clearly as for a colleague, add `agent:implement` (or `agent:explore` when unsure), and watch the terminal. It ends in a pull request (`agent:done`) or a stop (`agent:needs-human`, with a comment saying why). Review the pull request; to have it changed, comment and add `agent:review`. You merge; the factory never does.

## Use

```sh
npm start                          # the only target, when there is just one
npm start -- gin-rummy-score-pad   # one factory per target; several can run side by side
```

- **Ctrl-C** stops picking up work and lets running agents finish.
- **Ctrl-C again** kills them at once. Their commits are kept and resume on the next start; uncommitted changes park the issue.

## Targets

One file per repo in `targets/`, on top of the shared defaults in `config.mjs`:

| Field | Example (score pad) |
|---|---|
| `repo`, `baseBranch` (required) | `dennis-brutski/gin-rummy-score-pad`, `master` |
| `setup` — run before the first agent session | `[['npm', ['ci']]]` |
| `checks` — run before every push; agents are told to run them too | `[['npm', ['test']], ['npm', ['run', 'e2e']]]` |
| `env` — `{port}` becomes the run's own port, `{runDir}` its run folder | `{ E2E_PORT: '{port}', npm_config_cache: '{runDir}/npm-cache' }` |
| `testDirs` — changing an existing test there, or adding a skip or `.only`, is flagged | `['test/', 'e2e/']` |
| `heldOutChecks`, `heldOutDir` — checks with tests agents never see, kept outside `runs/`; `{heldOut}` is the folder. A failure parks without its output, which goes to the terminal | `[['node', ['--test', '{heldOut}/']]]`, `'~/held-out/score-pad'` |
| `protectedFiles`, `protectedDirs` — flagged when changed | `['playwright.config.js', 'package.json', …]` |
| `sandboxRead` — extra home folders agents, setup and checks may read | `['~/.cache/ms-playwright']` |
| `setupWrite` — caches setup may write; keep them in `{runDir}`, never your own (`~/.npm`) | `['{runDir}/npm-cache']` |
| `autoMerge` — hand small, simple, cleanly reviewed pull requests to GitHub's auto-merge (see *How a run works*). Off unless set; turn it on in `local.mjs` | `true` |

`AGENTS.md`, `CLAUDE.md`, `.github/` and `.claude/` are protected on every target; a target can add to that list, never remove from it.

To add a repo, follow *Getting started*. Missing `agent:*` labels are created on the first start, with their colours.

## Labels

You set one of these. Only labels **you** applied count.

| Label | On | What happens |
|---|---|---|
| `agent:explore` | issue | A write-up is posted. If the change is easy to undo and small, it moves on to implement by itself. |
| `agent:implement` | issue | It is built test-first, reviewed once, checked, and opened as a pull request. |
| `agent:review` | pull request | Your comments since the last push are addressed and answered. The label is removed when done. |
| `agent:merge` | pull request | The base branch is merged in and conflicts are resolved. The label is removed when done. |

The factory sets these:

| Label | Meaning |
|---|---|
| `agent:in-progress` | Being worked on right now. |
| `agent:needs-human` | Stopped. The newest factory comment says why. **Remove this label to try again.** |
| `agent:done` | The pull request is open. |

Comments you write on a labelled issue or pull request are instructions for the agent's next run, its review and its fix step. The factory's own comments start with 🏭 and are not passed on as requests.

## When it stops (`agent:needs-human`)

| The comment says | What to do |
|---|---|
| not clear enough to build without guessing | Answer the questions in a comment, remove the label. |
| needs your decision: not clearly easy to undo and small in reach | Read the write-up. To go ahead, swap `agent:explore` for `agent:implement` and remove the label. |
| the agent could not finish / produced no changes | Read what is missing; sharpen the issue or do it by hand. |
| the worktree has uncommitted changes | A run was killed mid-session. Commit or discard the changes in `runs/<target>/worktrees/issue-<n>`, remove the label. |
| the branch conflicts with the latest base | Merge the base branch in by hand in the worktree, remove the label. |
| a check failed / setup failed | The output is in the comment. Remove the label for another attempt on the same branch. |
| the branch changes protected files, so the factory did not run setup | An earlier run committed a change to a protected file, and setup has network. Review it in the worktree; merge or revert it, remove the label. |
| draft because it touches protected files | The agent changed existing tests, skipped or singled out a test, or changed CI, config or a protected file. Review that part yourself. |
| a held-out check failed | The output is in the factory's terminal, not in the comment. Sharpen the issue or fix it by hand, remove the label. |
| changes CI workflow files, so the factory did not push it | GitHub would run that workflow the moment it is pushed. Read the diff in the comment; if it is right, push the branch from `runs/<target>/worktrees/issue-<n>` yourself. |
| the worktree's .git link / the clone's git config was changed | A session tried to change where git looks or what it runs. The factory stops entirely. Read the session log, fix or delete `runs/<target>/repo`, then start again. |
| issue text was edited / issue title was changed after it was approved | Someone else edited the issue after you labelled it. Re-read it, remove the label. |
| timed out / max_turns / usage limit | Remove the label when you want it to continue. |

Nothing is ever retried on its own.

## Statistics

```sh
npm run stats                                     # every target in targets/, one after another
npm run stats -- <target> --since 2026-11-01      # one target; only pull requests opened and comments made on or after that day
```

Without a target it prints each target under its own heading; `--since` applies to all of them. A target that cannot be read prints `<target>: could not read stats: <reason>`, the others still print, and the exit code is 1.

It prints how many pull requests from `factory/issue-*` branches of the target repo (no forks) were opened, merged, closed unmerged and are still open, and how often the factory stopped, grouped by a short label for each stop reason. The line `auto-merged: N · reverted: M` counts your "Auto-merge" comments and how many of those pull requests a merged revert undid (the branch GitHub's revert button makes, `revert-<n>-…`). It counts your own "Factory stopped" and "Factory did not start" comments on every issue and pull request; "no new comments" stops are left out. A reason without a label shows as `other:` and its first 60 characters. Use these numbers before changing `confidenceThreshold`. It only reads from GitHub.

## How a run works

- **Polling:** every 5 minutes it lists all open issues and pull requests with a factory label (paged, oldest first) and starts up to 2 at a time.
- **Worktree:** one per issue, `runs/<target>/worktrees/issue-<n>` on branch `factory/issue-<n>`; a pull request shares its issue's. Before `explore` and `implement` the latest base branch is merged in, never rebased; a conflict parks.
- **Port:** each run gets a free port from the operating system, the same one for setup, sessions and checks.
- **Implement:** gate (read-only, confidence score) → implement → review (read-only) → fix, if there were findings → the factory's own checks → push of exactly the checked commit → pull request, a draft if protected files changed.
- **Auto-merge:** with `autoMerge: true`, an `implement` run calls `gh pr merge --squash --auto` on its pull request only when all of these hold, and says so in a comment:
  1. the pull request is not a draft;
  2. the gate rated the issue `simple`;
  3. the review was clean, or it had findings, the fix finished and a second review after the fix was clean (that second review runs only with `autoMerge`);
  4. fewer than 100 lines changed (additions + deletions, as GitHub counts them);
  5. it is an `implement` run: `agent:review` and `agent:merge` runs never auto-merge.

  Otherwise the terminal line says which one failed (`not auto-merged: …`), with no comment. If GitHub refuses (auto-merge not allowed in the repo settings, or anything else), a comment says why and asks you to merge it by hand; the run still ends `done`. With required checks, GitHub waits for them.

  ⚠ Auto-merged code reaches the base branch before you read it. Read the merged pull requests afterwards and revert what you do not like.
- **Retry:** the steps that change code (`implement`, `fix`, `rework`, `merge`) are told why the last run stopped: the newest "Factory stopped" comment since the last commit, marked as information. Gate, review and explore judge without it.
- **Brakes:** workflow files, protected files and attribution lines are checked against the base commit GitHub reports (`git ls-remote`), not the clone's own ref.

## Startup warnings

- `` `spec/` is in targets/<name>.mjs but not on main `` — the target file no longer matches the repo; a protection or test folder does nothing until you fix it.
- `an old single-target clone is at …/repo` — see *Moving to runs/* below.

## Confinement

- **Agents** run in Claude Code's sandbox: writes only in their worktree, reads only in the target's own run folder, no network, home folder hidden, no `git push`, no `gh`. They get only an allowlisted environment: no tokens, API keys or agent sockets; `claude` signs in with your login in `~/.claude`.
- **Setup and checks**, which run the branch's code before you have read it, run under `bwrap`: the system read-only, the home folder hidden (except the Node install and the target's `sandboxRead`), writes only to the worktree. Setup has network, to download dependencies; checks have none.
- **Workflow files** under `.github/workflows/` are never pushed by the factory.
- If the sandbox cannot start, the factory refuses to start.

- **Git itself:** the factory's own git commands read the clone's `.git/config`, which agents can write. Before any git command runs on a worktree (and on every poll) the config must hold only what a plain clone holds and `origin` must be the target repo; otherwise the issue parks and the factory stops. The factory's git also ignores replace refs and grafts, which could show a different history than the one pushed. The factory pushes exactly the commit it checked.

What stays outside:
- After a push, unchanged CI workflows run the branch's code on GitHub's machines.
- With two issues running at once, git commands for one can run in the short window after the other's agent session changed the config and before the next check. Upgrade path: run the factory's own git confined as well, and push from a clone agents never touch.

## Files

- `config.mjs` — shared defaults: limits (2 at a time, confidence 70, timeouts), model, labels.
  `gateModel` is the model for the gate alone (it only reads and scores); unset, the gate uses `model`.
- `local.mjs` — your own settings over those defaults (not in git).
- `targets/` — one settings file per repo.
- `prompts/` — what each agent step is told.
- `runs/<target>/` — the target's clone (`repo/`), per-issue worktrees and logs, and its lock (not in git).

## Checks

```sh
npm test                           # unit and behaviour tests
npm run smoke                      # one real agent session; proves it cannot escape its worktree (uses Claude usage)
npm run smoke:checks -- <target>   # the target's setup and checks, inside the agent sandbox and confined (uses Claude usage)
```

Agents run `npm test` inside their own sandbox, where bwrap cannot start: tests that need real bwrap are skipped there, and behaviour tests use a stand-in. Tests that need network skip where there is none. The factory's own check run, outside the agent sandbox, runs the bwrap tests for real.

## Moving to runs/

Before targets, the score pad's clone, worktrees and logs lived at the top of this folder (`repo/`, `worktrees/`, `logs/`). Stop the factory, finish or park any open work, then delete them:

```sh
rm -rf repo worktrees logs factory.lock
```

On its next start each target clones afresh into `runs/<target>/`. Branches already pushed (`factory/issue-<n>`) are picked up from GitHub again.
