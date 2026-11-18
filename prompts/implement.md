<!-- session: implement -->
# Implement issue #{{number}}

{{rules}}
{{commit}}

{{lastStop}}## How to work

1. Read the issue and the code it concerns. Write yourself a short plan.
2. Work test-first: for each behaviour change, write a failing test, run it and see it fail, then write the code that makes it pass.
3. Run these checks before you finish; all must pass:
{{checks}}

## What to report

- `status`: `complete` only if the issue is fully implemented, committed, and both test commands pass. Otherwise `incomplete`.
- `summary`: what you changed, for the pull request description. Markdown, under 200 words.
- `detail`: when incomplete, exactly what is missing and why. Otherwise empty.

## Task description

### {{title}}

{{body}}

### Comments from {{ownerName}}

{{comments}}
