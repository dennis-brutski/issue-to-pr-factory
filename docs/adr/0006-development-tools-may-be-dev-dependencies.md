# 6. Development tools may be dev dependencies; running the factory needs none

Date: 2026-11-26 · Status: accepted

## Context

The factory builds its own code: issues in this repo go through it too. Only `npm test` guarded its pull requests, and nothing ran it on GitHub. A linter and a type checker catch mistakes the tests miss (an unused import, a misspelled property passed between modules), but none ships with Node. AGENTS.md rule 2 said "no dependencies" for everything.

## Decision

- Running the factory still needs nothing from npm: no `dependencies` in `package.json`, and `lib/`, `factory.mjs` and `stats.mjs` import only Node's standard library.
- Tools for working on it may be `devDependencies`, pinned to exact versions in `package-lock.json`: Biome (`npm run lint`) and TypeScript (`npm run typecheck`, `checkJs` on the `.mjs` files, not strict).
- A check that stops a pull request must give a plain right or wrong: lint, type check, tests. Measures that need judgement, such as duplication or complexity, are reported, never a gate: an agent would change code only to move the number.
- A gate goes in only when main passes it.
- `package.json`, `package-lock.json`, `biome.json` and `tsconfig.json` are protected: switching off a rule or adding a package is Dennis's change. Setup (`npm ci --ignore-scripts`, with network) does not run on a branch that changes them without his approval.

Considered and not taken: our own scripts for lint and duplication on Node alone (much code for little of what Biome finds), and the formatter (one reformat of every file, against AGENTS.md rule 5).

## Consequences

Each run of this target starts with `npm ci`, a few seconds from the run's own npm cache. A new dev dependency is a reviewed, protected change. Do not add a runtime dependency, and do not make a duplication or complexity number a gate.
