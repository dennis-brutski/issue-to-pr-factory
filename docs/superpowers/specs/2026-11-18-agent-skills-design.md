# Skills for factory agents

Date: 2026-11-18 · Size: small change

## Why

Agents today get only the short how-to in each prompt. Proven skills (superpowers)
give them a stricter way to implement, debug and verify, so fewer runs park.

## Goals

- Code sessions (`implement`, `fix`, `rework`) can use selected skills.
- One copy for all targets, read-only to agents.
- A skill update arrives as a diff Dennis reads, never silently.

## Non-goals / anti-goals

- No skill that needs AskUserQuestion, Agent, git push or gh (they are blocked).
- No skills inside target repos: an agent must not be able to edit its own instructions.
- No automatic upstream updates.

## Approaches

- **A. Factory repo, loaded with `--plugin-dir` (picked).** One copy, outside the
  worktree, so agents cannot change it. Costs one change to the protected `lib/agent.mjs`.
- B. Each target's `.claude/skills`. Works with no code change, but one copy per
  target, and it sits in the worktree the agent edits.

## Design

- `skills/` in the factory repo as a plugin: `.claude-plugin/plugin.json` plus
  `skills/<name>/SKILL.md`. Contents copied from superpowers:
  - test-driven-development
  - verification-before-completion
  - systematic-debugging
  - receiving-code-review
- `lib/agent.mjs` (Dennis makes or approves this change): pass `--plugin-dir <factory>/skills`,
  add `Read(/<factory>/skills/**)` to `permissions.allow` (skills point to extra files
  such as `writing-good-tests.md`), and add the folder to the sandbox's `allowRead`.
  Smoke-checked 2026-11-18 with the real `buildArgs`/`agentSettings` (Haiku):
  - The Skill tool loads a `--plugin-dir` skill under `--setting-sources project` and
    `dontAsk`, with no extra allow rule.
  - Reading a file next to `SKILL.md` is denied until the `Read(...)` rule is added.
  - A write session trying Bash and Edit on the skill file was denied; the file was unchanged.
  - Not tested: the `Read(...)` rule alone, without sandbox `allowRead`. Both are kept.
- Prompts name the skill to use:
  - `implement.md`: test-driven-development, verification-before-completion
  - `fix.md`, `rework.md`: systematic-debugging, receiving-code-review (rework), verification-before-completion
  - `review.md`: unchanged
- `npm run sync-skills`: copies the four skills from the local plugin cache into
  `skills/`. Dennis reads `git diff` and commits. (`package.json` is protected, so
  Dennis adds the script line.)
- `skills/` goes into the factory target's `protectedDirs`.

## Calls made (check these)

- superpowers TDD rather than Pocock's `tdd`, so all four skills come from one source.
  Two TDD skills would give mixed instructions.
- `using-superpowers` left out: its "always invoke a skill" rule is written for
  interactive sessions.

## Left to the builder

- Turn the throwaway check above into a check in `smoke/` (protected: Dennis adds it).
- The behaviour test: the fake `claude` records its arguments; check that
  `--plugin-dir` is passed.
