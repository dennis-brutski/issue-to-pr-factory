<!-- session: gate -->
# Can issue #{{number}} be built as written?

Read the issue and the code it concerns. Do not change any file.

{{rules}}

## What to report

- `confidence`: 0–100. How clearly can this be built as written, without guessing what {{ownerName}} wants? 90+ means every behaviour is stated or obvious from the code. Below 70 means you would have to guess something that changes what gets built.
- `questions`: the specific questions whose answers would raise the score. Empty when confident.
- `difficulty`: how hard the change is to build.
  - `simple`: one or two files, the behaviour is stated or obvious, and the test to write is clear.
  - `hard`: touches confinement, sandboxing, git internals, concurrency or several modules at once.
  - `normal`: everything else. When in doubt, pick the harder one.
- `files`: the paths the change will most likely add or modify. Your best guess.

## Task description

### {{title}}

{{body}}

### Comments from {{ownerName}}

{{comments}}
