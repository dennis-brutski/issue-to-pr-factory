// What the factory checks about its target before the first poll. Pure: no I/O.
/** @import { Config } from './settings.mjs' */

// Configured test and protected paths that are not on the base branch: the target
// file has drifted from the project, and a protection silently does nothing.
/**
 * @param {Partial<Pick<Config, 'target' | 'baseBranch' | 'testDirs' | 'protectedFiles' | 'protectedDirs'>>} cfg
 * @param {(path: string) => boolean} exists
 */
export function driftWarnings(cfg, exists) {
  return configuredPaths(cfg).filter((p) => !exists(p))
    .map((p) => `\`${p}\` is in targets/${cfg.target}.mjs but not on ${cfg.baseBranch} — update the target file`);
}

// The test and protected paths the target file names.
/** @param {Partial<Pick<Config, 'testDirs' | 'protectedFiles' | 'protectedDirs'>>} cfg */
export const configuredPaths = (cfg) => [...(cfg.testDirs ?? []), ...(cfg.protectedFiles ?? []), ...(cfg.protectedDirs ?? [])];

/**
 * The warning for a target whose setup has the host's full network (ADR 0008).
 * @param {Partial<Pick<Config, 'target' | 'setup' | 'setupHosts'>>} cfg
 * @returns {string | null} null when setupHosts is a list or there is no setup
 */
export function setupNetworkWarning(cfg) {
  if (Array.isArray(cfg.setupHosts) || !cfg.setup?.length) return null;
  return `setup runs with the full network: set \`setupHosts\` in targets/${cfg.target}.mjs to the hosts it needs (ADR 0008)`;
}

// The polling interval for the start line: "5 min", "30s" or "1m 30s".
export function pollText(sec) {
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60), rest = sec % 60;
  return rest ? `${min}m ${rest}s` : `${min} min`;
}
