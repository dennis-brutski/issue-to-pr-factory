# Run agent sessions on a local model with `--local`

## Why

Claude usage costs money, and once a usage limit is reached the factory stops.
`npm start -- <target> --local` lets it keep going on a model running on this
machine. It is an experiment: local models are expected to do worse.

## Goals

- One flag, `--local`, switches every agent session to a local model.
- What "local" means (server address, model names, slower-machine values) lives
  in the git-ignored `local.mjs`, so each person sets their own.
- Without `--local`, nothing changes.

## Non-goals

- Fully offline: the factory still needs GitHub.
- Mixing local and Claude in one run (approach B). Can come later.
- Switching to local by itself when a limit is hit (approach C).
- A different agent tool than `claude`.

## Anti-goals

- Touching protected files or loosening confinement.
- Any setting from `--local` leaking into a run started without it.

## Approaches

- **A. `--local` overlays a `local` block, all sessions local (chosen).** Small
  diff, no protected files, covers the "limit reached" case.
- B. Per-stage mix: saves more, but needs per-session environment in
  `lib/stages.mjs`, and does not help once the limit is hit.
- C. Automatic fallback on a limit: more logic than an experiment needs;
  restarting with `--local` does the same.

Rejected: replacing `claude` with another tool, as that means rewriting the
protected `lib/agent.mjs` and its confinement.

## Design

`local.mjs` gets an optional `local` block, for example:

```js
export default {
  owner: 'alex',
  local: {
    baseUrl: 'http://localhost:11434', // Ollama, llama.cpp server, LiteLLM, …
    model: 'qwen3-coder', gateModel: 'qwen3-coder', simpleModel: 'qwen3-coder',
    maxParallel: 1, sessionTimeoutMin: 90,
  },
};
```

- `factory.mjs` reads `--local` from its arguments with Node's `util.parseArgs`;
  the target is the one positional argument, before or after the flag.
  `npm start -- --local` works with a single target. An unknown option
  (`--locl`) stops the factory instead of quietly running on Claude.
- `loadSettings(arg, { factoryRoot, local: true })` lays the `local` block on top
  of everything (defaults < `local.mjs` < target < `local` block), since the
  target's model names mean Claude models.
- `baseUrl` is not a setting of its own: it becomes entries in `cfg.env`, merged
  with the target's `env`, which already reaches agent sessions:
  - `ANTHROPIC_BASE_URL` = `baseUrl`
  - `ANTHROPIC_AUTH_TOKEN` = `local` (a placeholder, so the Claude login is not sent)
  - `ANTHROPIC_DEFAULT_HAIKU_MODEL` = the local `model` (Claude Code's own small calls)
  - `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` = `1`
- `maxBudgetUsd` is set to `null` for local runs: it means nothing there.
- `model` is required in the block; `gateModel` and `simpleModel` default to it,
  so no Claude model name ever reaches the local server.
- `--local` without a `local` block (or without `baseUrl` or `model`) stops the
  factory with "factory cannot run: --local needs a local block with baseUrl and model in local.mjs".
- The block is read from the merged settings, so a target file may hold one too
  (the behaviour tests use that; the real `local.mjs` is not theirs to write).
- The start line says it runs locally, e.g. `… (my-target, local: qwen3-coder)`.

These variables also reach setup and checks through `cfg.env`. That is harmless:
no real token is in them.

## Tests

- Unit (`test/settings.test.mjs`): the overlay order, the env entries, budget off,
  the error without a block, no change without the flag.
- Behaviour (`test/behavior/`): the real factory started with `--local` runs an
  issue, and the fake `claude` was started with `ANTHROPIC_BASE_URL` set.

## Left to the builder

Exact argument parsing, the wording of the start line, and where in `test/behavior/` the new test goes.
