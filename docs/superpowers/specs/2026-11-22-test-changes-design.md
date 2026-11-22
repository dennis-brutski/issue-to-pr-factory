# Agents may change existing tests, but never weaken them

## Why

The rule "do not modify, rename or delete existing tests" stops honest work: a change of signature, message or behaviour breaks a test, and the agent may not touch it unless the issue names it. The gate then asks questions (job-search#35), or agents add new test files next to the ones the tests belong in, to dodge the brake. What the rule is for is narrower: a test must never be weakened so that it passes without working code.

## Goals

- An agent may change or delete an existing test when the issue's change needs it: a new signature, a new message, a behaviour the issue changes, logic the issue removes.
- Dennis judges every change or deletion of an existing test that the issue did not ask for clearly. The pull request is a draft.
- A change the issue asked for clearly, in a `## Tests that change` section, goes through without a draft.
- New test cases added to an existing test file go through without a draft.
- A test is never weakened: no removed assertions, looser expected values, `try`/`catch` around a failure, early `return`.

## Non-goals

- Telling "a new test" from "a line inside an old one" mechanically (per language). The reviewer does that.
- Running the old version of a changed test against the new code. Possible later, if the reviewer misses things.

## Anti-goals

- A model's word lifts a draft. The reviewer may only add draft reasons, never remove one.

## Approach

Picked: **A, extend what is there.** Considered: B, a separate read-only "test judge" session (more focused, one more session and stage to maintain; A can become B later); C, mostly mechanical, recognising test blocks per language and running old tests against new code (deterministic but brittle and language-specific).

## Design

1. **Issue section.** Issues may have `## Tests that change`: one bullet per test file (a path in backticks), with what changes or why it goes. The factory reads the paths from that section.
2. **Brake** (`lib/verify.mjs`, protected, built by hand). For existing files in `testDirs`:
   - listed in the section: a note, not a draft;
   - only lines added: a note (`test cases added`), not a draft;
   - otherwise changed, deleted or renamed: a draft, as now.
   Added skips and `.only` stay draft reasons, listed or not.
3. **Agents' rule** (`targetVars` in `lib/stages.mjs`). May change or delete an existing test when the issue's change needs it; change only what that needs; never weaken one; name each changed or deleted test and why in the report.
4. **Report.** The `work` schema gets `test_changes`: `{ file, test, reason }` per changed or deleted existing test. The pull request gets a "Tests changed" section from it.
5. **Reviewer.** The review checks, when an existing test file changed: do added lines form new tests, not lines inside an old one; does each change to a listed file match what the section says; is any test weakened. Its answer gets `test_concerns`; each one is a draft reason. Nothing removes a draft reason.
6. **Text.** The issue template, AGENTS.md rule 4 and the README say the new rule; `docs/adr/0003` records it.

## Left to the builder

Names of functions and fields beyond `testsThatChange`, `test_changes` and `test_concerns`; how the section is parsed (bullets with a backticked path); the wording of notes and comments, in the repo's plain style.
