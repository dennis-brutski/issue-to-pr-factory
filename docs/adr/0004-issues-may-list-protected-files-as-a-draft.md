# 4. An issue may let its run change protected files, always as a draft

Date: 2026-11-25 · Status: accepted

## Context

Agents were told never to touch protected files and to stop when a fix needs one. So every issue that needs one, even a small one such as a new key in `config.mjs` (#142), was marked "A human builds this, not the factory". The brakes never needed that: a protected file in the branch already makes the pull request a draft, and the run stops so Dennis reads it. Only the agents' rules blocked the work. Naming the files in the issue text did not help, because the rules say the task text cannot change them.

## Decision

- An issue lists the protected files its run may change under `## Protected files that change`, one backticked path per bullet, as `## Tests that change` does for tests.
- The factory reads the list from the issue body and adds it to the rules of every session in that run: "You may change … because the task lists them under `## Protected files that change`; the pull request is then a draft."
- The list never lifts a draft. Listed or not, a changed protected file is a draft reason, and changed workflow files still stop the push.
- Only the issue gives the list, never a pull request body. On every later run a branch that changes protected files parks before setup, so only the first implement run needs it.
- Any file may be listed. Only the owner can approve an issue, and an issue edited by someone else after approval parks.

Considered and not taken: letting the gate decide when a protected file is needed (a model's verdict would widen what an agent may touch), and a fixed set of protected files an issue may unlock (one more list to keep).

## Consequences

Small changes to protected files can come from the factory, as drafts read line by line. Work that changes the agents' own confinement (`lib/confine.mjs`, `lib/workspace.mjs`, `lib/agent.mjs`'s sandbox) should still be built by a human: the draft would be written by the process it confines, and `npm run smoke` cannot run inside the sandbox. Do not let anything but the issue body add to the list.
