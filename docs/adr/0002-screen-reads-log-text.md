# 2. The terminal screen reads log text, not events

Date: 2026-11-22 · Status: accepted

## Context

`lib/loop.mjs`, `lib/stages.mjs` and `factory.mjs` log plain text lines. `lib/screen.mjs` and `lib/look.mjs` read them back with regexes: the icon, the session columns, and the run's cost, which `screen.mjs` reads back out of the `≈ $…` part of a session line. An architecture review suggested logging events (issue, what happened, usage numbers) instead, so that only `screen` writes text.

## Decision

Keep the log text as the interface between the code that logs and the screen. About 90 calls in the `test/screen*.test.mjs` files pass log text straight into `show()`, and existing tests are not changed. So `screen` would have to keep its text parser next to any events: a second way in, with nothing removed. The piped output, which behaviour tests and `grep` rely on, is that same text.

## Consequences

A new log line, or a changed one, needs a matching rule in `look.mjs` and, if it is shown differently, in `screen.mjs`. Do not propose structured log events again unless the screen tests are rewritten for another reason, or the text parsing causes a bug.
