<!-- session: merge -->
# Resolve the merge for issue #{{number}}

`origin/{{base}}` is being merged into this branch and there are conflicts. Run `git status` to see them. Resolve each conflict so that both the branch's change and the incoming changes keep working, then complete the merge with `git commit --no-edit`.

{{rules}}
{{commit}}
Stay on branch `{{branch}}`: do not check out other branches or commits.

Use these skills (Skill tool): `factory:verification-before-completion`.
Where a skill says to ask your human partner: you cannot ask. Stop, report `incomplete`, and put the question in `detail`.
Where a skill lists exceptions that need your human partner's permission (configuration, generated code): use your judgement, and say in `summary` what you did without a test.

{{lastStop}}Run these checks before you finish; all must pass:
{{checks}}

## What to report

- `status`: `complete` only if the merge is committed and both test commands pass.
- `summary`: how you resolved each conflict.
- `detail`: when incomplete, exactly what is missing. Otherwise empty.
