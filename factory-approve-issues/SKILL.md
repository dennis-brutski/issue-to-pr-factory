---
name: factory-approve-issues
description: Use when the owner says "approve issues", "factory approve issues", "what can the factory build next", "label issues for the factory" or types /factory-approve-issues. Walks through every open issue of the factory's targets that nothing holds back, recommends implement, explore, sharpen first, leave or close for each, and acts only on approval.
---

# Factory approve issues

Walk the owner through the open issues the factory could build now. For each one, recommend what to do;
**nothing is edited, labelled or closed until the owner approves that exact action.** The
`agent:implement` label is the owner's approval of the work, so never label in bulk.

## Settings

Read `~/.claude/skills/factory-inbox/config.json`, the settings file this skill shares with
`/factory-inbox`:

- `owner`: the GitHub login whose repos the factory works on.
- `factoryDir`: the path to the issue-to-pr-factory checkout.
- `currentTargetOnly`: `true` works only on the target of the folder Claude was started in.
  Missing means `false`.

If the file is missing, say so, show `<factoryDir>/factory-inbox/config.example.json` and stop.

## 1. Collect

```sh
node <factoryDir>/ready.mjs              # every target
node <factoryDir>/ready.mjs --current    # when currentTargetOnly is true; run it in the folder Claude started in
```

It prints JSON, one entry per target: `ready` (issues nothing holds back) and `skipped` (with a
`reason`: a factory label, waits for an open issue or blocked-by link, open sub-issues, an open
pull request). An entry with `error` could not be read: say so. `--current` outside a target exits 1
with "this folder is not a target": say so and stop.

Say how many are ready and skipped, per target. List the skipped in one line each with the reason.

## 2. Read one issue

```sh
gh issue view <n> -R <repo> --json title,body,labels,comments
```

Read the code it names or touches in the target's checkout (the issue's repo cloned at
`<factoryDir>/runs/<target>/repo`, or ask the owner where it is). Then pick one:

| Recommend | When |
|---|---|
| **implement** | Clear goal, small, and a test can show it works. |
| **explore** | The goal is clear, the way to do it is not. |
| **sharpen first** | Worth building, but missing what an agent needs: acceptance criteria, the files, `## Tests that change`, `## Protected files that change`. Draft the missing text. |
| **leave** | Too big, unclear in its goal, or not wanted now. Say why in one line. |
| **close** | Done already, such as a tracking issue whose sub-issues are all closed. Draft a one-line closing comment. |

## 3. Show it

Group by target, then by recommendation, implement first. One issue at a time:

```
job-search #87 · Duplication and dead code: clean up findings
Recommend: sharpen first — no list of which findings, no test to show it's done
Draft: <the exact text added to the issue>
Then: gh issue edit 87 -R <repo> --body-file <file>
      gh issue edit 87 -R <repo> --add-label agent:implement

approve / implement as is / explore / edit / skip?
```

## 4. Act, only on approval of that item

- **implement / explore:** `gh issue edit <n> -R <repo> --add-label agent:implement` (or `agent:explore`).
- **sharpen first:** edit the issue first (`--body-file` with the whole new body), then add the label.
  Never the other way round: the factory may start between the two, on the old text.
- **close:** `gh issue close <n> -R <repo> --comment <text>`.
- **"edit":** take the owner's changes, show the result again, wait. **"skip"** and **leave:** touch nothing.

## 5. End

One line each: labelled, sharpened and labelled, closed, left, skipped, with links.

## Mistakes to avoid

- Acting on "looks fine" for a *different* issue: approval covers only the issue just shown.
- Labelling before the edit is in place.
- Labelling an issue `ready.mjs` skipped: the factory would only wait or stop on it. Say what holds it back instead.
- A comment or edit that starts with 🏭: the factory skips its own comments.
