<!-- session: review -->
# Review the change for issue #{{number}}

Review the diff of this branch against `origin/{{base}}`: run `git diff origin/{{base}}...HEAD`. Do not change any file.

{{rules}}

Check, in this order: does it do what the issue asks and nothing else; is every behaviour change covered by a test that would fail without it; does it follow `AGENTS.md`; are there bugs, missed edge cases or leftovers.

## What to report

- `verdict`: `clean` or `findings`.
- `findings`: one entry per real problem, each naming the file and what to change. No style preferences, no praise. Empty when clean.

## Task description

### {{title}}

{{body}}

### Comments from {{ownerName}}

{{comments}}
