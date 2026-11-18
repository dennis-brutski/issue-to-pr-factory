# Skills for Factory Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Code sessions (`implement`, `fix`, `rework`) can use four superpowers skills. The skills are kept in the factory repo and loaded read-only with `--plugin-dir`.

**Architecture:** `skills/` in the factory repo is a Claude Code plugin named `factory`. `lib/settings.mjs` sets `cfg.skillsDir` when that folder exists. `lib/agent.mjs` turns it into `--plugin-dir` plus a read-only `Read(...)` rule and sandbox read access. The prompts name the skills to use. `sync-skills.mjs` refreshes the copies from the local plugin cache, and Dennis reads the diff.

**Tech Stack:** Node 25 standard library, `node --test`, the `claude` CLI.

**Spec:** `docs/superpowers/specs/2026-11-18-agent-skills-design.md`

## Global Constraints

- Start from `origin/main` (local `main` is 4 commits behind: #28–#31).
- No dependencies (AGENTS.md rule 2).
- Protected files touched by this plan: `lib/agent.mjs`, `package.json`, `targets/issue-to-pr-factory.mjs`, `smoke/`. Dennis approved the design ("ok, A"). He reads these changes before committing.
- No commit steps: Dennis commits himself. Each task ends at "`npm test` passes", and Dennis commits at that point.
- Plugin name `factory`, so skills are invoked as `factory:<skill>`.
- Vendored skills, exactly: `test-driven-development`, `verification-before-completion`, `systematic-debugging`, `receiving-code-review`.
- Plain wording in comments and messages (AGENTS.md rule 6).

## Review Focus

1. **`skills/` is missing**, e.g. in a temporary test root. Then no `--plugin-dir` is passed and nothing throws. Tested in Task 2.
2. **Several superpowers versions are in the cache** (`7.0.0`, `7.0.2`, later `7.0.10`). The sync script must pick the highest by number, not by text. Tested in Task 1.
3. **A skill says "ask your human partner".** The agent cannot ask. The prompts tell it to report `incomplete` with the question in `detail`. Tested in Task 3.
4. **A prompt names a skill that is not vendored**, e.g. a typo or a skill dropped in a sync. A test checks that every `factory:<name>` in `prompts/` exists in `skills/skills/`. Tested in Task 3.
5. **Cross-references inside skills.** `superpowers:test-driven-development` in systematic-debugging must become `factory:test-driven-development`. A reference to a skill that is not vendored (`superpowers:writing-skills`) stays as it is; it is harmless. Tested in Task 1.

---

### Task 1: Vendored skills and the sync script

**Files:**
- Create: `sync-skills.mjs` (next to `stats.mjs`; the same layout: pure exports plus a main block)
- Create: `skills/.claude-plugin/plugin.json`, and `skills/skills/<name>/…` (the output of the script)
- Modify: `package.json` (protected): `"sync-skills": "node sync-skills.mjs"`
- Test: `test/sync-skills.test.mjs`

**Interfaces:**
- Produces: `SKILLS` (the 4 names above, in that order); `latestVersion(names: string[]) → string | null`; `rewrite(text: string) → string`; `sync({ cacheDir, outDir }) → { version, skills: string[] }`.

- [ ] **Step 1: Write the failing tests**

```js
test('latestVersion compares by number', () => {
  assert.equal(latestVersion(['7.0.2', '7.0.10', '7.0.0']), '7.0.10');
  assert.equal(latestVersion([]), null);
  assert.equal(latestVersion(['notes', '7.0.2']), '7.0.2'); // non-versions ignored
});
test('rewrite points vendored skills at the factory plugin only', () => {
  assert.equal(rewrite('use superpowers:test-driven-development'), 'use factory:test-driven-development');
  assert.equal(rewrite('see superpowers:writing-skills'), 'see superpowers:writing-skills');
});
test('sync copies the four skills with their extra files and records the version', () => {
  // temp cacheDir with superpowers/7.0.0 and superpowers/7.0.2, each with all 4 skills,
  // systematic-debugging/root-cause-tracing.md and an unrelated skill brainstorming/
  const r = sync({ cacheDir, outDir });
  assert.equal(r.version, '7.0.2');
  assert.deepEqual(r.skills, SKILLS);
  assert.ok(existsSync(join(outDir, 'skills/systematic-debugging/root-cause-tracing.md')));
  assert.ok(!existsSync(join(outDir, 'skills/brainstorming')));
  assert.equal(JSON.parse(readFileSync(join(outDir, '.claude-plugin/plugin.json'))).name, 'factory');
  // plugin.json description says: copied from superpowers 7.0.2 by sync-skills.mjs
});
test('sync removes a skill file that upstream dropped', () => { /* stale file in outDir is gone after sync */ });
```

- [ ] **Step 2: Run `node --test test/sync-skills.test.mjs`.** Expected: FAIL, cannot import `../sync-skills.mjs`.

- [ ] **Step 3: Implement in `sync-skills.mjs`**

The cache defaults to `~/.claude/plugins/cache/claude-plugins-official/superpowers`, and the output to `<factory>/skills`. `sync` replaces `outDir/skills/` as a whole (`rmSync` then `cpSync` per skill), runs `rewrite` over `.md` files only, and writes `plugin.json` (`{ name, version, description }`, version = the source version). The main block prints `copied <n> skills from superpowers <version>; read git diff skills/ before committing`. With no version found, it exits 1 with `no superpowers plugin in <cacheDir>`.

- [ ] **Step 4: Run `node --test test/sync-skills.test.mjs`.** Expected: PASS.

- [ ] **Step 5: Run `node sync-skills.mjs`, then `ls skills/skills`.** Expected: the 4 folders, and `grep -r "superpowers:test-driven" skills/` finds nothing.

- [ ] **Step 6: Add the npm script to `package.json`. Run `npm test`.** Expected: PASS.

### Task 2: Load the plugin in every agent session

**Files:**
- Modify: `lib/settings.mjs` (`loadSettings` return)
- Modify: `lib/agent.mjs` (protected): `buildArgs`, `agentSettings`, `runAgent`
- Modify: `targets/issue-to-pr-factory.mjs` (protected): add `'skills/'` to `protectedDirs`, and `'sync-skills.mjs'` to `protectedFiles`
- Test: new tests appended to `test/agent.test.mjs` and `test/settings.test.mjs` (existing tests unchanged)

**Interfaces:**
- Consumes: the `skills/` folder from Task 1.
- Produces: `cfg.skillsDir: string | undefined`; `buildArgs({ …, pluginDir })`; `agentSettings(worktreeDir, cfg)` honours `cfg.skillsDir`.

- [ ] **Step 1: Write the failing tests**

```js
// test/settings.test.mjs
test('skillsDir is set only when <factory>/skills exists', async () => {
  const r = root({ one: target() });
  assert.equal((await loadSettings('one', { factoryRoot: r })).skillsDir, undefined);
  mkdirSync(join(r, 'skills'));
  assert.equal((await loadSettings('one', { factoryRoot: r })).skillsDir, join(r, 'skills'));
});
// test/agent.test.mjs
test('buildArgs loads the skills plugin when given, before --disallowedTools', () => {
  const a = buildArgs({ ...base, pluginDir: '/f/skills' });
  assert.equal(a[a.indexOf('--plugin-dir') + 1], '/f/skills');
  assert.ok(a.indexOf('--plugin-dir') < a.indexOf('--disallowedTools'));
  assert.ok(!buildArgs(base).includes('--plugin-dir'));
});
test('agentSettings lets agents read the skills, never write them', () => {
  const s = agentSettings('/r/worktrees/issue-1', { ...config, runDir: '/r', skillsDir: '/f/skills' });
  assert.ok(s.permissions.allow.includes('Read(//f/skills/**)'));
  assert.ok(!s.permissions.allow.some((p) => /^(Edit|Write)\(\/\/f\/skills/.test(p)));
  assert.ok(s.sandbox.filesystem.allowRead.includes('/f/skills'));
  const none = agentSettings('/r/worktrees/issue-1', { ...config, runDir: '/r' });
  assert.ok(!JSON.stringify(none).includes('skills'));
});
```

- [ ] **Step 2: Run `node --test test/agent.test.mjs test/settings.test.mjs`.** Expected: the 3 new tests FAIL.

- [ ] **Step 3: Implement**
- `lib/settings.mjs`: add `skillsDir` when `existsSync(join(factoryRoot, 'skills'))`. Leave the key out otherwise, so whole-cfg comparisons in existing tests still hold.
- `lib/agent.mjs`:
  - `buildArgs` pushes `'--plugin-dir', pluginDir` just before `--disallowedTools`. The comment there says the variadic flag must stay last.
  - `agentSettings` appends `` `Read(/${cfg.skillsDir}/**)` `` to `allow`, and `cfg.skillsDir` to `allowRead`, only when it is set.
  - `runAgent` passes `pluginDir: cfg.skillsDir`.
  - One comment line: read-only, outside the worktree, so an agent cannot change its own instructions.
- Targets file: the two protected entries.

- [ ] **Step 4: Run `npm test`.** Expected: PASS, with all existing tests unchanged.

### Task 3: Prompts name the skills

**Files:**
- Modify: `prompts/implement.md`, `prompts/fix.md`, `prompts/rework.md` (not `_rules.md`, which is protected; not `review.md`)
- Test: `test/prompts-skills.test.mjs`

**Interfaces:**
- Consumes: `SKILLS` from `sync-skills.mjs`; the `skills/skills/` folder.

- [ ] **Step 1: Write the failing tests**

```js
test('each code prompt names its skills', () => {
  const want = {
    implement: ['test-driven-development', 'verification-before-completion'],
    fix: ['systematic-debugging', 'verification-before-completion'],
    rework: ['receiving-code-review', 'systematic-debugging', 'verification-before-completion'],
  };
  for (const [p, names] of Object.entries(want))
    for (const n of names) assert.match(read(`prompts/${p}.md`), new RegExp(`factory:${n}\\b`));
});
test('every skill a prompt names is vendored', () => {
  // every factory:<name> in prompts/*.md exists as skills/skills/<name>/SKILL.md
});
test('code prompts say what to do when a skill says to ask', () => {
  for (const p of ['implement', 'fix', 'rework']) assert.match(read(`prompts/${p}.md`), /cannot ask/);
});
test('review prompt stays without skills', () => assert.ok(!read('prompts/review.md').includes('factory:')));
```

- [ ] **Step 2: Run `node --test test/prompts-skills.test.mjs`.** Expected: FAIL on the first and third tests.

- [ ] **Step 3: Edit the three prompts.** Add one short block under the heading, after `{{commit}}`:

```md
Use these skills (Skill tool): `factory:…`, `factory:…`.
Where a skill says to ask your human partner: you cannot ask. Stop, report `incomplete`, and put the question in `detail`.
```

In `implement.md`, step 2 ("Work test-first …") points to `factory:test-driven-development` instead of repeating it. Keep the `<!-- session: … -->` marker as the first line: the fake `claude` finds sessions by it.

- [ ] **Step 4: Run `npm test`.** Expected: PASS. This includes the behaviour tests, which render these prompts through the fake `claude`.

### Task 4: Smoke check for skills (Dennis runs it)

**Files:**
- Create: `smoke/skills.mjs` (protected folder)
- Modify: `package.json` (protected): `"smoke:skills": "node smoke/skills.mjs"`

**Interfaces:**
- Consumes: `buildArgs`, `agentSettings` from `lib/agent.mjs`; `loadSettings`.

- [ ] **Step 1: Write `smoke/skills.mjs`.** Use the same three checks as the throwaway run on 2026-11-18, against the real `skills/` folder:
  - A read-only session (`--model haiku`, max 8 turns) invokes `factory:test-driven-development` and reports a phrase only found in `skills/skills/test-driven-development/writing-good-tests.md`. This proves the Skill tool and the extra-file Read.
  - A write session is told to append a line to `skills/skills/test-driven-development/SKILL.md`. Pass = the file is unchanged afterwards and `permission_denials` is not empty.
  - Print `ok` / `FAIL: <why>` per check and exit non-zero on any FAIL, as `smoke/containment.mjs` does.
  - Work in a temporary git worktree under the target's `runDir`.

- [ ] **Step 2: Dennis runs `npm run smoke:skills`.** Expected: two `ok` lines. It costs about $0.01 on Haiku. Agents do not run smoke (AGENTS.md).

- [ ] **Step 3: Run `npm test`.** Expected: PASS (smoke is not part of it).
