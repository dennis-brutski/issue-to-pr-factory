---
name: factory-inbox
description: Use when the owner says "factory inbox", "answer the factory", "factory stops", "what is the factory waiting for" or types /factory-inbox. Walks through every open issue and pull request the factory labelled agent:needs-human, one at a time, and acts only on approval.
---

# Factory inbox

Walk the owner through every open factory stop in one sitting. For each one, draft the answer;
**nothing is posted, labelled, pushed or committed until the owner approves that exact action.**

## Settings

Read `config.json` in this skill's folder (a copy of `config.example.json`):

- `owner`: the GitHub login whose repos the factory works on, and whose comments count.
- `factoryDir`: the path to the issue-to-pr-factory checkout.
- `notebookId`: a NotebookLM notebook to ask for design background. `null` or missing skips it.

If `config.json` is missing, say so, show `config.example.json` and stop.

## 1. Collect

```sh
gh search issues "label:agent:needs-human" --state open --owner <owner> --include-prs \
  --json repository,number,title,url,isPullRequest,updatedAt
```

Oldest `updatedAt` first. Say how many there are and in which repos, then take them one at a time.

## 2. Read one stop

```sh
gh issue view <n> -R <repo> --json title,body,labels,comments    # also works for pull requests
```

- **The stop** is the newest comment by `<owner>` starting with `🏭 **Factory stopped` or
  `🏭 **Factory did not start`. No such comment means the label was set by hand: say so.
- **The owner's answers since** are the owner's later comments that do not start with 🏭.
- **The target** is the file in `<factoryDir>/targets/` whose `repo:` matches. The worktree is
  `<factoryDir>/runs/<target>/worktrees/issue-<n>`; a pull request uses its branch's issue number
  (`factory/issue-<n>`). Check that it exists before planning a hand fix.
- Read the code the stop names before drafting.
- **Background:** for a design or "why" question, and only when `notebookId` is set, ask that
  notebook (`mcp__notebooklm-mcp__notebook_query`). Before any web search, ask the owner.
- If the answer is a decision only the owner can make, ask that one question first.

## 3. Show it

```
#13 gin-rummy-score-pad · implement · not clear enough (45/100)
What it wants: <one line>
Why it stopped: <one line>

Proposed: <reply | hand fix | push by hand | relabel>
<the exact comment text, the exact diff, or the exact label change>
Then: <the gh/git commands that will run>

approve / edit / skip?
```

Pick the kind from the stop:

| The stop says | Proposed |
|---|---|
| not clear enough, questions | **Reply** answering each question, then remove `agent:needs-human`. |
| existing test changed, protected file (not under `.github/workflows/`) | **Hand fix**: the edit agents may not make, in the worktree. When setup must run on it, add the `approve protected setup <sha>` comment the stop shows. A rule can't be lifted by a comment. |
| changes CI workflow files (the branch already has the change) | **Push by hand**: review the diff in the stop, run the checks in the worktree, push the branch and open the pull request yourself, then remove `agent:needs-human` and the trigger label. The factory never pushes workflow changes, so a retry stops again. |
| the issue needs a CI workflow change agents may not make | **Reply**: deliver everything except the workflow change; the owner adds it on the base branch after the merge. Never hand-fix a workflow file in the worktree: the next run parks before setup, and the factory would not push it anyway. |
| needs your decision (explore) | **Relabel**: swap `agent:explore` for `agent:implement` and remove `agent:needs-human`, or a reply saying no. |
| no new comments since the last push | **Reply** with the review comments to act on, then remove the label. |
| a check failed, could not finish | Read the output; a **reply** that sharpens the issue, or a **hand fix**. |
| worktree dirty, conflicts, git config changed | Explain what to do by hand; no automatic action. |

## 4. Act, only on "approve"

- **Reply:** `gh issue comment <n> -R <repo> --body-file <file>`, then
  `gh issue edit <n> -R <repo> --remove-label agent:needs-human`. A reply never starts with 🏭:
  the factory skips its own comments.
- **Hand fix:** apply the shown edit in the worktree, run the target's checks, commit with a short
  imperative message and no trailers, then remove the label. Approval of the fix is the owner asking
  for that commit. Checks fail: stop and show the output.
- **Push by hand:** `git push -u origin factory/issue-<n>` from the worktree, `gh pr create` with
  `Closes #<n>`, then remove `agent:needs-human` and the trigger label so the factory does not start again.
- **Relabel:** exactly the shown `gh issue edit` call.
- **"edit":** take the owner's changes, show the result again, wait. **"skip":** touch nothing.

## 5. End

One line each: answered, fixed, pushed, relabelled, skipped, with links.

## Mistakes to avoid

- Acting on "looks fine" for a *different* item: approval covers only the item just shown.
- Removing `agent:needs-human` before the comment or fix is in place: the factory may start first.
- Proposing a reply that asks the factory to ignore its rules: it cannot, so make it a hand fix,
  or a push by hand for workflow files.
