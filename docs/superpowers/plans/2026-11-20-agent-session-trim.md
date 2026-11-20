# Trim What Every Agent Session Sends: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fewer tokens written to the prompt cache per agent session, and no memory instructions in agent sessions.

**Architecture:** Three small changes where `lib/agent.mjs` starts `claude -p`: one more CLI flag in `buildArgs`, one more env var in `runAgent`, two more names in `ALWAYS_DISALLOWED`.

**Tech Stack:** Node (standard library only), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-20-agent-session-trim-design.md`

## Global Constraints

- `lib/agent.mjs` is a protected file (AGENTS.md rule 4): Dennis makes this change by hand, or an agent with his explicit OK in that session. The factory must not build it.
- `test/agent.test.mjs:27` may be changed (approved by Dennis on 2026-11-21). No other existing test changes.
- `--disallowedTools` stays the last argument (it is variadic; the prompt goes in on stdin).
- No dependencies. `npm test` passes.

## Review Focus

- `readOnly: true`: the write tools still come first in the disallowed list, the two new names follow the old ones. Covered by the existing readOnly test and Task 1's list test.
- A budget set: `--max-budget-usd` and the new flag together still leave `--disallowedTools` last. Covered by `test/agent-budget.test.mjs`, unchanged.
- A target's `cfg.env` must not be able to switch memory back on: the factory's value is set before `...targetEnv(cfg, port)`, so a target could override it. Keep that order (targets own their env), but Task 2's test pins the default.
- Confinement: none of the three changes touches `agentSettings`. `npm run smoke` (Dennis) confirms the 8 ways out are still closed.

---

### Task 1: Flag and disallowed tools in `buildArgs`

**Files:**
- Create: `test/agent-trim.test.mjs`
- Modify: `lib/agent.mjs` (`ALWAYS_DISALLOWED`, `buildArgs`)
- Modify: `test/agent.test.mjs:27`

**Interfaces:**
- Produces: `buildArgs(...)` output contains `'--exclude-dynamic-system-prompt-sections'`; the value after `--disallowedTools` ends with `,ListAgents,ReportFindings`.

- [ ] **Step 1: Write the failing tests** in `test/agent-trim.test.mjs` (same `base` as `test/agent.test.mjs`):

```js
test('buildArgs keeps per-machine details out of the system prompt', () => {
  const a = buildArgs(base);
  assert.ok(a.includes('--exclude-dynamic-system-prompt-sections'));
  assert.equal(a.at(-2), '--disallowedTools');
});
test('buildArgs disallows the tools no stage uses', () =>
  assert.match(buildArgs(base).at(-1), /,ListAgents,ReportFindings$/));
```

- [ ] **Step 2: Run them to see them fail:** `node --test test/agent-trim.test.mjs`. Expected: both fail.
- [ ] **Step 3: Implement.** Append `'ListAgents', 'ReportFindings'` to `ALWAYS_DISALLOWED`. In `buildArgs`, add `'--exclude-dynamic-system-prompt-sections'` to the fixed list after `'--no-session-persistence'`.
- [ ] **Step 4: Update `test/agent.test.mjs:27`** to expect `/--disallowedTools AskUserQuestion,Agent,Monitor,ScheduleWakeup,WebFetch,WebSearch,ListAgents,ReportFindings$/`. Keep the test's name.
- [ ] **Step 5: Run `npm test`.** Expected: all pass.
- [ ] **Step 6: Commit:** `git commit -m "Keep per-machine details and unused tools out of agent sessions"`

### Task 2: No memory instructions in agent sessions

**Files:**
- Modify: `test/agent-trim.test.mjs`
- Modify: `lib/agent.mjs` (`runAgent` env)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: the session env has `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.

- [ ] **Step 1: Write the failing test** `runAgent turns off Claude Code's memory`. Use the env-dump fake `claude` from `test/agent.test.mjs` (`runAgent passes on only allowlisted variables…`): put it first on `PATH`, call `runAgent({ cwd: bin, prompt: 'p', schema: { type: 'object' }, cfg: config, port: 4201 })`, restore `process.env` in `finally`. Assert `env.CLAUDE_CODE_DISABLE_AUTO_MEMORY === '1'`.
- [ ] **Step 2: Run it to see it fail:** `node --test test/agent-trim.test.mjs`.
- [ ] **Step 3: Implement.** In `runAgent`'s env, add `CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1'` next to `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`.
- [ ] **Step 4: Run `npm test`.** Expected: all pass.
- [ ] **Step 5: Commit:** `git commit -m "Turn off Claude Code's memory in agent sessions"`

### Task 3: Check with real Claude (Dennis)

- [ ] `npm run smoke`: all 8 ways out still closed.
- [ ] After the next factory run, compare a gate session's `cache_creation_input_tokens` in `runs/<target>/logs/issue-N/*-gate.json` with the average before (about 20.6k). Expect about 2k less.
