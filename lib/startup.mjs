// What the factory checks about its target before the first poll. Pure: no I/O
// except the one existsSync in oldLayoutWarning.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Configured test and protected paths that are not on the base branch: the target
// file has drifted from the project, and a protection silently does nothing.
export function driftWarnings(cfg, exists) {
  const listed = [...(cfg.testDirs ?? []), ...(cfg.protectedFiles ?? []), ...(cfg.protectedDirs ?? [])];
  return listed.filter((p) => !exists(p))
    .map((p) => `\`${p}\` is in targets/${cfg.target}.mjs but not on ${cfg.baseBranch} — update the target file`);
}

export function oldLayoutWarning(factoryRoot) {
  const old = join(factoryRoot, 'repo');
  return existsSync(join(old, '.git')) ? `an old single-target clone is at ${old} — see "Moving to runs/" in the README` : null;
}
