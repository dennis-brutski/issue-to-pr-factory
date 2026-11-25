# 5. The factory's own git runs confined, and only its own clone talks to GitHub

Date: 2026-11-25 · Status: accepted

## Context

Agents commit into the target's clone, so they can write its `.git/config`. The factory's own git ran there unconfined, as Dennis, with his credentials, and pushed from it. A config check before every git command and on every poll narrowed the risk, but with two runs at once one run's agent could change the config between the check and the other run's next git command: a planted `diff.external`, credential helper or `receivepack` would run as Dennis (#141).

## Decision

- Every git command the factory runs in the agents' clone or its worktrees runs under `bwrap`: no network, the home folder, `/run` and `/tmp` hidden, writes only to the clone's git data, the folder it runs in and, to add or remove a worktree, the worktrees folder.
- A second clone, `runs/<target>/upstream.git` (bare), is the only one that talks to GitHub: fetch, `ls-remote` for the base, push. It runs unconfined with Dennis's credentials. No agent can write it, so its config is the one git made when it cloned. The agents' clone fetches from it by path, confined.
- To push, the factory's clone fetches the checked commit from the agents' clone. git serves it with `upload-pack`, which reads the agents' clone's config, so `upload-pack` runs confined. A commit's name is its content's hash, so what arrives is what was checked.
- The confined git is a third kind of confined process, as ADR 0001 foresaw. It has its own environment allowlist (`GIT_PASSED_ON` in `lib/workspace.mjs`: `PATH`, `HOME`, `LANG`, `LC_ALL`, `TZ`, plus the git identity), apart from the agents' and the checks'.
- `checkCloneConfig` and the `.git` link check stay: a changed config still stops the whole factory. Confinement is the second layer.

Considered and not taken: confining the network commands too (they need credentials from the home folder and the keyring under `/run`, which is what the sandbox hides), and copying commits between the clones with `git bundle` (one more temporary file per push, for the same result).

## Consequences

Every git call in the agents' clone starts a sandbox: `npm test` takes about 15 seconds longer. In the window between check and command a changed config can still change what git reports to the brakes, but it cannot run anything outside the confinement or change what is pushed; the next check stops the factory. Do not move a network git command into the agents' clone, and do not give the factory's confined git network or the home folder.
