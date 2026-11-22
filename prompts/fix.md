<!-- session: fix -->
# Fix review findings for issue #{{number}}

A reviewer found the problems below in this branch's change. Fix each one, test-first where behaviour changes.

{{rules}}
{{commit}}
Stay on branch `{{branch}}`: do not check out other branches or commits.

Use these skills (Skill tool): `factory:receiving-code-review`, `factory:systematic-debugging`, `factory:verification-before-completion`.
Where a skill says to ask your human partner: you cannot ask. Stop, report `incomplete`, and put the question in `detail`.
Where a skill lists exceptions that need your human partner's permission (configuration, generated code): use your judgement, and say in `summary` what you did without a test.

{{lastStop}}Run these checks before you finish; all must pass:
{{checks}}

## What to report

- `status`: `complete` only if every finding is fixed or you can say why it is wrong, everything is committed, and both test commands pass.
- `summary`: what you changed.
- `detail`: when incomplete, exactly what is missing. Otherwise empty.
- `test_changes`: one entry per existing test you changed or deleted: `file` (its path), `test` (the test's name) and `reason` (one line: why the change needed it). Empty when you changed none.

## Findings

{{findings}}

## Task description

### {{title}}

{{body}}

### Comments from {{ownerName}}

{{comments}}
