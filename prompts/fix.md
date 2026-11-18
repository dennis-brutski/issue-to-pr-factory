# Fix review findings for issue #{{number}}

A reviewer found the problems below in this branch's change. Fix each one, test-first where behaviour changes.

{{rules}}
{{commit}}

{{lastStop}}Run these checks before you finish; all must pass:
{{checks}}

## What to report

- `status`: `complete` only if every finding is fixed or you can say why it is wrong, everything is committed, and both test commands pass.
- `summary`: what you changed.
- `detail`: when incomplete, exactly what is missing. Otherwise empty.

## Findings

{{findings}}

## Task description

### {{title}}

{{body}}

### Comments from {{ownerName}}

{{comments}}
