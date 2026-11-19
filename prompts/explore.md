<!-- session: explore -->
# Explore issue #{{number}}

Investigate this issue in the repository. Do not change any file.

{{rules}}

Use these skills (Skill tool): `factory:systematic-debugging`.
For a bug, use `factory:systematic-debugging` to find the root cause.
Where a skill says to ask your human partner: you cannot ask. Put the open question in `writeup` and set `easy_to_undo` and `small_reach` to false.
Where a skill lists exceptions that need your human partner's permission (configuration, generated code): use your judgement, and say in `writeup` what you decided.
Where the skill says to write a test or change code, describe it in `writeup` instead.

## What to report

- `writeup`: the cause (for a bug) or the shape of the change (for a feature), the change you propose, the files it touches, and any side effects. Markdown, under 400 words.
- `easy_to_undo`: true only if the change could be reverted with a single `git revert` and leaves no stored user data in a new format.
- `small_reach`: true only if it touches a few files in one area and cannot break unrelated screens.

## Task description

### {{title}}

{{body}}

### Comments from {{ownerName}}

{{comments}}
