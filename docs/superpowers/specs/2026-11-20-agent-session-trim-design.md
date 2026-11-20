# Trim what every agent session sends

## Why

The factory runs on a Claude Pro subscription; the aim is to stretch its usage limits. Every
`claude -p` session sends a few thousand tokens the agent never needs, and these are written to
the prompt cache fresh in each session. Cache writes are 57% of the estimated cost over the 166
logged sessions.

## Goals

- Fewer tokens written per session, with no change to what agents can do or see of the task.
- Agents no longer get Claude Code's memory instructions, which point at `~/.claude/projects/…`.

## Non-goals

- The cache lifetime (1 hour vs 5 minutes). A test on 2026-11-20 could not tell whether Pro
  counts it: the 5-hour usage moves in whole percents. Left as it is.
- The session id inside Claude Code's sandbox description, which makes about 4k tokens per
  session uncacheable. That is a Claude Code bug, not the factory's.
- The account email in the session context: Claude Code adds it from the login and offers no
  switch, and agents already get it as `GIT_AUTHOR_EMAIL`.

## Approaches

1. **Trim in `lib/agent.mjs` (picked).** Three small changes where sessions are started.
   Measured on a tiny session: 6.8k → about 5k tokens written.
2. **`--bare`.** Drops much more, but also skips plugins (the skills) and hooks, and changes how
   Claude Code signs in. Too broad.
3. **Own system prompt (`--system-prompt`).** Full control of the system prompt, but it replaces
   Claude Code's tool and sandbox guidance, which the agents rely on. Too risky for a few k tokens.

## The change (all in `lib/agent.mjs`, a protected file: a hand change)

- `buildArgs`: add `--exclude-dynamic-system-prompt-sections`. It moves the worktree path and git
  status out of the system prompt, so sessions in different worktrees share more of the cache.
- `runAgent` env: add `CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1'`.
- `ALWAYS_DISALLOWED`: add `ListAgents` and `ReportFindings`. No stage uses them.

## Tests

- New `test/agent-trim.test.mjs`: `buildArgs` contains the new flag and still ends with
  `--disallowedTools`; the disallowed list names `ListAgents` and `ReportFindings`; the session
  env sets `CLAUDE_CODE_DISABLE_AUTO_MEMORY`.
- `test/agent.test.mjs:27` pins the exact disallowed list and must be updated for the two new
  tools. It is an existing test: Dennis decides.
- `npm test` passes; `npm run smoke` (Dennis) confirms confinement still holds.
