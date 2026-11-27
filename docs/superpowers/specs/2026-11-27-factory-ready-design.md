# Factory ready: pick the issues the factory should build next

## Why

Dennis labels issues `agent:implement` one by one, across three targets. He wants a skill that walks him through the open issues that could be built now, recommends what to do with each, and lets him decide, the way `/factory-inbox` walks him through the stops. The label is his approval, so the skill never labels in bulk.

## Goals

- `/factory-ready` shows every open issue that is not blocked, grouped by target and then by recommendation, and acts on each only after he approves that exact action.
- "Waits for another issue" means exactly what the factory means by it: the same `dependsOn()` code.
- One setting, `currentTargetOnly`, makes both skills work only on the target of the folder Claude was started in.

## Non-goals

- Labelling anything without a per-issue yes.
- GitHub's own "blocked by" links: no issue uses them. Add them later if they start to.
- Changing how the factory itself picks work.

## Approaches

Picked: **B, a skill plus a small script.** `ready.mjs` decides which issues are blocked, with the factory's own code and tests; the skill does the reading, recommending and asking.

Considered: A, prose only like `/factory-inbox` (no code, but "depends on" written down twice and redone by Claude each run, so the two can drift); C, a second mode inside `/factory-inbox` (one file doing two jobs with different triggers).

## Part 1: `ready.mjs` and `/factory-ready` (by hand)

**`lib/ready.mjs`** (pure, no I/O): `readiness(issue, cfg, openIssues)` returns `{ ready: true }` or `{ ready: false, reason }`. An issue is not ready when:

| Reason | Rule |
|---|---|
| `has <label>` | it carries any trigger or state label (`cfg.triggers`, `cfg.states`) |
| `waits for #n, #m` | `dependsOn(body)` from `lib/eligibility.mjs`, keeping only open issues, as `classify()` does |
| `has n open sub-issues` | `subIssuesSummary.total > completed` |
| `has an open pull request: #n` | an open pull request closes it (`closedByPullRequestsReferences`) |

**`lib/github.mjs`**: `listOpenIssues(cfg)`, one GraphQL query paged like `listCandidates`, every open issue whatever its labels: number, title, url, body, labels, `subIssuesSummary { total completed }`, `closedByPullRequestsReferences(first: 10) { nodes { number state } }`. The fake `gh` learns it and gets a contract test (AGENTS.md rule 3).

**`ready.mjs`** (root, like `stats.mjs`): `node ready.mjs [<target> | --current]` prints JSON:

```json
[{ "target": "job-search", "repo": "dennis-brutski/job-search",
   "ready": [{ "number": 87, "title": "…", "url": "…" }],
   "skipped": [{ "number": 1, "title": "…", "url": "…", "reason": "has 13 open sub-issues" }] }]
```

No argument: every target in `targets/`; a target that fails gets `"error"` and the others still print. `--current`: the target whose `repo` matches the `origin` remote of the current folder; none matches: exit 1 with "this folder is not a target: <remote>". The helper that finds it lives in `lib/settings.mjs`, so `inbox.mjs` can use it.

**`factory-ready/SKILL.md`**, installed like the inbox (symlink into `~/.claude/skills/`). It reads `factory-inbox/config.json` (one settings file for both skills) and runs `node <factoryDir>/ready.mjs` with `--current` when `currentTargetOnly` is true. Then:

1. Say how many are ready and skipped, per target; list the skipped in one line each with the reason.
2. For each ready issue, read it and the code it touches, and recommend one of:
   - **implement**: clear, small, testable;
   - **explore**: the goal is clear, the way is not;
   - **sharpen first**: draft the missing parts (acceptance criteria, files, `## Tests that change`); on yes, edit the issue, then label it. Editing before labelling, because an edit after the label can make the factory stop;
   - **leave**: too big or not ready, and why;
   - **close**: done already, such as a tracking issue whose sub-issues are all closed (job-search #1 today: 13 of 13). On yes, `gh issue close` with a one-line comment.
3. Show it, grouped by target, then by recommendation:

   ```
   job-search #87 · Duplication and dead code: clean up findings
   Recommend: sharpen first — no list of which findings, no test to show it's done
   Draft: <the added text>
   Then: gh issue edit 87 -R … --body-file … ; gh issue edit 87 -R … --add-label agent:implement
   approve / implement as is / explore / skip?
   ```

4. Act only on approval of that item, exactly the commands shown. End with one line each: labelled, sharpened, skipped, with links.

**`factory-inbox/config.example.json`** gets `"currentTargetOnly": false`. README: an install line and a short section next to the inbox one.

Tests: unit tests for `readiness` (each reason, a closed dependency, a closed pull request), `runReady` with a fake `gh` like `runStats` (all targets, one failing, `--current` match and no match), the contract test for the new query.

## Part 2: `inbox.mjs` (an issue for the factory)

`node inbox.mjs [<target> | --current]` prints the open stops as JSON: each item labelled `agent:needs-human` in each target, with its newest stop comment, the owner's answers since, and the worktree path if it exists. `/factory-inbox` uses it instead of `gh search`, and honours `currentTargetOnly`.

The factory can build it: a new root script, a new `gh` call the fake learns, and `factory-inbox/SKILL.md`, none of them protected. Filed as an issue with `## Depends on` pointing at a small issue for part 1, so the factory waits until part 1 is merged.

## Left to the builder

- Names inside the code, the exact GraphQL text, how the fake `gh` answers it.
- Wording of the skill's description triggers ("factory ready", "what can the factory build next", `/factory-ready`).
