<!-- session: implement -->
# Implement issue #{{number}}

{{rules}}
{{commit}}
Stay on branch `{{branch}}`: do not check out other branches or commits.

Use these skills (Skill tool): `factory:test-driven-development`, `factory:verification-before-completion`.
Where a skill says to ask your human partner: you cannot ask. Stop, report `incomplete`, and put the question in `detail`.
Where a skill lists exceptions that need your human partner's permission (configuration, generated code): use your judgement, and say in `summary` what you did without a test.

{{lastStop}}## How to work

1. Read the issue and the code it concerns. Write yourself a short plan.
2. Work test-first, as `factory:test-driven-development` says.
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
