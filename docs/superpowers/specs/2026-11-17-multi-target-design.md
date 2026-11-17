# Any repo as a factory target — design

Status: draft for Dennis's approval · 2026-11-17

## Why

The factory turns labelled GitHub issues into checked pull requests, but today
it can only serve `dennis-brutski/gin-rummy-score-pad`: the repo, base branch,
check commands, protected files and sandbox extras are written into the code.

Dennis wants it to serve **any project**, whatever its language or build tool.
The first new target is the factory's own repo
(`dennis-brutski/issue-to-pr-factory`, private, branch `main`): the findings of
the factory's final review will be filed there as issues and built by the
factory itself. An Android app (likely Gradle) may follow.

**Success:** pointing the factory at a new repo means writing one small
settings file, not changing the factory's code.

## Phases

1. **Behaviour tests** for the factory as it is today (see *Phase 1*). They
   are the safety net for phase 2: the score pad's scenarios must pass before,
   during and after it.
2. **Any repo as a target** — everything below *Phase 1*. Each new behaviour in
   phase 2 gets its own scenario.

## Goals

- One settings file per target repo, inside the factory repo.
- Everything project-specific comes from that file: repo, base branch, setup
  commands, check commands, environment, test folders, protected files, extra
  sandbox reads.
- One running factory per target: `npm start -- <target>`. Each target has its
  own run folder, lock and Ctrl-C, so two targets can run side by side.
- Agents' prompts name the target's own commands and protected files.
- At startup the factory warns about settings that no longer match the repo.
- Behaviour tests run the whole factory as a program — poll, label, run, push,
  park, Ctrl-C, restart — fast, repeatable, offline, without credits.
- The score pad keeps working exactly as today, through its settings file.
- The factory repo becomes a working target: settings file, `AGENTS.md`,
  labels.
- No agent-written code runs unconfined: the factory's own setup and check
  runs move into `bwrap` too (see *Confined setup and checks*).

## Non-goals

- One process watching several repos.
- Android or Gradle specifics (dependencies without network, Gradle caches).
  The settings shape must allow them; working them out waits for that repo.
- Settings stored in the target repos (option B below).
- Any change to the stages, the trust rule or the brakes' logic. The agents'
  sandbox stays as it is; the only security change is confining the factory's
  own setup and check runs.

## Anti-goals (a failure even if it works)

- A target repo, or an agent working in one, can change what the factory runs
  on Dennis's machine or what the sandbox lets the agent read.
- An agent working on the factory repo can loosen its own confinement — the
  sandbox settings, the brakes, the rules prompt — without that change being
  flagged as protected.
- The score pad silently loses a check or a protection it has today.
- An agent-written CI workflow runs on GitHub before Dennis has read it.
- Code from a branch nobody has reviewed yet — tests, build scripts, install
  scripts — runs with access to Dennis's home folder, `gh` login or SSH keys.

## Constraints (unchanged from the factory spec)

- No dependencies. Node 22+, `gh`, git, Claude Code CLI.
- Only Dennis triggers work; the factory, never an agent, does every GitHub
  write; it never merges and never pushes to the base branch.
- Agents run in the bubblewrap sandbox with no network.
- Nothing is installed as a service.

## Approaches

| | Where the settings live | Trade-off |
|---|---|---|
| **A — chosen** | `targets/<name>.mjs` in the factory repo | Everything that decides what runs on Dennis's machine stays in one private repo no agent works in. Cost: project knowledge lives away from the project; a build change in a target needs a second change here, and a forgotten one is silent (mitigated by the startup warning). |
| B | `.factory.json` in each target repo | Settings travel with the project, but the commands run as Dennis and the sandbox's read list come from every target repo, and an agent's PR can propose loosening them. |
| — dropped | split between both | Two places to look; both sets of cons. |
| — dropped | command-line flags / env vars | Too much to type, nothing on record. |

An outside check (Dennis's NotebookLM "Software Factory" notebook, 15
sources) backed A — keeping settings out of the agents' workspaces separates
the trusted control plane from the untrusted workspace, and its sources list
harness and test tampering as common agent behaviour — and flagged two
existing gaps as a no-go and a high risk: running agent-written tests outside
the sandbox, and running setup with network outside it. Both are fixed here
(*Confined setup and checks*). It also suggested blocking, not just flagging,
changes to the confinement files; Dennis keeps **flag, don't block**, because
on the factory target the review findings will often be exactly those files.

Dennis chose **A with the startup warning**, and **one factory per repo** over
one process for all repos (less code; he starts the factory for a job and stops
it; cost: two running factories can mean four agent sessions on one Pro plan).

## Phase 1: behaviour tests

Today there are unit tests (stages and loop with fakes; workspace against real
git), containment smoke tests (real Claude) and manual drills (real GitHub,
real Claude). Nothing runs the factory as one program; the drills found most
of their bugs exactly there.

### Shape

A behaviour test starts the **real `factory.mjs`** as a child process, with:

- **`origin`**: a local bare git repo in a temp folder, seeded with a small
  project (a `package.json` with a `test` script, one source file, one test).
- **Fake `gh`**: a small Node program first on `PATH`. It keeps issues, pull
  requests, labels, label events and comments in a JSON file in the temp
  folder and answers exactly the commands the factory uses (the GraphQL
  candidate query, the REST label/comment/body calls, `pr list`, `pr create`,
  `pr ready`, `api user`). Pushes go to the bare repo for real, so a "pull
  request" is a record pointing at a real branch. **Any command it does not
  know exits non-zero with a loud message**, so a new `gh` call in the factory
  fails the tests until the fake learns it.
- **Fake `claude`**: a small Node program first on `PATH`. It follows a
  scenario script handed over in an environment variable: per session, what to
  do in the worktree (write files, commit with a message, leave files
  uncommitted, leave sandbox placeholders, hang until killed) and which status
  report to return. It answers `--version` for preflight. It records every
  call (arguments, prompt, working folder) for assertions.

Everything else is real: the loop, the lock, worktrees, git, `npm` setup and
checks, brakes, comment texts, logging, signals.

The test drives it by changing the fake GitHub's state (open an issue, add a
label, add a comment, merge a pull request), then waits — with a timeout —
until the expected state appears, and asserts on: the fake GitHub's state,
the bare repo's branches and commits, the fake Claude's call log, and the
factory's terminal output.

### What the factory needs for it

Small, test-only seams, kept in phase 2's shape:

- the clone URL can point at a local path (a setting, default
  `https://github.com/<repo>.git`);
- the poll interval can be short (it is already a setting);
- the run folder (clone, worktrees, logs, lock) can live in the test's temp
  folder;
- the settings can be chosen when starting the process.

How the test hands these over (a settings file path, environment variables)
is the builder's call; in phase 2 it becomes a test target file.

### Scenarios for phase 1 (today's behaviour)

1. A clear, labelled issue becomes a pull request with `Closes #n`; the issue
   ends `agent:done`, the branch holds the agent's commit, setup ran before
   the first agent session.
2. A vague issue parks once with the questions; the next poll and a restart
   leave it alone.
3. An issue labelled by someone other than the owner is never touched.
4. A change to a protected file or an existing test opens a draft with the
   warning.
5. Failing checks park with the failing command's output and push nothing.
6. A review comment plus `agent:review` adds a commit, posts the rework
   answer, removes the label; a rework with no commits answers without
   pushing; the factory's own 🏭 comments never reach the agent.
7. Ctrl-C twice during a session: no fake `claude` left running, the issue
   keeps `agent:in-progress`; a restart re-queues it and resumes in the same
   worktree, sandbox placeholders removed.
8. A merged pull request's worktree is removed on the next poll.
9. A second start while one runs is refused.

### Where they live

`test/behavior/*.test.mjs`, the fakes in `test/behavior/fakes/`. They run in
`npm test` if the whole set stays under about 30 seconds; otherwise in their
own `npm run test:behavior`, and both must pass before a change is done.

### Limits

The fake `gh` can drift from the real one: these tests would not have caught
the `gh pr edit` failure. Real-GitHub checks (a throwaway playground repo, on
demand) and the real-Claude drills stay outside this phase.

## Design (phase 2)

### Settings files

```
config.mjs                       shared defaults (owner, poll, model, labels, timeouts, …)
targets/gin-rummy-score-pad.mjs  one file per target
targets/issue-to-pr-factory.mjs
```

A target file exports its overrides; the factory merges them over
`config.mjs`. A target **must** set `repo` and `baseBranch`; everything else
has a default.

New per-target fields (names are the builder's call):

| Field | Meaning | Score pad | Factory repo |
|---|---|---|---|
| `repo` | `owner/name` | `dennis-brutski/gin-rummy-score-pad` | `dennis-brutski/issue-to-pr-factory` |
| `baseBranch` | | `master` | `main` |
| `setup` | commands run in the worktree before the first agent session, outside the sandbox (with network) | `npm ci` | none |
| `checks` | commands the factory runs before pushing, and agents are told to run | `npm test`, `npm run e2e` | `npm test` |
| `env` | extra environment for setup, checks and agent sessions; `{port}` is replaced by the run's port | `E2E_PORT={port}` | none |
| `testDirs` | where existing tests live (changing them is flagged) | `test/`, `e2e/` | `test/` |
| `protectedFiles` / `protectedDirs` | flagged when changed | today's list | see below |
| `sandboxRead` | extra folders agents, setup and checks may read | `~/.cache/ms-playwright` | none |
| `setupWrite` | caches setup may write | `~/.npm` | none |

Commands are argument lists (`['npm', ['ci']]`), run without a shell, as
today. The checks' order is kept; the first failure stops the run.

`CI=1` stays a factory default for every target, as today.

*Builder's note (Claude's call):* `env` also reaches agent sessions. Today only
the factory's check run gets `E2E_PORT`, so two agents running the e2e suite
at once share the default port; passing it to sessions closes that.

**Always protected, for every target** (built into the factory, not a
setting): `AGENTS.md`, `CLAUDE.md`, `.github/`, `.claude/`. A target adds to
this list; it cannot remove from it.

**Factory repo's protected files** — everything that confines or checks the
agents: `lib/agent.mjs` (sandbox settings), `lib/brakes.mjs`,
`lib/checks.mjs`, `lib/eligibility.mjs` (trust rule), `prompts/_rules.md`,
`config.mjs`, `targets/`, `package.json`, `smoke/`. A change there still
produces a pull request; it is opened as a draft with the warning, as today.

### Run folders

Each target gets `runs/<target>/` holding `repo/` (the clone), `worktrees/`,
`logs/` and `factory.lock`. `runs/` is git-ignored. The issue/branch naming
(`factory/issue-<n>`) is unchanged; it is per repo, so two targets cannot
collide.

### Starting and stopping

- `npm start -- <target>` loads `targets/<target>.mjs`.
- `npm start` with no target runs the only target when exactly one target file
  exists. With no target and several (or none), or with an unknown one, it
  prints the available targets and exits non-zero.
- The lock is per target: a second `npm start` for the same target is refused;
  a different target starts.
- The start line names the target: `factory started for <repo> (<target>) …`.
- Ctrl-C behaves as today, per process.

### Startup checks

The existing preflight (sandbox probe, `claude` CLI, `gh` login) stays. Added:

- **Settings sanity (stops):** `repo` or `baseBranch` missing; base branch not
  on the remote.
- **Drift warning (warns, keeps running):** after the clone is fetched, each
  configured `testDirs`, `protectedFiles` and `protectedDirs` entry that does
  not exist on the base branch is printed as a warning naming the target file
  to update. Built-in protected entries are exempt (a repo without
  `.claude/` is normal).
- **Labels:** the seven `agent:*` labels are created on the repo if missing
  (a GitHub write by the program, allowed). A new target needs no manual
  label step.

### Prompts

The shared rules (`prompts/_rules.md`) and every prompt that names commands
(`merge.md` today names `npm test` and `npm run e2e`) are rendered from the
target: the list of protected files and folders, and the check commands the
agent must run before finishing. No prompt names `npm`, `e2e` or
`playwright` any more. "Do not add dependencies" stays a shared rule (the
sandbox has no network anyway).

### Confined setup and checks

Today the factory runs `npm ci`, `npm test` and `npm run e2e` directly, as
Dennis: the one moment with no confinement at all. Both now run under
`bwrap` (already required; preflight probes it):

| | Setup | Checks |
|---|---|---|
| Network | allowed (dependencies download) | none (`--unshare-net`) |
| Whole system | read-only | read-only |
| Home folder | hidden (empty tmpfs) | hidden (empty tmpfs) |
| Readable in home | runtime folders (default `~/.nvm`) + target `sandboxRead` | same |
| Writable | the worktree, the target's `setupWrite` caches (score pad: `~/.npm`), private `/tmp` | the worktree, private `/tmp` |
| Clone's `.git` | read-only (the worktree's git data lives there) | read-only |

So an install script or a test can no longer read `~/.ssh`, the `gh` token
or other home files, and checks can no longer reach the network. Chromium
runs inside with `PW_CHROMIUM_NO_SANDBOX=1` (score-pad `env`), as it already
does in the agents' sandbox.

New per-target field: `setupWrite` (caches setup may write; default none).
The shared default `runtimeRead` (`~/.nvm`) covers the Node install; a Gradle
target would add its JDK and Gradle folders.

*Builder's notes (Claude's calls):* call `bwrap` directly from
`lib/checks.mjs` rather than through Claude Code; the README's "known ceiling"
paragraph is removed and replaced by a short description of this confinement.
What the pushed branch does on GitHub is covered by *Workflow files are
never pushed by the factory*.

### Workflow files are never pushed by the factory

GitHub runs a pull request's CI workflow as it exists on the pushed branch, on
GitHub's machines, unconfined and with the repo's token (which a same-repo
branch's workflow can ask to widen) and secrets. "Flag, don't block" would
come too late: the edited workflow runs the moment the branch is pushed.

So, for every target and every stage that pushes: if the branch changes
anything under `.github/workflows/` (added, changed, deleted or renamed from
or to it) compared with the base branch, the factory **parks without
pushing**. The park comment lists the workflow files and their diff (fenced,
truncated like other outputs); the commits stay on the factory's local branch
so Dennis can read them and push himself. Built in, not a setting — a target
cannot switch it off. All other protected files keep "flag, don't block".

The pushed branch's ordinary CI (unchanged workflows running agent-written
tests on GitHub's throwaway machines) stays outside this design: it cannot
reach Dennis's machine, and the score pad's CI token is read-only.

### Sandbox

`agentSettings` takes the target's `sandboxRead` and adds it to `allowRead`.
Everything else is unchanged: writes only in the worktree, no network, no
`git push`, no `gh`.

### The factory as its own target

- The repo is private. Clone, fetch and push go over https with `gh` as git's
  credential helper (already set up on Dennis's machine, token has `repo`
  scope), so nothing changes.
- Review findings will often touch the protected files above. Their pull
  requests are then drafts with the warning — expected, not a failure: on this
  target Dennis reviews every change to the agents' confinement.
- The running factory (Dennis's checkout) and the agent's clone
  (`runs/issue-to-pr-factory/repo`) are separate. A merged change takes effect
  only when Dennis pulls and restarts.
- The factory repo gets an `AGENTS.md`: how to test (`npm test`), where things
  go, test first, no dependencies, small changes, commit style without
  trailers, and that the protected files above are off limits.
- The factory's check run (`npm test`) is confined like every target's (see
  *Confined setup and checks*), so agent-written tests here cannot reach the
  running factory's folder for writing, the network or Dennis's secrets.

### Smoke tests

- `smoke/containment.mjs` stays target-independent (it builds a throwaway
  repo).
- `smoke/e2e.mjs` becomes "run this target's checks inside the sandbox":
  `npm run smoke:checks -- <target>`. For the score pad it proves what it
  proves today; for the factory it proves `npm test` works inside the sandbox
  (the factory's tests start git and child processes).

### Moving the score pad's existing state

One-time, by hand, written in the README: move `repo/`, `worktrees/`, `logs/`
into `runs/gin-rummy-score-pad/` and run `git -C repo worktree repair` there
— or delete them and let the factory clone afresh. Today only the parked #1
worktree exists. The factory does not migrate automatically.

### README

Rewritten around targets: how to add one, how to start one, the startup
warnings, the known ceiling. Score-pad specifics (`master`, e2e) move into
examples.

## Testing

Test first, as the factory does today. Phase 1's behaviour tests run
throughout phase 2; phase 2 adds scenarios for its own behaviour: a workflow
change parks with no push; two targets run side by side with separate locks
and run folders; a non-npm target (setup none, checks a shell-free command
list) goes from issue to pull request; the startup drift warning appears; an
unknown target is refused; `npm start` without a target runs the single
target and is refused when there are several; setup and checks run confined (the containment
smoke below covers the real `bwrap`).

- Unit: settings merge and validation; unknown target; `{port}` replacement;
  drift warning (missing vs present, built-ins exempt); brakes with per-target
  lists and built-ins that cannot be removed; prompt rendering with no npm
  words left for a non-npm target; `agentSettings` with extra reads; per-target
  run folder paths and locks; the `bwrap` argument list for setup and checks
  (network on/off, home hidden, exactly the configured folders bound).
- Brakes: a branch that adds, changes, deletes or renames a file under
  `.github/workflows/` parks with no push, in implement, fix, rework and merge;
  a change elsewhere in `.github/` still pushes as a draft.
- Containment smoke for setup and checks, from outside: a check command that
  tries to read a canary in the home folder, write outside the worktree and
  reach the network fails all three; a setup command reaches the network but
  not the canary.
- Existing tests keep passing; the score pad's behaviour is checked through its
  settings file.
- Live: `npm run smoke` (8/8), `smoke:checks` for both targets, then one small
  real issue on the factory repo end to end.

## Left to the builder

- Field names, and whether defaults and target files are `.mjs` or JSON
  (`.mjs` matches today's `config.mjs`).
- How `{port}` slots are assigned (today `4200 + slot`); per target is fine,
  since two factories rarely run checks at the same second — a clash fails a
  check and parks, it does not corrupt anything.
- Exact wording of warnings and README.
