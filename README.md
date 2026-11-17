# issue-to-pr-factory

Turns labelled GitHub issues into checked pull requests, for any repository you
add as a target. It runs only while you have started it. It never merges and
never pushes to a target's base branch.

Design and plan: `docs/superpowers/specs/2026-11-17-multi-target-design.md` and
`docs/superpowers/plans/2026-11-17-multi-target.md` (earlier: the score pad's
`docs/superpowers/specs/2026-11-10-software-factory-design.md`).

## Use

```sh
npm start                          # the only target, when there is just one
npm start -- gin-rummy-score-pad   # one factory per target; several can run side by side
```

- **Ctrl-C** stops picking up work and lets running agents finish.
- **Ctrl-C again** kills them at once. Their work is kept and resumes on the next start.

## Targets

One file per repo in `targets/`, on top of the shared defaults in `config.mjs`:

| Field | Example (score pad) |
|---|---|
| `repo`, `baseBranch` (required) | `dennis-brutski/gin-rummy-score-pad`, `master` |
| `setup` — run before the first agent session | `[['npm', ['ci']]]` |
| `checks` — run before every push; agents are told to run them too | `[['npm', ['test']], ['npm', ['run', 'e2e']]]` |
| `env` — `{port}` becomes the run's own port, `{runDir}` its run folder | `{ E2E_PORT: '{port}', npm_config_cache: '{runDir}/npm-cache' }` |
| `testDirs` — changing an existing test there is flagged | `['test/', 'e2e/']` |
| `protectedFiles`, `protectedDirs` — flagged when changed | `['playwright.config.js', 'package.json', …]` |
| `sandboxRead` — extra home folders agents, setup and checks may read | `['~/.cache/ms-playwright']` |
| `setupWrite` — caches setup may write; keep them in `{runDir}`, never your own (`~/.npm`) | `['{runDir}/npm-cache']` |

`AGENTS.md`, `CLAUDE.md`, `.github/` and `.claude/` are protected on every target; a target can add to that list, never remove from it.

To add a repo: write `targets/<name>.mjs`, give the repo an `AGENTS.md` for the agents, run `npm run smoke:checks -- <name>`, then `npm start -- <name>`. Missing `agent:*` labels are created on the first start.

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

Comments you write on a labelled issue or pull request are instructions for the agent's next run. The factory's own comments start with 🏭 and are never passed on.

## When it stops (`agent:needs-human`)

| The comment says | What to do |
|---|---|
| not clear enough to build without guessing | Answer the questions in a comment, remove the label. |
| needs your decision: not clearly easy to undo and small in reach | Read the write-up. To go ahead, swap `agent:explore` for `agent:implement` and remove the label. |
| the agent could not finish / produced no changes | Read what is missing; sharpen the issue or do it by hand. |
| a check failed / setup failed | The output is in the comment. Remove the label for another attempt on the same branch. |
| draft because it touches protected files | The agent changed existing tests, CI, config or a protected file. Review that part yourself. |
| changes CI workflow files, so the factory did not push it | GitHub would run that workflow the moment it is pushed. Read the diff in the comment; if it is right, push the branch from `runs/<target>/worktrees/issue-<n>` yourself. |
| the worktree's .git link / the clone's git config was changed | A session tried to change where git looks or what it runs. The factory stops entirely. Read the session log, fix or delete `runs/<target>/repo`, then start again. |
| issue text was edited after it was approved | Someone else edited their issue after you labelled it. Re-read it, remove the label. |
| timed out / max_turns / usage limit | Remove the label when you want it to continue. |

Nothing is ever retried on its own.

## Startup warnings

- `` `spec/` is in targets/<name>.mjs but not on main `` — the target file no longer matches the repo; a protection or test folder does nothing until you fix it.
- `an old single-target clone is at …/repo` — see *Moving to runs/* below.

## Confinement

- **Agents** run in Claude Code's sandbox: writes only in their worktree, no network, home folder hidden, no `git push`, no `gh`.
- **Setup and checks**, which run the branch's code before you have read it, run under `bwrap`: the system read-only, the home folder hidden (except the Node install and the target's `sandboxRead`), writes only to the worktree. Setup has network, to download dependencies; checks have none.
- **Workflow files** under `.github/workflows/` are never pushed by the factory.
- If the sandbox cannot start, the factory refuses to start.

- **Git itself:** the factory's own git commands read the clone's `.git/config`, which agents can write. Before any git command runs on a worktree (and on every poll) the config must hold only what a plain clone holds and `origin` must be the target repo; otherwise the issue parks and the factory stops. The factory pushes exactly the commit it checked.

What stays outside:
- After a push, unchanged CI workflows run the branch's code on GitHub's machines.
- With two issues running at once, git commands for one can run in the short window after the other's agent session changed the config and before the next check. Upgrade path: run the factory's own git confined as well, and push from a clone agents never touch.

## Files

- `config.mjs` — shared defaults: limits (2 at a time, confidence 70, timeouts), model, labels.
- `targets/` — one settings file per repo.
- `prompts/` — what each agent step is told.
- `runs/<target>/` — the target's clone (`repo/`), per-issue worktrees and logs, and its lock (not in git).

## Checks

```sh
npm test                           # unit and behaviour tests
npm run smoke                      # one real agent session; proves it cannot escape its worktree (uses Claude usage)
npm run smoke:checks -- <target>   # the target's setup and checks, inside the agent sandbox and confined (uses Claude usage)
```

## Moving to runs/

Before targets, the score pad's clone, worktrees and logs lived at the top of this folder (`repo/`, `worktrees/`, `logs/`). Stop the factory, finish or park any open work, then delete them:

```sh
rm -rf repo worktrees logs factory.lock
```

On its next start each target clones afresh into `runs/<target>/`. Branches already pushed (`factory/issue-<n>`) are picked up from GitHub again.
