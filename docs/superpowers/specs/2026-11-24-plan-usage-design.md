# Show plan usage next to session cost

## Why
On a Pro subscription the `≈ $` figure doesn't tell Dennis how close he is to his
5-hour and weekly limits. He wants to see that in the log after each session.

## Goals
- After each agent session, the log line ends with where the account stands:
  `… · ≈ $1.20 · plan 5h 42% (resets 14:30) · week 18%`.
  The reset time is local `HH:MM` and is shown for the 5-hour window only;
  the weekly one is too far off to matter on each line.

## Non-goals
- No per-session share of the limit. The numbers are account-wide (other
  factories, chat sessions all count), so a per-session split would be a guess.
- No brake: the factory does not slow down or stop because of these numbers.
- Not in the pull request body or the stats screen (add later if wanted).

## Anti-goals
- A failed or changed usage lookup must never fail a session or a stage. It
  just leaves the plan part out.
- The login token never reaches an agent session or a log.

## Approaches considered
- A. Before/after difference per session: rejected, parallel factories and
  chat sessions blur the difference.
- B. Read from `stream-json` rate-limit messages: rejected, same account-wide
  numbers, and it needs the protected `lib/agent.mjs`.
- C1/C2. Cost × a set or learned "% per dollar": rejected for now, as it's a
  guess.
- **D. Log the account's current level: picked.** It's honest and small.

## Design
- New adapter `lib/plan.mjs`: reads the access token from
  `$CLAUDE_CONFIG_DIR/.credentials.json` (default `~/.claude`), field
  `claudeAiOauth.accessToken`. It calls `GET https://api.anthropic.com/api/oauth/usage`
  with `Authorization: Bearer …` and `anthropic-beta: oauth-2025-04-20` using
  Node's `fetch` with a short timeout, and returns `{ fiveHour, week }`
  (utilization as a whole percent, and the 5-hour `resets_at`) or `null` on any problem. This is the endpoint
  Claude Code's `/usage` reads. It isn't public and may change.
- A pure formatter (in `lib/usage.mjs`): `{ fiveHour, week }` → `plan 5h 42% (resets 14:30) · week 18%`,
  leaving out what's missing.
- `lib/stages.mjs`: after a session's usage line is built, append the plan part.
  Skipped on local runs (`cfg.localRun`) and when no token file exists.
- Tests: a unit test for the formatter and the response parsing. Behaviour tests
  must not reach the network, so the URL comes from settings, and the behaviour
  world points it at nothing / a local fake server.

## Left to the builder
- Exact setting name for the URL, and the timeout (suggest 3 s).
