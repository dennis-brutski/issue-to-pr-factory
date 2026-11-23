// What the factory checks about its target before the first poll. Pure: no I/O.

// Configured test and protected paths that are not on the base branch: the target
// file has drifted from the project, and a protection silently does nothing.
export function driftWarnings(cfg, exists) {
  return configuredPaths(cfg).filter((p) => !exists(p))
    .map((p) => `\`${p}\` is in targets/${cfg.target}.mjs but not on ${cfg.baseBranch} — update the target file`);
}

// The test and protected paths the target file names.
export const configuredPaths = (cfg) => [...(cfg.testDirs ?? []), ...(cfg.protectedFiles ?? []), ...(cfg.protectedDirs ?? [])];

// The polling interval for the start line: "5 min", "30s" or "1m 30s".
export function pollText(sec) {
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60), rest = sec % 60;
  return rest ? `${min}m ${rest}s` : `${min} min`;
}
