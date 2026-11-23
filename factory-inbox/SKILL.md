---
name: factory-inbox
description: Use when the owner says "factory inbox", "answer the factory", "factory stops", "what is the factory waiting for" or types /factory-inbox. Walks through every open issue and pull request the factory labelled agent:needs-human, one at a time, and acts only on approval.
---

# Factory inbox

Go through the factory's open stops with the owner, one at a time. Draft the answer; the owner decides. Nothing is posted, labelled or committed until the owner approves that one item.

## Settings

Read `config.json` in this skill's folder (copy of `config.example.json`):

- `owner`: the GitHub login whose repos the factory works on, and whose comments count.
- `factoryDir`: the path to the issue-to-pr-factory checkout. Worktrees are in `<factoryDir>/runs/<target>/worktrees/issue-<n>`.
- `notebookId`: a NotebookLM notebook to ask for design background. `null` skips it.

If `config.json` is missing, say so, show `config.example.json` and stop.

## 1. Find the stops

```sh
gh search issues "label:agent:needs-human" --state open --owner <owner> --include-prs --sort created --order asc --limit 100 --json repository,number,title,url,isPullRequest,createdAt
```

That covers every repo of the owner. Go through them oldest first. For each one, read the whole thread:

```sh
gh issue view <n> --repo <repo> --comments      # or: gh pr view <n> --repo <repo> --comments
```

The stop is the newest comment by the owner that starts with `🏭 **Factory stopped` or `🏭 **Factory did not start`. Comments by the owner after it, not starting with 🏭, are what was said since. No such comment: the label was set by hand; say so.

A pull request's worktree is its issue's: branch `factory/issue-<n>` means `worktrees/issue-<n>`, not the pull request's number.

## 2. Understand it

- Read what the issue asks, the stop's reason, and the code or test it names (in the worktree when it exists, else the target's clone in `runs/<target>/repo`).
- For a design question, ask the `notebookId` notebook when it is set. Skip this when it is `null`.
- Ask the owner before any web search.
- Ask the owner only what is theirs to decide.

## 3. Show it

For each stop show:

1. Three lines: what the issue wants, why the factory stopped, what would unblock it.
2. One proposal:
   - **a reply**: the exact comment text, then "remove `agent:needs-human`"; or
   - **a hand fix** for what agents may not do (existing tests, protected files): the exact edit in the worktree, `npm test`, a commit with a short imperative subject and no trailers, then remove the label; or
   - **a relabel**: which label to set instead, and why.

Then wait: approve / edit / skip.

## 4. Act

- **approve**: do exactly what was shown, nothing more. Approving a hand fix counts as the owner asking for that commit.
- **edit**: change the proposal as told, show it again, wait again.
- **skip**: leave the item as it is and go on.

A reply never starts with 🏭: the factory ignores its own comments. Remove the label with `gh issue edit <n> --repo <repo> --remove-label agent:needs-human` (or `gh pr edit`).

## 5. End

One line each: answered, fixed, skipped, with their numbers.
