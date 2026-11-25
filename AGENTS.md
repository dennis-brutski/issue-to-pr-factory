# Working in this repo

issue-to-pr-factory: a dependency-free Node program, started by hand, that turns
labelled GitHub issues of one target repo into checked pull requests, with
Claude Code agents confined in a sandbox.

## Commands

```sh
npm test          # unit and behaviour tests (node --test), about 20 seconds; no network or logins needed
npm run smoke     # for the human, not agents: one real Claude session checks 9 ways out of the worktree are closed (uses Claude usage)
```

Needs Linux with `bwrap` and Node (tested on 25). Tests that need real bwrap or network skip themselves where those are missing.

`npm test` must pass before any change is done.

## Where things go

| Path | What |
|---|---|
| `lib/eligibility.mjs`, `lib/brakes.mjs`, `lib/names.mjs`, `lib/startup.mjs` | Pure decisions: who may trigger, what a diff may contain, issue ↔ branch ↔ worktree names, startup warnings. No I/O. |
| `lib/github.mjs`, `lib/workspace.mjs`, `lib/agent.mjs`, `lib/confine.mjs`, `lib/checks.mjs` | Thin adapters around `gh`, `git`, `claude` and `bwrap`. |
| `lib/verify.mjs` | Judges a branch: what stops a push, what makes a pull request a draft. |
| `lib/stages.mjs`, `lib/loop.mjs`, `factory.mjs` | The stages of one run, the poll loop, the entry point. |
| `lib/settings.mjs`, `config.mjs`, `targets/` | Shared defaults and one settings file per target repo. |
| `prompts/` | What each agent session is told. `_rules.md` and `_commit.md` are shared. |
| `test/*.test.mjs` | Unit tests, one file per `lib/` area. |
| `test/fakes/workspace.mjs` | The in-memory workspace the stage and loop unit tests share; pass the methods a test cares about. |
| `test/behavior/` | The real `factory.mjs` against a fake `gh` and fake `claude` (`fakes/`), driven through `world.mjs`. |
| `smoke/` | Live checks with real Claude. |
| `docs/adr/` | Decisions already made, and why. |
| `GLOSSARY.md` | The factory's own terms, in one or two plain lines each. |

## Rules

1. **Test first.** Write a failing test, see it fail, then write the code. Decisions get a unit test; anything the factory does end to end gets a behaviour test in `test/behavior/`.
2. **No dependencies.** Node's standard library, `gh`, `git`, `bwrap`, `claude` only.
3. **A new `gh` call needs the fake to learn it.** The fake `gh` in `test/behavior/fakes/gh.mjs` refuses unknown commands; add the command there and a contract test in `test/behavior/fake-gh.test.mjs` that runs the real adapter against it. Add lines to these files; do not change or remove existing ones. A new workspace method goes into `test/fakes/workspace.mjs` as well; a test checks both have the same methods. The same goes for a new agent session: add its prompt's first line to `SESSIONS` in `fakes/claude.mjs`.
4. **Never loosen confinement.** Do not touch the protected files: `lib/agent.mjs`, `lib/brakes.mjs`, `lib/checks.mjs`, `lib/confine.mjs`, `lib/eligibility.mjs`, `lib/names.mjs`, `lib/workspace.mjs`, `lib/verify.mjs`, `prompts/_rules.md`, `config.mjs`, `package.json`, `targets/`, `smoke/`, `docs/adr/`, `AGENTS.md`, `.github/`. Change or delete an existing test only when the issue's change needs it (a new signature, message or behaviour the issue changes, logic it removes), and only as much as that needs. Never weaken a test to make it pass: no removed assertions, looser expected values, `try`/`catch` around a failure or early `return`. Add new test cases to the test file they belong in. Name every changed or deleted test and why in your report. The pull request is a draft unless the issue lists that test file under `## Tests that change`. You may change a protected file the issue lists under `## Protected files that change`; the pull request is then a draft. If the right fix needs a protected file the issue does not list, don't work around it: stop and say which file and why.
5. **Small, readable changes.** Match the style of the file you are in. No drive-by refactors.
6. **Plain wording.** Comments, log lines and GitHub comments are read by one person in a hurry: short sentences, no jargon.
7. **Read the decisions.** Before changing a module, read the records in `docs/adr/` that concern it. Do not undo a recorded decision; if your change needs to, stop and say which record and why.

## Commits

- Short imperative subject, as in the history: "Run setup and checks confined in bwrap".
- No trailers of any kind: no co-author lines, no "generated with", no session links.
