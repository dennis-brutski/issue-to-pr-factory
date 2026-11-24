# Plan usage in the session log: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each `session ended` log line ends with the account's current plan usage, like `plan 5h 42% (resets 14:30) · week 18%`.

**Architecture:** A thin adapter `lib/plan.mjs` reads the login token and asks the usage endpoint, returning `null` on any problem. A pure formatter in `lib/usage.mjs` turns its result into text. `lib/stages.mjs` calls the adapter through `deps.planUsage` (wired in `factory.mjs`) after each session and appends the text.

**Tech Stack:** Node (stdlib `fetch`, `node:test`), no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-24-plan-usage-design.md`

## Global Constraints

- No dependencies: Node's standard library only.
- Don't touch the protected files (`lib/agent.mjs`, `config.mjs`, `targets/`, … see AGENTS.md rule 4).
- A failed lookup never fails a session or stage; the plan part is just left out.
- The token never goes into a log, an agent's environment, or an error message.
- Skipped on local runs (`cfg.localRun`).
- Tests never reach the real network.
- Plain wording in comments and log text. No commits by the agent: Dennis commits.
- `npm test` must pass.

## Review Focus

- Endpoint slow or down: the session line still shows up within a few seconds. Covered by the timeout test in Task 1.
- Response missing `seven_day`, or with `utilization: null`: show what's there, never `NaN%`. Covered by the parse tests in Task 1 and the formatter test in Task 2.
- Expired token (401): same as no data. Covered by the non-OK test in Task 1.
- The screen (`lib/screen.mjs`) still adds up `≈ $` from lines that now have more after the cost. Covered by the stages test in Task 3, which checks the cost part comes before the plan part. `screen-columns` tests must still pass.
- Behaviour tests run with Dennis's real `~/.claude`: they must not call the real endpoint. Covered by Task 4 (world points `CLAUDE_CONFIG_DIR` at a temp folder).

---

### Task 1: The usage adapter

**Files:**
- Create: `lib/plan.mjs`
- Test: `test/plan.test.mjs`

**Interfaces:**
- Produces:
  - `parsePlan(body: object) → { fiveHour?: number, fiveHourResetsAt?: number, week?: number } | null`. Percent is rounded to a whole number. Reset time is in epoch ms. Returns `null` when neither window has a number.
  - `planUsage({ configDir?: string, url?: string, timeoutMs?: number } = {}) → Promise<ReturnType<parsePlan> | null>`. `configDir` defaults to `process.env.CLAUDE_CONFIG_DIR || ~/.claude`, `url` to `https://api.anthropic.com/api/oauth/usage`, `timeoutMs` to `3000`.

- [ ] **Step 1: Write failing tests** in `test/plan.test.mjs`:
  - `parsePlan reads both windows`: `{ five_hour: { utilization: 41.6, resets_at: '2026-11-24T14:30:00Z' }, seven_day: { utilization: 18, resets_at: '…' } }` → `{ fiveHour: 42, fiveHourResetsAt: Date.parse('2026-11-24T14:30:00Z'), week: 18 }`.
  - `parsePlan keeps what is there`: only `five_hour` → no `week` key. `seven_day: { utilization: null }` → no `week` key.
  - `parsePlan gives null for nothing useful`: `{}`, `null`, `[]` → `null`.
  - `planUsage asks with the login token`: write `{ claudeAiOauth: { accessToken: 'tok' } }` to `<tmp>/.credentials.json`. Start a `node:http` server on port 0 that records the request headers and answers the JSON above. Assert the result equals the parse result, `authorization === 'Bearer tok'`, and `anthropic-beta === 'oauth-2025-04-20'`.
  - `planUsage gives null without a token file`: empty temp dir → `null`, and the server got no request.
  - `planUsage gives null on a non-OK answer`: server answers 401 → `null`.
  - `planUsage gives null when the server is slow`: server never answers, `timeoutMs: 100` → `null`, and the test finishes in under 1 s.
- [ ] **Step 2:** Run `node --test test/plan.test.mjs`. Expect FAIL (module not found).
- [ ] **Step 3: Implement `lib/plan.mjs`.** Use `fetch` with `signal: AbortSignal.timeout(timeoutMs)` and headers `Authorization: Bearer <token>` and `anthropic-beta: oauth-2025-04-20`. Put everything in one `try`/`catch` that returns `null`. Add a header comment that this is the endpoint Claude Code's `/usage` reads, it isn't public, and it may change.
- [ ] **Step 4:** Run `node --test test/plan.test.mjs`. Expect PASS.

### Task 2: The formatter

**Files:**
- Modify: `lib/usage.mjs` (add at the end)
- Test: `test/usage.test.mjs` (add cases)

**Interfaces:**
- Consumes: the `parsePlan` result shape from Task 1.
- Produces: `planLine(p) → string`. Returns `''` for `null`.

- [ ] **Step 1: Write failing tests:**
  - `planLine shows both windows and the 5-hour reset`: `planLine({ fiveHour: 42, fiveHourResetsAt: r, week: 18 })` === `` `plan 5h 42% (resets ${hhmm}) · week 18%` ``. Here `hhmm` is the local `HH:MM` of `r`, built in the test with `new Date(r)` `getHours`/`getMinutes` padded, so the test passes in any time zone.
  - `planLine leaves out what is missing`: `{ fiveHour: 42 }` → `plan 5h 42%`. `{ week: 18 }` → `plan week 18%`. `null` → `''`.
- [ ] **Step 2:** Run `node --test test/usage.test.mjs`. Expect FAIL.
- [ ] **Step 3: Implement `planLine`** in `lib/usage.mjs`. Format the reset time from local hours and minutes, padded to two digits.
- [ ] **Step 4:** Run `node --test test/usage.test.mjs`. Expect PASS.

### Task 3: Append it to the session line

**Files:**
- Modify: `lib/stages.mjs` (the `session` helper, around the `usageLine` call at line ~166, plus the import on line 9)
- Modify: `factory.mjs:30` (add `planUsage` to `deps`, import from `./lib/plan.mjs`)
- Test: `test/stages-usage.test.mjs` (add cases)

**Interfaces:**
- Consumes: `planUsage` (Task 1) as `deps.planUsage: () => Promise<plan | null>` (optional), and `planLine` (Task 2).

- [ ] **Step 1: Write failing tests** in `test/stages-usage.test.mjs`, reusing its `setup`:
  - `a session line ends with the plan usage`: set `d.planUsage = async () => ({ fiveHour: 42, week: 18 })`. Some log line matches `/session ended · .*≈ \$0\.10 · plan 5h 42% · week 18%$/`.
  - `no plan part when the lookup gives nothing`: `d.planUsage = async () => null`. Session lines have no `plan`. Also run once with no `d.planUsage` at all.
  - `no plan lookup on a local run`: `cfg.localRun: true` with a `planUsage` that counts its calls. The count stays 0.
  - `a failing lookup does not stop the run`: `d.planUsage = async () => { throw new Error('x') }`. The run still opens the pull request (`opened.length === 1`).
- [ ] **Step 2:** Run `node --test test/stages-usage.test.mjs`. Expect FAIL.
- [ ] **Step 3: Implement.** In `session`, when `used !== null && !cfg.localRun`, do `const plan = planLine(await deps.planUsage?.().catch(() => null))` and append `` ` · ${plan}` `` when it isn't empty. In `factory.mjs` add `planUsage` to `deps`, called with no arguments. It must also pass `url: cfg.planUsageUrl` so Task 4 can redirect it, i.e. `planUsage: () => planUsage({ url: cfg.planUsageUrl })`.
- [ ] **Step 4:** Run `npm test`. Expect everything to pass, including the `screen-*` tests.

### Task 4: Keep behaviour tests off the network, and prove it end to end

**Files:**
- Modify: `test/behavior/world.mjs` (`start()` env: add `CLAUDE_CONFIG_DIR: <a temp dir of the world>`; add lines only)
- Test: the behaviour test file that checks session log lines (find it with `grep -l "session ended" test/behavior/*.test.mjs`; add one case)

**Interfaces:**
- Consumes: `cfg.planUsageUrl` (Task 3) through the world's `settings` argument.

- [ ] **Step 1: Write a failing behaviour test**, `the session line shows plan usage`. Write `.credentials.json` with a dummy token into the world's config dir. Start a `node:http` fake on port 0 answering `{ five_hour: { utilization: 42 }, seven_day: { utilization: 18 } }`. Create the world with `planUsageUrl: 'http://127.0.0.1:<port>/'`, run one issue, and assert the output contains `plan 5h 42% · week 18%`.
- [ ] **Step 2:** Run that file with `node --test`. Expect FAIL until the world sets `CLAUDE_CONFIG_DIR` and the case passes `planUsageUrl` (the factory side is done in Task 3).
- [ ] **Step 3:** Add `CLAUDE_CONFIG_DIR` to the world's env. Any other behaviour test now finds no token, so it makes no network call.
- [ ] **Step 4:** Run `npm test`. Expect all to pass. Hand back to Dennis for review and commit.
