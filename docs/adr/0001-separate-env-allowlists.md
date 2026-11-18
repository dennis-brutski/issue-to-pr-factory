# 1. Agents and confined runs keep separate environment allowlists

Date: 2026-11-18 · Status: accepted

## Context

What a confined process may see is decided in three modules: `lib/agent.mjs` (agent sessions: `AGENT_ENV`, the Claude sandbox's read list), `lib/confine.mjs` (setup and checks under bwrap: `PASSED_ON`, read and write lists) and `lib/checks.mjs` (setup's caches, the held-out folder). An architecture review suggested merging them into one policy table rendered by two adapters.

## Decision

Keep them separate. Agent sessions and setup/check runs are different kinds of process with different needs: an agent needs `claude`'s config and proxy variables, a check run needs none of that and runs code nobody has reviewed. The Software Factory notebook recommends separate allowlists for agents and for check runs, so that widening one never widens the other.

## Consequences

Auditing confinement means reading the three modules side by side. A change to one list must not be copied to the other without asking why. Do not propose merging them unless a bug shows the split itself is at fault.
