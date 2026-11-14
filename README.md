# gin-rummy-scorepad-factory

Turns labelled GitHub issues of `dennis-brutski/gin-rummy-score-pad` into checked pull requests.
It runs only while you have started it. It never merges and never pushes to `master`.

Design and plan: `docs/superpowers/specs/2026-11-10-software-factory-design.md` and
`docs/superpowers/plans/2026-11-14-software-factory.md` in the app repo.

## Use

```sh
npm start        # runs in the foreground, checks GitHub every 5 minutes
```

- **Ctrl-C** stops picking up work and lets running agents finish.
- **Ctrl-C again** kills them at once. Their work is kept and resumes on the next start.

## Labels

You set one of these. Only labels **you** applied count.

| Label | On | What happens |
|---|---|---|
| `agent:explore` | issue | A write-up is posted. If the change is easy to undo and small, it moves on to implement by itself. |
| `agent:implement` | issue | It is built test-first, reviewed once, checked, and opened as a pull request. |
| `agent:review` | pull request | Your comments since the last push are addressed. The label is removed when done. |
| `agent:merge` | pull request | `master` is merged into the branch and conflicts are resolved. The label is removed when done. |

The factory sets these:

| Label | Meaning |
|---|---|
| `agent:in-progress` | Being worked on right now. |
| `agent:needs-human` | Stopped. The newest factory comment says why. **Remove this label to try again.** |
| `agent:done` | The pull request is open. |

## When it stops (`agent:needs-human`)

| The comment says | What to do |
|---|---|
| not clear enough to build without guessing | Answer the questions in a comment, remove the label. |
| needs your decision: not clearly easy to undo and small in reach | Read the write-up. To go ahead, swap `agent:explore` for `agent:implement` and remove the label. |
| the agent could not finish / produced no changes | Read what is missing; sharpen the issue or do it by hand. |
| `npm test` / `npm run e2e` failed | The output is in the comment. Remove the label for another attempt on the same branch. |
| draft because it touches protected files | The agent changed existing tests, CI, config or `package.json`. Review that part yourself. |
| issue text was edited after it was approved | Someone else edited their issue after you labelled it. Re-read it, remove the label. |
| timed out / max_turns / usage limit | Remove the label when you want it to continue. |

Nothing is ever retried on its own.

## Files

- `config.mjs` — repo, limits (2 at a time, confidence 70, timeouts).
- `prompts/` — what each agent step is told.
- `worktrees/issue-<n>/`, `logs/issue-<n>/` — per-issue work and session logs (not in git).
- `repo/` — the factory's own clone of the app (not in git).

## Checks

```sh
npm test         # unit tests
npm run smoke    # one real agent session; proves it cannot escape its worktree (uses Claude usage)
```

Agents run in Claude Code's sandbox. If the sandbox cannot start, the factory refuses to start.
