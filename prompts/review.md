<!-- session: review -->
# Review the change for issue #{{number}}

Review the diff of this branch against the base commit `{{baseSha}}`: run `git diff {{baseSha}}...HEAD`. Use that commit, not a remote-tracking ref such as the one for `{{base}}`, which may have moved. Do not change any file.

{{rules}}

Check, in this order: does it do what the issue asks and nothing else; is every behaviour change covered by a test that would fail without it; does it follow `AGENTS.md`; are there bugs, missed edge cases or leftovers.

When the change touches an existing file in the test folders, also check:

- Do the added lines form new tests, not lines inside an existing one?
- Does each change to an existing test match what the task's `## Tests that change` section says, if it has one?
- Is any existing test weakened: removed assertions, looser expected values, a `try`/`catch` around a failure, an early `return`, or a deleted test whose logic still exists?

## Try to break it

After those checks, try to break the change:

- Name concrete inputs or states for which the change does the wrong thing: empty, missing, repeated, very large, already done, run twice.
- Look for changes the issue did not ask for.
- For each new test, say whether it would fail without the change. A test that passes either way is a finding.
- Look for new code that repeats logic already in the repo (a helper, a regex, a loop over the same data). Name the existing function to reuse.

Each finding names the file and what to change. No style comments.

## What to report

- `verdict`: `clean` or `findings`.
- `findings`: one entry per real problem, each naming the file and what to change. No style preferences, no praise. Empty when clean.
- `test_concerns`: one entry per problem found in the test checks above, each naming the file and the test. Empty when none. These go to {{ownerName}}, not to a fix.

## Task description

### {{title}}

{{body}}

### Comments from {{ownerName}}

{{comments}}
