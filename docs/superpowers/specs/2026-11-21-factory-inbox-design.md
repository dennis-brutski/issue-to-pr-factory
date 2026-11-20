# Factory inbox: answer the factory's stops in one sitting

## Why

Less of Dennis's time per issue, fewer context switches. Today each stop means opening the
issue, reading the 🏭 comment, finding the code it is about, writing an answer and removing the
label, one issue at a time and across repos.

## Goals

- One command in a Claude session shows every open stop across all targets, oldest first.
- For each one: a short summary, a drafted reply or hand fix, and the action it would take.
  Dennis approves, edits or skips. Nothing is posted, labelled or committed without his OK.
- Ask Dennis only what is his to decide. Optionally use a NotebookLM notebook for design
  background, when one is configured; ask before any web search.
- No notebook id in git: it lives in the git-ignored `local.mjs`.

## Non-goals

- Letting the factory change existing tests or protected files itself (a separate project).
- Running without Dennis: the skill never answers on its own.

## Approaches

1. Skill file only, Claude runs `gh` itself: no code, but it re-parses stops each time and copies
   rules the factory already has.
2. **Skill plus a read-only `inbox.mjs` in the repo (picked):** what is waiting is decided by the
   factory's own tested code; the skill does the human part.
3. A script in the skill folder importing the repo by path: untested, breaks silently with `lib/`.

## The design

**`inbox.mjs`** (repo root, like `stats.mjs`; `npm run inbox`): `node inbox.mjs [<target>]`.
Read only. For each target (`targetNames`, `loadSettings`), `listCandidates` gives the labelled
items with comments; it keeps those with `agent:needs-human` and prints a JSON array, oldest stop
first:

```json
{ "repo": "o/r", "number": 70, "kind": "issue", "title": "…", "stage": "implement",
  "label": "agent could not finish", "stop": "<the stop comment body>", "stoppedAt": "ISO",
  "worktree": "runs/<target>/worktrees/issue-70", "worktreeExists": true,
  "since": ["<owner comments after the stop>"], "url": "https://github.com/…",
  "notebookId": null }
```

`notebookId` is that target's `cfg.notebookId`: a new setting, `null` by default in `config.mjs`
(comment: "NotebookLM notebook the inbox skill may ask for background; set yours in local.mjs"),
set in `local.mjs`, or per target in `targets/<name>.mjs` when a repo has its own notebook.

`stop` comes from `lastStop`, `label` from `stopLabel` in `stats.mjs`, `stage` from the stop
comment's heading. Also listed, with `stop: ""`: "Factory did not start" parks (the newest
`didNotStart` comment). Pure parts (picking and shaping) get unit tests; the `gh` part uses the
existing adapter, so the fake `gh` needs nothing new.

**The skill** `~/.claude/skills/factory-inbox/SKILL.md`, started with `/factory-inbox`:
1. Runs `npm run -s inbox` in the factory repo.
2. Goes through the stops one at a time: reads the issue, the stop and the code it names; for
   design questions asks the stop's `notebookId` notebook, and skips this step when it is `null`;
   asks Dennis before a web search, and asks him anything only he can decide.
3. Shows a 3-line summary, then either **a reply** (comment text plus "remove
   `agent:needs-human`") or **a hand fix** for what agents may not do (existing tests, protected
   files): the exact edit in the worktree, `npm test`, a commit, then remove the label.
4. Waits for approve / edit / skip. On approve it does exactly what it showed. A reply never
   starts with 🏭: the factory ignores its own comments.
5. Ends with a one-line list: answered, fixed, skipped.

Approving a hand fix counts as Dennis asking for that commit in the moment.

## Left to the builder

- The exact wording of the skill's prompts and the summary layout.
- `package.json` gets `"inbox": "node inbox.mjs"` and `config.mjs` gets `notebookId: null`: both
  protected, so a hand change. Dennis's `local.mjs` gets his notebook id (not committed).
