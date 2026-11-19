# Security

The factory runs AI agents on your machine and lets them change code. A way out of their confinement is a security problem.

## Reporting

Report it privately: on GitHub, open the **Security** tab and choose **Report a vulnerability**. Please do not open a public issue.

## In scope

- An agent session, setup or checks writing outside the worktree, reaching the network where it should not, reading tokens or files in your home folder, pushing, or changing what git runs.
- Anyone other than the configured `owner` making the factory act.

## Known limits

What the factory does not protect against is listed in the README under *Confinement*, in "What stays outside".
