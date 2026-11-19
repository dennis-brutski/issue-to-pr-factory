<!-- session: rework -->
# Rework the pull request for issue #{{number}}

{{ownerName}} reviewed this branch's pull request and left the comments below. Change the branch to address each one, test-first where behaviour changes.

{{rules}}
{{commit}}
Stay on branch `{{branch}}`: do not check out other branches or commits.

Use these skills (Skill tool): `factory:receiving-code-review`, `factory:systematic-debugging`, `factory:verification-before-completion`.
Where a skill says to ask your human partner: you cannot ask. Stop, report `incomplete`, and put the question in `detail`.
Where a skill lists exceptions that need your human partner's permission (configuration, generated code): use your judgement, and say in `summary` what you did without a test.

{{lastStop}}Run these checks before you finish; all must pass:
{{checks}}

## What to report

- `status`: `complete` only if every comment is addressed, everything is committed, and both test commands pass.
- `summary`: what you changed, one line per comment.
- `detail`: when incomplete, exactly what is missing. Otherwise empty.

## Comments from {{ownerName}}

{{comments}}

## Pull request

### {{title}}

{{body}}
