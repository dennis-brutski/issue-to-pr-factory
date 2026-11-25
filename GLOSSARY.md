# Glossary

**pull request body**: what the factory writes on its pull request (`lib/pr-body.mjs`): any draft warning, `Closes #n`, the issue's `## Tests that change` list, the agent's summary, the tests changed, the checks and how it was built.
It reads back only the issue number and that list, from its own part between `Closes #n` and `## What changed`.

**last stop / last push**: the last stop is the newest factory comment saying why a run stopped; the next code-changing session is told it. It counts only if it is not older than the last push: the time of the factory's newest comment that is not a stop (the pull request, rework or merge comment). GitHub sets that time; a commit date can be set to anything, so it is never used.

**pinned base**: the base branch's commit, asked from GitHub once at the start of one verify and used for every judgement in it, so a base that moves meanwhile cannot mix two answers.
