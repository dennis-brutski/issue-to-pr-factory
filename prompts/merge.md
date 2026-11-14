# Resolve the merge for issue #{{number}}

`origin/{{base}}` is being merged into this branch and there are conflicts. Run `git status` to see them. Resolve each conflict so that both the branch's change and the incoming changes keep working, then complete the merge with `git commit --no-edit`.

{{rules}}
{{commit}}

Run `npm test` and `npm run e2e` before you finish. Both must pass.

## What to report

- `status`: `complete` only if the merge is committed and both test commands pass.
- `summary`: how you resolved each conflict.
- `detail`: when incomplete, exactly what is missing. Otherwise empty.
