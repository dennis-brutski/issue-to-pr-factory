# Fix review findings for issue #{{number}}

A reviewer found the problems below in this branch's change. Fix each one, test-first where behaviour changes.

{{rules}}
{{commit}}

Run `npm test` and `npm run e2e` before you finish. Both must pass.

## What to report

- `status`: `complete` only if every finding is fixed or you can say why it is wrong, everything is committed, and both test commands pass.
- `summary`: what you changed.
- `detail`: when incomplete, exactly what is missing. Otherwise empty.

## Findings

{{findings}}

## Task description

### {{title}}

{{body}}
