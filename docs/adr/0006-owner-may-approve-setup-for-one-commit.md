# 6. The owner may approve setup for one commit that changes protected files

Date: 2026-11-26 · Status: accepted · Adds to [ADR 0004](0004-issues-may-list-protected-files-as-a-draft.md)

## Context

Setup has network. Once a branch changes protected files, every later run stops before setup (ADR 0004), so an agent's unreviewed change to `package.json` or the lockfile can never make the factory install packages of the agent's choosing. That is right, but it is also a dead end: after a failed check, a merge conflict or a hand commit the factory can never retry the branch, even after Dennis has read the protected change. On 2026-11-25 this forced three hand finishes (#149, #152, #153).

## Decision

- The default stays: no setup with network on a branch that changes protected files.
- The owner may lift it for one commit with a comment on the issue or pull request: `approve protected setup <sha>`, on a line of its own, with the full 40-character sha of the commit they read.
- Only the owner's own comments count. The factory's comments (they start with 🏭) never do, even though gh posts them as the owner; the stop text quotes the approval line. Agents cannot post comments.
- The approval covers content, not a branch: setup runs when the diff from the approved commit to HEAD, limited to the protected files and folders, is empty. A sha the clone does not have approves nothing.
- The base merge before setup brings in only the base's own changes. If those touch a protected file, the diff is no longer empty, and a new approval is needed.
- The stop before setup names the branch's HEAD sha and shows the exact comment to post.
- An approval only lets setup run. A pull request that changes protected files stays a draft.

Considered and not taken: approval by label (it cannot name a commit, so it would cover whatever the branch holds next), and approval by anyone but the owner.

## Consequences

The factory can retry a branch whose protected change Dennis has read, without him finishing it by hand. Any later change to a protected file, by an agent or by the base, stops setup again until he reads and approves that too. Do not let an approval cover more than the protected content of the commit it names.
