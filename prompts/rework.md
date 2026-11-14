# Rework the pull request for issue #{{number}}

Dennis reviewed this branch's pull request and left the comments below. Change the branch to address each one, test-first where behaviour changes.

{{rules}}
{{commit}}

Run `npm test` and `npm run e2e` before you finish. Both must pass.

## What to report

- `status`: `complete` only if every comment is addressed, everything is committed, and both test commands pass.
- `summary`: what you changed, one line per comment.
- `detail`: when incomplete, exactly what is missing. Otherwise empty.

## Comments from Dennis

{{comments}}

## Pull request

### {{title}}

{{body}}
