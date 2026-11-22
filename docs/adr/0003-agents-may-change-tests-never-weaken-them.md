# 3. Agents may change existing tests the change needs, but never weaken them

Date: 2026-11-22 · Status: accepted

## Context

Agents were told never to modify, rename or delete an existing test unless the issue named it, and any change to an existing test file made the pull request a draft. That stopped honest work: a new signature, message or behaviour breaks a test the issue did not name, so the gate asked questions (job-search#35) or the agent stopped. Agents also added new test files next to the ones the tests belonged in, because adding a case to an existing file counted as a change. What the rule protects against is narrower: a test weakened so it passes without working code.

## Decision

- An agent may change or delete an existing test when the issue's change needs it, and only as much as that needs. It never weakens a test.
- Dennis judges every change or deletion of an existing test the issue did not ask for: the pull request is a draft.
- The issue asks for one by listing the test file under `## Tests that change`. A listed change is a note in the pull request, not a draft.
- Lines only added to an existing test file are new test cases: a note, not a draft.
- Added skips and `.only` stay draft reasons, listed or not. Protected files stay draft reasons.
- The review may add draft reasons about test changes (lines slipped into an old test, a weakened test, a change the section does not cover). Nothing a model says lifts a draft.

Considered and not taken: a separate read-only session that only judges test changes (more focused, one more session and stage to keep), and recognising test blocks per language and running old tests against new code (deterministic, but brittle and language-specific).

## Consequences

Issues that change behaviour list the tests that change, or accept a draft. "Lines only added" is checked mechanically but can hide a line slipped into an old test, such as an early `return`; the review is what catches that, so do not drop its test check. Do not let a model's verdict remove a draft reason.
