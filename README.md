# issue-to-pr-factory

A software factory for a single maintainer (for now). It turns labelled GitHub
issues into checked pull requests, with Claude Code agents confined in a sandbox.

It takes the operational work off you and leaves you time for the strategic
work, with fewer context switches. You write issues, label them, start the
factory and do something else. The factory runs the agents. You come back and
review and merge pull requests and answer comments in one batch.

Two hard guarantees:
- **It runs only while you have started it.** No service, no schedule, no webhook.
- **It never pushes to the base branch.** It pushes `factory/issue-<n>` branches only. It never merges either, unless you turn on `autoMerge` for a repository you point it at; then it hands only small, simple, cleanly reviewed pull requests to GitHub's auto-merge.

The factory has no dependencies: Node's standard library, `gh`, `git`, `bwrap` and `claude`.

## A day with the factory

```mermaid
flowchart TD
  write["You write issues and label them"]:::you --> start["You start the factory and do something else"]:::you
  start --> work["The factory explores, implements and reviews"]:::factory
  work --> prs["Pull requests wait"]:::factory
  work --> stops["Stops wait with a question"]:::stop
  prs --> batch["You review in one batch"]:::you
  stops --> batch
  batch -->|"good"| merge["You merge"]:::you
  batch -->|"needs changes"| comment["You comment and add agent:review"]:::you
  comment --> work
  classDef you fill:#1d76db,stroke:#0b4f99,color:#ffffff
  classDef factory fill:#eeeeee,stroke:#888888,color:#222222
  classDef stop fill:#f0883e,stroke:#b35900,color:#ffffff
```

Blue is you, grey is the factory, orange is a stop.

Two words for two kinds of stopping:
- **A stop (park):** one issue or pull request waits with a 🏭 comment saying why and the `agent:needs-human` label. Nothing retries it until you remove the label. Other issues go on.
- **The factory stops:** the whole process exits. It does that on Ctrl-C, when it cannot start (no sandbox, `gh` logged in as someone else), and when an agent changed the clone's git config.

![The factory's terminal during an implement run: one line per agent session, with turns, time, tokens and cost](docs/img/terminal-run.png)

Until the screenshot is there, this is what the terminal shows for one implement run. Its first step is **the gate**: a read-only session scores how clear the issue is from 0 to 100, parks it with questions below `confidenceThreshold`, and rates its difficulty, which picks the model (details under *How a run works*).

```text
23:44:10  🏭 factory started for you/your-repo (your-repo) — polling every 5 min, up to 2 at a time
23:44:12  #47 │ ▶ implement started (Show the score after each round)
23:44:13  #47 │   gate       ·   started
23:44:16  #47 │   gate       ·   3 turns ·      3s ·   37k in  (63% cached) ·  260 out ·  ≈ $0.06
23:44:16  #47 │   implement  ·   started
23:45:07  #47 │   implement  ·  13 turns ·     51s ·  280k in  (90% cached) · 3.9k out ·  ≈ $0.35
23:45:07  #47 │   review     ·   started
23:45:47  #47 │   review     ·   6 turns ·     40s ·  120k in  (85% cached) · 1.2k out ·  ≈ $0.12
23:46:30  #47 │ ✔ implement done in 2m 17s · 3 sessions · ≈ $0.53:
          #47 │   https://github.com/you/your-repo/pull/48
23:46:30  ◦ waiting for labelled issues · next check at 23:51:30
```

## Trust model

- **Trusted:** the base commit GitHub reports, your review, and the confinement.
- **Assumed hostile:** issue text, agent output, and branch code until the checks pass.
- Treat issue text as untrusted input: it goes into every prompt.
- Only labels and comments by you count; anyone else's are ignored.

## ⚠ Risks you accept

- ⚠ Agents run Claude Code with your login (`~/.claude`) and spend your Claude plan.
- ⚠ After a push, unchanged CI workflows run the branch's code on GitHub's machines.
- ⚠ With `autoMerge`, auto-merged code reaches the base branch before you read it. Read the merged pull requests afterwards and revert what you do not like.
- ⚠ With two runs at once, git commands for one can run in the short window after the other's agent session changed the clone's git config and before the next check. Upgrade path: run the factory's own git confined as well, and push from a clone agents never touch.
- ⚠ Setup has network and runs code from the branch (install scripts, for example) that you have not read.
- ⚠ The sandbox is only as good as `bwrap` and Claude Code's sandbox.

What the factory does about it: see *Confinement and brakes* below. To report a way out of the confinement, see `SECURITY.md`.

## Getting started

You need:
- **Linux with `bwrap`** (bubblewrap), with unprivileged user namespaces allowed. `bwrap --ro-bind / / --dev /dev true` must succeed.
- **`socat`**, which Claude Code's sandbox needs on Linux next to `bwrap` (see its docs). Without it every agent session fails; `npm run smoke` shows it.
- **Node.js.** If Node lives in your home folder but not in `~/.nvm` (fnm, volta, `~/.local`), add that folder to `runtimeRead` in `local.mjs` (step 1).
- **Claude Code** (`claude`), logged in with your Claude account, with access to the models in `config.mjs`.
- **`gh`**, logged in as you (`gh auth login`). For a **private repo**, also run `gh auth setup-git`: the factory clones, fetches and pushes over https.
- **A git identity** (`git config --global user.name` and `user.email`).

Then:
1. Create `local.mjs` next to `config.mjs` for your own settings. It is git-ignored and goes over `config.mjs`; the file for one repository (step 2) goes over both.
   ```js
   export default { owner: 'your-github-login', ownerName: 'Alex' };
   ```
   `owner` is your GitHub login: only labels and comments by that account count, and `gh` must be logged in as it. In the rest of this README, "you" means the owner. `ownerName` is what the agents call you.
2. Write `targets/<name>.mjs` for your repository, a **target** (fields under *Targets*). Leave the two example targets in place: the tests use them. A minimal one:
   ```js
   export default {
     repo: 'you/your-repo', baseBranch: 'main',
     setup: [['npm', ['ci', '--ignore-scripts']]], checks: [['npm', ['test']]], testDirs: ['test/'],
     protectedFiles: ['package.json', 'package-lock.json'],
     env: { npm_config_cache: '{runDir}/npm-cache' }, setupWrite: ['{runDir}/npm-cache'],
   };
   ```
   Setup has network but no home folder; checks have no network at all. Install scripts run during setup, with network, on code nobody has read yet, so this example turns them off with `--ignore-scripts`. The score pad's target uses plain `npm ci`, because its dependencies need their install scripts.
3. Give your repo an `AGENTS.md`: how to run its tests, where things go, its rules. Copy `.github/ISSUE_TEMPLATE/agent-task.md` into the target repo at the same path, so issues come with acceptance criteria.
4. Run `npm run smoke` once, and `npm run smoke:checks -- <name>` for each target. Each runs one real agent session (uses your Claude plan).
5. `npm start -- <name>`.

Day to day: write an issue as clearly as for a colleague, add `agent:implement` (or `agent:explore` when unsure), and do something else. It ends in a pull request (`agent:done`) or a stop (`agent:needs-human`, with a comment saying why). Review the pull request; to have it changed, comment and add `agent:review`. You merge, unless `autoMerge` is on.

## Use

```sh
npm start                          # the only target, when there is just one
npm start -- gin-rummy-score-pad   # one factory per target; several can run side by side
```

- With several targets and no name, `npm start` does not start: it prints `factory cannot run: choose a target: <names> (npm start -- <target>)` and exits.
- **One factory per target.** A lock in `runs/<target>/factory.lock` holds it; a second start for the same target refuses with `already running (pid <n>)`. A lock left by a process that died is taken over.
- **Ctrl-C** stops picking up work and lets running agents finish.
- **Ctrl-C again** kills them at once. Their commits are kept and resume on the next start; uncommitted changes park the issue.

For *a stop (park)* versus *the factory stops*, see *A day with the factory*.

## Labels

You set one of these. Only labels **you** applied count.

| Label | On | What happens |
|---|---|---|
| `agent:explore` | issue | A write-up is posted. If the change is easy to undo and small, it moves on to implement by itself. |
| `agent:implement` | issue | It is built test-first, reviewed, checked, and opened as a pull request. |
| `agent:review` | pull request | **Rework:** an agent session addresses your comments since the branch's last commit, answers in a 🏭 Rework comment, and the change is checked and pushed. The label is removed when done. On a stop it stays; removing `agent:needs-human` runs the rework again. |
| `agent:merge` | pull request | The base branch is merged in and conflicts are resolved. The label is removed when done. The factory also does this by itself, without the label, when one of its own pull requests conflicts with the base branch. |

The factory sets these:

| Label | Meaning |
|---|---|
| `agent:in-progress` | A run is working on it right now. Removed when the run ends, whatever the outcome; after a kill or crash, removed on the next start. |
| `agent:needs-human` | Stopped. The newest factory comment says why. **Remove this label to try again.** |
| `agent:done` | The pull request is open. |

Comments you write on a labelled issue or pull request are instructions for the agent's next run, its review and its fix step. The factory's own comments start with 🏭 and are not passed on as requests.

```mermaid
stateDiagram-v2
  direction LR
  state "agent:explore" as explore
  state "agent:implement" as implement
  state "agent:in-progress" as working
  state "agent:needs-human" as parked
  state "agent:done, pull request open" as opened
  state "agent:review on the pull request" as rework
  state "pull request conflicts" as conflict
  state "merged" as merged
  [*] --> explore
  [*] --> implement
  explore --> working
  implement --> working
  working --> implement : explore found it small and easy to undo
  working --> parked : stop
  parked --> working : you remove the label
  working --> opened : pull request opened
  opened --> rework : you comment and add the label
  rework --> opened : rework pushed, label removed
  opened --> conflict : the base branch moved on
  conflict --> opened : the factory merges the base in
  opened --> merged : you merge, or auto-merge
  classDef you fill:#1d76db,stroke:#0b4f99,color:#ffffff
  classDef factory fill:#eeeeee,stroke:#888888,color:#222222
  classDef stop fill:#f0883e,stroke:#b35900,color:#ffffff
  class explore,implement,rework you
  class working,opened,conflict,merged factory
  class parked stop
```

## How a run works

```mermaid
flowchart TD
  start["Merge the base branch in, run setup"]:::factory --> gate["Gate: how clear is the issue, 0 to 100?"]:::factory
  gate -->|"below confidenceThreshold"| ask["Stop with questions"]:::stop
  gate --> impl["Implement, test-first"]:::factory
  impl --> review["Review, read-only"]:::factory
  review -->|"clean"| checks["Brakes and the factory's own checks"]:::factory
  review -->|"findings"| fix["Fix"]:::factory
  fix -->|"autoMerge off"| checks
  fix -->|"autoMerge on"| review2["Second review"]:::factory
  review2 --> checks
  checks -->|"fail"| failed["Stop with the reason"]:::stop
  checks --> push["Push exactly the checked commit"]:::factory
  push --> pr["Pull request"]:::factory
  pr -->|"protected files changed"| draft["Draft pull request, stop"]:::stop
  pr --> auto{"Auto-merge?"}:::factory
  auto -->|"simple, clean, under 100 lines"| merged["GitHub auto-merge"]:::factory
  auto -->|"otherwise"| byYou["You review and merge"]:::you
  classDef you fill:#1d76db,stroke:#0b4f99,color:#ffffff
  classDef factory fill:#eeeeee,stroke:#888888,color:#222222
  classDef stop fill:#f0883e,stroke:#b35900,color:#ffffff
```

- **Polling:** every `pollSec` (5 minutes) it lists all open issues and pull requests with a factory label (paged, oldest first) and starts up to `maxParallel` (2) at a time.
- **Conflicts:** each poll also lists all open pull requests. One of its own (`factory/issue-<n>` branch in the target repo, opened by you) that GitHub reports as conflicting and that has no factory label gets a `merge` run, as if you had added `agent:merge`. If that stops, it waits for you to remove `agent:needs-human`.
- **Worktree:** one per issue, `runs/<target>/worktrees/issue-<n>` on branch `factory/issue-<n>`; a pull request shares its issue's. Before `explore` and `implement` the latest base branch is merged in, never rebased; a conflict parks. The worktree is removed once the issue is closed or its pull request merged or closed.
- **Setup** runs before every run's first agent session, confined, with network: the agents' sandbox has none, so dependencies are installed first.
- **Port:** each run gets a free port from the operating system, the same one for setup, sessions and checks.
- **Explore:** one read-only session writes up the cause or the shape of the change, the files it touches and its side effects. It needs no network: it reads the code and history, and can run the tests in its sandbox to reproduce a bug. If it judges the change easy to undo (one `git revert`) and small in reach, it swaps `agent:explore` for `agent:implement`; otherwise it stops for your decision.
- **The gate:** the first step of `implement`. A read-only session scores how clearly the issue can be built as written, from 0 to 100. Below `confidenceThreshold` (70) it parks with its questions. It also rates the difficulty (`simple`, `normal`, `hard`): a `simple` issue gets its first draft from `simpleModel`, unless it is likely to touch protected files or the last run stopped. Review and fixes always use `model`.
- **Implement:** implement → review (read-only) → fix, if there were findings → the brakes and the factory's own checks → push of exactly the checked commit → pull request. The pull request is a **draft** only when the branch changes protected files; the run then stops so you read that part. Mark it ready yourself after reading; the factory never does. Removing `agent:needs-human` from the issue starts another implement run on the same branch.
- **Auto-merge:** with `autoMerge: true`, an `implement` run calls `gh pr merge --squash --auto` on its pull request only when all of these hold, and says so in a comment:
  1. the pull request is not a draft;
  2. the gate rated the issue `simple`;
  3. the review was clean, or it had findings, the fix finished and a second review after the fix was clean (that second review runs only with `autoMerge`);
  4. fewer than 100 lines changed (additions + deletions, as GitHub counts them);
  5. it is an `implement` run: `agent:review` and `agent:merge` runs never auto-merge.

  Otherwise the terminal line says which one failed (`not auto-merged: …`), with no comment. If GitHub refuses (auto-merge not allowed in the repo settings, or anything else), a comment says why and asks you to merge it by hand; the run still ends `done`. With required checks, GitHub waits for them.
- **Retry:** the steps that change code (`implement`, `fix`, `rework`, `merge`) are told why the last run stopped: the newest "Factory stopped" comment since the last commit, marked as information. Gate, review and explore judge without it.
- **Brakes:** before every push the branch is checked against the base commit GitHub reports (`git ls-remote`), not the clone's own ref. Changed workflow files stop the push; commits with **attribution lines** (`Co-Authored-By`, "Generated with", `Claude-Session` trailers, which commits must not carry) stop it too; changed protected files, changed existing tests and added skips or `.only` make the pull request a draft. Lines only added to a `testSupport` file are listed in the pull request instead.

## When it stops (`agent:needs-human`)

| The comment says | What to do |
|---|---|
| not clear enough to build without guessing | Answer the questions in a comment, remove the label. |
| needs your decision: not clearly easy to undo and small in reach | Read the write-up. To go ahead, swap `agent:explore` for `agent:implement` and remove the label. |
| the agent could not finish / produced no changes | Read what is missing; sharpen the issue or do it by hand. |
| no new comments from you since the last push | `agent:review` found nothing to address. Write your comments, then remove the label. |
| the worktree has uncommitted changes | A run was killed mid-session. Commit or discard the changes in `runs/<target>/worktrees/issue-<n>`, remove the label. |
| the branch conflicts with the latest base | Merge the base branch in by hand in the worktree, remove the label. |
| a check failed / setup failed | The output is in the comment. Remove the label for another attempt on the same branch. |
| the branch changes protected files, so the factory did not run setup | An earlier run committed a change to a protected file, and setup has network. Review it in the worktree; merge or revert it, remove the label. |
| draft because it touches protected files | The agent changed existing tests, skipped or singled out a test, or changed CI, config or a protected file. Review that part yourself, then mark the pull request ready and merge, or comment and add `agent:review` to it. |
| a held-out check failed | The output is in the factory's terminal, not in the comment. Sharpen the issue or fix it by hand, remove the label. |
| changes CI workflow files, so the factory did not push it | GitHub would run that workflow the moment it is pushed. Read the diff in the comment; if it is right, push the branch from `runs/<target>/worktrees/issue-<n>` yourself. |
| commits must not carry attribution lines | An agent added a co-author or similar trailer. Reword the commits in the worktree, remove the label. |
| the worktree's .git link / the clone's git config was changed | A session tried to change where git looks or what it runs. The factory stops entirely. Read the session log, fix or delete `runs/<target>/repo`, then start again. |
| **Factory did not start:** issue text was edited / issue title was changed after it was approved | An issue someone else opened was edited after you labelled it (by anyone, you included), or someone else renamed it, so the factory did not run it. Re-read it, remove the label to approve it again. |
| timed out / max_turns / usage limit / spent its budget | Remove the label when you want it to continue. A budget stop comes from `maxBudgetUsd`. |

Nothing is ever retried on its own.

![A stop comment from the factory on an issue, saying why it stopped and to remove agent:needs-human to try again](docs/img/stop-comment.png)

![An explore write-up comment, ending with whether the change is easy to undo and small in reach](docs/img/explore-writeup.png)

![A pull request opened by the factory: what changed, the checks it ran, and how it was built](docs/img/pull-request.png)

## Targets

One file per repo in `targets/`, on top of the shared defaults in `config.mjs` and your `local.mjs`:

| Field | Example (score pad) |
|---|---|
| `repo`, `baseBranch` (required) | `dennis-brutski/gin-rummy-score-pad`, `master` |
| `setup` — run before the first agent session | `[['npm', ['ci']]]` |
| `checks` — run before every push; agents are told to run them too | `[['npm', ['test']], ['npm', ['run', 'e2e']]]` |
| `env` — for setup, checks and agent sessions | `{ E2E_PORT: '{port}', npm_config_cache: '{runDir}/npm-cache' }` |
| `testDirs` — changing an existing test there, or adding a skip or `.only`, is flagged | `['test/', 'e2e/']` |
| `testSupport` — fakes and contract tests in `testDirs` that agents may extend: lines only added there are a note, not a draft | `['test/fakes/']` |
| `heldOutChecks`, `heldOutDir` — checks with tests agents never see, kept outside `runs/`. A failure parks without its output, which goes to the terminal | `[['node', ['--test', '{heldOut}/']]]`, `'~/held-out/score-pad'` |
| `protectedFiles`, `protectedDirs` — flagged when changed | `['playwright.config.js', 'package.json', …]` |
| `runtimeRead` — home folders everything may read: the Node install. Default `['~/.nvm']`; usually set in `local.mjs`, since it is about your machine | `['~/.local/share/fnm']` |
| `sandboxRead` — extra home folders agents, setup and checks may read | `['~/.cache/ms-playwright']` |
| `setupWrite` — caches setup may write; keep them in `{runDir}`, never your own (`~/.npm`) | `['{runDir}/npm-cache']` |
| `autoMerge` — hand small, simple, cleanly reviewed pull requests to GitHub's auto-merge (see *How a run works*). Off unless set; turn it on in `local.mjs` | `true` |

Placeholders, and where each one works:

| Placeholder | Becomes | Works in |
|---|---|---|
| `{port}` | the run's own free port | `env` values, `setupWrite` |
| `{runDir}` | the target's run folder, `runs/<target>` | `env` values, `setupWrite` |
| `{heldOut}` | `heldOutDir` | `heldOutChecks` arguments |

They are not filled in anywhere else, not even in `setup` and `checks` arguments: pass a port to those through `env`.

`AGENTS.md`, `CLAUDE.md`, `.github/` and `.claude/` are protected on every target; a target can add to that list, never remove from it.

To add a repo, follow *Getting started*. Missing `agent:*` labels are created on the first start, with their colours.

## Settings you change

`config.mjs` holds the shared defaults. Change them in `local.mjs` (for every target) or in a target file (for one).

| Key | Default | What |
|---|---|---|
| `maxParallel` | 2 | runs at a time |
| `confidenceThreshold` | 70 | the gate score an issue needs before it is built |
| `maxTurns` | 150 | turns per agent session |
| `sessionTimeoutMin` | 45 | minutes per agent session |
| `checkTimeoutMin` | 15 | minutes per setup or check command |
| `model` | `opus` | every session except the gate and the first draft of simple issues |
| `gateModel` | `sonnet` | the gate (it only reads and scores); unset, the gate uses `model` |
| `simpleModel` | `sonnet` | the first draft of `simple` issues; unset, `model` |
| `pollSec` | 300 | seconds between polls |
| `autoMerge` | off | see *How a run works* |
| `maxBudgetUsd` | `null` | what one agent session may spend, by Claude Code's own estimate; `null` means no cap |

## Confinement and brakes

- ✅ **Agents** run in Claude Code's sandbox: no network, no `git push`, no `gh`, no web tools, writes only in their worktree.
- ✅ **What agents can read**, all of it in one place: their worktree; the target's run folder `runs/<target>/` (its clone, the other worktrees and the logs), never the factory folder, which holds every target's; the `runtimeRead` and `sandboxRead` folders; the factory's `skills/` folder, read-only. Claude Code itself reads your login in `~/.claude`. The rest of the home folder is hidden.
- ✅ Agents get only an allowlisted environment: no tokens, API keys or agent sockets.
- ✅ **Setup and checks**, which run the branch's code before you have read it, run under `bwrap`: the system read-only, the home folder hidden except `runtimeRead` and `sandboxRead`, `/run` and `/tmp` empty, the clone's git data read-only, writes only to the worktree (and, for setup, `setupWrite`). Setup has network, to download dependencies; checks have none. Held-out checks also read `heldOutDir`.
- ✅ Setup does not run on a branch that already changes protected files, since it has network.
- ✅ **Workflow files** under `.github/workflows/` are never pushed by the factory.
- ✅ Workflow files, protected files and attribution lines are checked against the base commit GitHub reports (`git ls-remote`), not the clone's own ref.
- ✅ **Git itself:** the factory's own git commands read the clone's `.git/config`, which agents can write. Before any git command runs on a worktree (and on every poll) the config must hold only what a plain clone holds and `origin` must be the target repo; otherwise the issue parks and the factory stops. The factory's git also ignores replace refs and grafts, which could show a different history than the one pushed.
- ✅ The factory pushes exactly the commit it checked.
- ✅ If the sandbox cannot start, the factory refuses to start.

What stays outside: see *⚠ Risks you accept* above.

## Startup warnings

- `` warning: `spec/` is in targets/<name>.mjs but not on main — update the target file `` — the target file no longer matches the repo; a protection or test folder does nothing until you fix it.
- `` warning: an old single-target clone is at …/repo — see "Moving to runs/" in the README `` — see *Moving to runs/* at the end.

## Statistics

```sh
npm run stats                                     # every target in targets/, one after another
npm run stats -- <target> --since 2026-11-01      # one target; only pull requests opened and comments made on or after that day
```

Without a target it prints each target under its own heading; `--since` applies to all of them. A target that cannot be read prints `<target>: could not read stats: <reason>`, the others still print, and the exit code is 1.

It prints how many pull requests from `factory/issue-*` branches of the target repo (no forks) were opened, merged, closed unmerged and are still open, and how often the factory stopped, grouped by a short label for each stop reason. The line `auto-merged: N · reverted: M` counts your "Auto-merge" comments and how many of those pull requests a merged revert undid: a merged pull request titled `Revert "<title>"` (the title GitHub's revert button gives it) counts as a revert. It counts your own "Factory stopped" and "Factory did not start" comments on every issue and pull request; "no new comments" stops are left out. A reason without a label shows as `other:` and its first 60 characters. Use these numbers before changing `confidenceThreshold`. It only reads from GitHub.

![The output of npm run stats for one target: pull requests opened and merged, and stops by reason](docs/img/stats.png)

## Files

- `config.mjs` — shared defaults (see *Settings you change*), labels.
- `local.mjs` — your own settings over those defaults (not in git).
- `targets/` — one settings file per repo.
- `prompts/` — what each agent step is told.
- `skills/` — the skills agents may use, read-only.
- `runs/<target>/` — the target's clone (`repo/`), per-issue worktrees and logs, and its lock (not in git).

## Testing the factory

```sh
npm test                           # unit and behaviour tests; no network or logins needed
npm run smoke                      # proves an agent cannot escape its worktree; runs one real agent session (uses your Claude plan)
npm run smoke:checks -- <target>   # the target's setup and checks, inside the agent sandbox and confined; runs one real agent session (uses your Claude plan)
```

In `smoke:checks`, setup runs confined with network, as in a real run. Then the checks run twice without network: once inside an agent session's sandbox, once confined by the factory.

When the suite runs inside an agent sandbox (no nested bwrap, no network), the bwrap and network tests skip or use a stand-in. The factory's own check run outside the sandbox runs them for real.

## License

MIT, see `LICENSE`.

## History

Design notes and plans are in `docs/superpowers/`.

## Moving to runs/

Before targets, the clone, worktrees and logs lived at the top of this folder. Stop the factory, finish or park open work, run `rm -rf repo worktrees logs factory.lock`; each target clones afresh into `runs/<target>/`.
