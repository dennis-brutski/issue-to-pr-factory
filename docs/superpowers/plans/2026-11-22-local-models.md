# Local models with `--local` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm start -- <target> --local` runs every agent session on a local model behind an Anthropic-compatible server.

**Architecture:** `lib/settings.mjs` learns to parse the factory's arguments and to lay a `local` settings block over the merged settings, turning `baseUrl` into `cfg.env` entries that already reach `claude`. `factory.mjs` wires the flag in and names the local model in its start line. No protected file changes.

**Tech Stack:** Node standard library (`node:util` `parseArgs`, `node:test`), the existing fake `claude` and fake `gh`.

**Spec:** `docs/superpowers/specs/2026-11-22-local-models-design.md`

## Global Constraints

- Do not touch protected files: `lib/agent.mjs`, `lib/brakes.mjs`, `lib/checks.mjs`, `lib/confine.mjs`, `lib/eligibility.mjs`, `lib/names.mjs`, `lib/workspace.mjs`, `lib/verify.mjs`, `prompts/_rules.md`, `config.mjs`, `package.json`, `targets/`, `smoke/`, `docs/adr/`, `AGENTS.md`, `.github/`.
- No dependencies.
- Overlay order: defaults < `local.mjs` < target < `local` block.
- Env entries: `ANTHROPIC_BASE_URL` = `baseUrl`, `ANTHROPIC_AUTH_TOKEN` = `'local'`, `ANTHROPIC_DEFAULT_HAIKU_MODEL` = local `model`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` = `'1'`, merged over the target's `env`.
- `maxBudgetUsd` = `null` under `--local`.
- Error text: `--local needs a local block with baseUrl and model in local.mjs`.
- Start line: `factory started for <repo> (<target>, local: <model>) — …`; unchanged without `--local`.
- `npm test` must pass. Do not commit: Dennis commits by hand.

## Review Focus

- A misspelt flag (`--locl`) must stop the factory, not quietly run on paid Claude. → Task 1 test.
- The flag before the target (`--local demo`) must work like after it. → Task 1 test.
- A block with only `model` must not send `sonnet` to the local server for the gate. → Task 1 test.
- The target's own `env` (e.g. `npm_config_cache`) must survive `--local`. → Task 1 test.
- A `local` block present but no `--local` flag must change nothing. → Task 1 test.

---

### Task 1: Parse arguments and lay the `local` block over the settings

**Files:**
- Modify: `lib/settings.mjs`
- Test: `test/settings.test.mjs` (add cases at the end; change none)

**Interfaces:**
- Produces: `parseFactoryArgs(argv: string[]) -> { target: string | undefined, local: boolean }`, throws on an unknown option or more than one positional.
- Produces: `loadSettings(arg, { factoryRoot, targetsDir, local = false })`, same return as today; under `local` the block is applied as in Global Constraints.

- [ ] **Step 1: Write the failing tests** in `test/settings.test.mjs`, using the file's `root()` and `target()` helpers:

```js
test('parseFactoryArgs: target and --local in either order', () => {
  assert.deepEqual(parseFactoryArgs(['demo', '--local']), { target: 'demo', local: true });
  assert.deepEqual(parseFactoryArgs(['--local', 'demo']), { target: 'demo', local: true });
  assert.deepEqual(parseFactoryArgs(['--local']), { target: undefined, local: true });
  assert.deepEqual(parseFactoryArgs([]), { target: undefined, local: false });
});
test('parseFactoryArgs refuses an unknown option', () => {
  assert.throws(() => parseFactoryArgs(['demo', '--locl']), /locl/);
});
test('--local lays the local block over the target, with the server in env', async () => {
  const r = root({ one: target({ model: 'opus', maxParallel: 3, env: { npm_config_cache: 'x' } }) });
  writeFileSync(join(r, 'local.mjs'), "export default { maxBudgetUsd: 5, local: { baseUrl: 'http://localhost:11434', model: 'qwen', maxParallel: 1 } };\n");
  const cfg = await loadSettings('one', { factoryRoot: r, local: true });
  assert.deepEqual([cfg.model, cfg.gateModel, cfg.simpleModel, cfg.maxParallel, cfg.maxBudgetUsd], ['qwen', 'qwen', 'qwen', 1, null]);
  assert.deepEqual(cfg.env, { npm_config_cache: 'x', ANTHROPIC_BASE_URL: 'http://localhost:11434', ANTHROPIC_AUTH_TOKEN: 'local',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qwen', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' });
});
test('--local keeps gateModel and simpleModel the block names', async () => {
  const r = root({ one: target({ local: { baseUrl: 'http://h', model: 'big', gateModel: 'small', simpleModel: 'mid' } }) });
  const cfg = await loadSettings('one', { factoryRoot: r, local: true });
  assert.deepEqual([cfg.model, cfg.gateModel, cfg.simpleModel], ['big', 'small', 'mid']);
});
test('--local without a usable local block stops', async () => {
  for (const local of [undefined, { model: 'qwen' }, { baseUrl: 'http://h' }]) {
    const r = root({ one: target(local ? { local } : {}) });
    await assert.rejects(loadSettings('one', { factoryRoot: r, local: true }), /--local needs a local block with baseUrl and model in local\.mjs/);
  }
});
test('a local block without --local changes nothing', async () => {
  const r = root({ one: target({ local: { baseUrl: 'http://h', model: 'qwen' } }) });
  const cfg = await loadSettings('one', { factoryRoot: r });
  assert.deepEqual([cfg.model, cfg.maxBudgetUsd, cfg.env], [config.model, config.maxBudgetUsd, config.env]);
});
```

Import `parseFactoryArgs` next to `loadSettings`.

- [ ] **Step 2: Run** `node --test test/settings.test.mjs` — Expected: FAIL, `parseFactoryArgs` is not exported.

- [ ] **Step 3: Implement** in `lib/settings.mjs`:
  - `parseFactoryArgs` with `parseArgs({ args: argv, options: { local: { type: 'boolean', default: false } }, allowPositionals: true, strict: true })`; more than one positional throws `one target at a time`.
  - In `loadSettings`, after `cfg` is merged and checked: if `local`, take `cfg.local`, throw the Global Constraints error unless it has `baseUrl` and `model`, then spread the block minus `baseUrl` over `cfg`, default `gateModel`/`simpleModel` to its `model`, set `maxBudgetUsd: null` and merge the four env entries over `cfg.env`. One short comment saying why the block goes over the target.

- [ ] **Step 4: Run** `node --test test/settings.test.mjs` — Expected: PASS.

- [ ] **Step 5: Leave uncommitted** for Dennis.

### Task 2: Wire `--local` into the factory and prove it end to end

**Files:**
- Modify: `factory.mjs` (argument line and start line)
- Modify: `test/behavior/fakes/claude.mjs` (log `anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL ?? null` in the existing log entry; it is a test fake, not a protected file)
- Create: `test/behavior/local.test.mjs`
- Modify: `README.md` (one row for `local` in the settings table near line 193)

**Interfaces:**
- Consumes: `parseFactoryArgs`, `loadSettings(…, { local })` from Task 1.

- [ ] **Step 1: Write the failing test** `test/behavior/local.test.mjs`, in the style of `test/behavior/implement.test.mjs`:

```js
test('--local sends every session to the local server and model', async () => {
  const w = await world({ settings: { local: { baseUrl: 'http://127.0.0.1:9', model: 'local-model' } } });
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(5, ['What exactly?'])]);
    const f = w.start(['--local']);
    await w.until(() => w.item(n).labels.includes('agent:needs-human'), 20000, 'agent:needs-human');
    assert.match(f.output(), /factory started for dennis-brutski\/demo \(demo, local: local-model\)/);
    const [call] = w.claudeCalls();
    assert.equal(call.anthropicBaseUrl, 'http://127.0.0.1:9');
    assert.equal(call.args[call.args.indexOf('--model') + 1], 'local-model');
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
test('an unknown option stops the factory', async () => {
  const w = await world();
  try {
    const f = w.start(['--locl']);
    assert.equal(await f.exited, 1);
    assert.match(f.output(), /factory cannot run: .*locl/);
  } finally { w.close(); }
});
```

- [ ] **Step 2: Run** `node --test test/behavior/local.test.mjs` — Expected: FAIL (start line has no `local:`; `anthropicBaseUrl` undefined).

- [ ] **Step 3: Implement:**
  - `factory.mjs`: inside the existing `try`, `const args = parseFactoryArgs(process.argv.slice(2)); cfg = await loadSettings(args.target, { factoryRoot, local: args.local });`. Update the `// Start:` comment to `npm start [-- <target>] [--local]`.
  - Start line: `(${cfg.target}${args.local ? `, local: ${cfg.model}` : ''})`, so keep `args` in scope.
  - Fake claude: add the `anthropicBaseUrl` field to the existing log object.
  - README: a row `` `local` — settings for `npm start -- --local`: `baseUrl` of an Anthropic-compatible server (Ollama, llama.cpp, LiteLLM) and `model`; anything else in it (`gateModel`, `maxParallel`, …) goes over the target. Set it in `local.mjs` `` with example `` `{ baseUrl: 'http://localhost:11434', model: 'qwen3-coder' }` ``.

- [ ] **Step 4: Run** `npm test` — Expected: all pass, including the README tests.

- [ ] **Step 5: Leave uncommitted** for Dennis. Report the one changed test-support line (`fakes/claude.mjs` log entry) and why.
