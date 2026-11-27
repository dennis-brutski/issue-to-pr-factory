# Release prep (v0.2.0)

## Why

The repo is public. It is for people who try the factory on their own repo, and it is the project in Dennis's application for an AI engineering role. A reviewer spends a few minutes on it: the README (which already leads with confinement and the trust model, and stays as it is), the file tree, one or two source files. A new user must get from the README to a first run without help.

## Goals

- Nothing a new user hits first points nowhere or leaves them stuck.
- Nothing a reviewer sees first looks unfinished: no duplicate ADR numbers, no tool jargon in comments, no leftover upgrade code.
- A few fresh factory pull requests on real refactors, which the README can link later.

## Non-goals

- README restructure.
- The workspace guard (audit finding 7): after the release.
- Strict type checking, JSDoc on every function (#191 covers the shared types).

## Approach

Picked: **C, split by kind.** Small fixes and those in protected or meta files by hand in one pull request; three refactors in unprotected code through the factory.

Considered: A, the factory builds everything (slowest, and half the fixes touch protected files, so they would stop for hand fixes anyway); B, everything by hand (fastest, adds nothing to the "builds itself" story).

## Part 1: one pull request by hand

| # | Change | Files |
|---|---|---|
| 1 | The bwrap startup error names the probe command and points to "Getting started" in the README, not "Task 0 of the plan". | `lib/loop.mjs` |
| 2 | The built-in protected list lives once, in `brakes.mjs`; `stages.mjs` imports it for the prompt. | `lib/brakes.mjs`, `lib/stages.mjs` |
| 3 | "already running (pid n)" adds: if that is not the factory, delete the lock file (its path). | `lib/loop.mjs` |
| 4 | Remove the check for a factory from before targets, its `.gitignore` entries (`repo/`, `worktrees/`, `logs/`, `factory.lock`) and the empty `worktrees/` folder. | `factory.mjs`, `.gitignore` |
| 5 | `0006-owner-may-approve-setup-for-one-commit.md` becomes `0007-…`; every reference updated. | `docs/adr/`, references |
| 10 | `package.json`: `"private": true`, `"engines": { "node": ">=26" }`. CI runs Node 26 (LTS; 25 is out of support since June 2026); AGENTS.md says "tested on 26". | `package.json`, `.github/workflows/ci.yml`, `AGENTS.md` |
| 11 | `ponytail:` comments become `shortcut:`. | `lib/stages.mjs`, `lib/workspace.mjs` |
| 12 | A run that does not start adds `agent:needs-human` before it comments, so a failed label never repeats the comment each poll. | `lib/loop.mjs` |

Each behaviour change (1, 3, 12) gets a test first. `npm test`, `npm run lint`, `npm run typecheck` pass.

Decided with Dennis: Node `>=26`, the version CI tests; Dennis moves his local Node to 26 before the tag. Call made by Claude: the lock message names the file rather than offering a flag to force a start.

## Part 2: three factory issues

- **Stats reads pull requests once** (finding 6): one `listAllPullRequests` with every field `stats.mjs` needs; the Titles, Bodies and Merged variants and their jq constants go. The fake `gh` and its contract test follow (AGENTS.md rule 3).
- **One copy of the small helpers** (finding 9): `same`, `fence`, `list` in one module, imported where used. Protected files that define them (`lib/eligibility.mjs`, `lib/verify.mjs`) are listed, so that pull request is a draft.
- **Split `stages.mjs` by job** (finding 8): prompt building (`renderPrompt`, `targetVars`, `schemas`) to `lib/prompts.mjs`; the auto-merge decision becomes a pure function returning why it refuses, or null, with unit tests. No behaviour change; existing tests stay as they are apart from imports.

Order: Part 1 first (finding 2 touches `stages.mjs`), then the helpers issue, then the split, so the two do not conflict. Stats can go at any time.

## Then

Tag v0.2.0 as `docs/releasing.md` says, with notes that name anything users must change (none expected: `.gitignore` and `engines` only).
