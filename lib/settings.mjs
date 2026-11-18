import { existsSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../config.mjs';

const NAME = /^[a-z0-9][a-z0-9-]*$/;

async function importTarget(file) {
  try {
    const mod = await import(pathToFileURL(file).href);
    return mod.default ?? mod.settings ?? {};
  } catch (e) { throw new Error(`cannot load settings ${file}: ${e.message}`); }
}

// The target names in a targets folder (targets/<name>.mjs), in name order.
export function targetNames(targetsDir) {
  return existsSync(targetsDir)
    ? readdirSync(targetsDir).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4)).sort() : [];
}

// One target per factory: `arg` is a target name (targets/<name>.mjs), a path to
// an .mjs file, or nothing when exactly one target exists. Its fields go on top
// of the shared defaults in config.mjs.
export async function loadSettings(arg, { factoryRoot, targetsDir = join(factoryRoot, 'targets') }) {
  const names = targetNames(targetsDir);
  let file;
  if (arg === undefined) {
    if (!names.length) throw new Error('no targets in targets/');
    if (names.length > 1) throw new Error(`choose a target: ${names.join(', ')} (npm start -- <target>)`);
    file = join(targetsDir, `${names[0]}.mjs`);
  } else if (arg.includes('/') || arg.endsWith('.mjs')) {
    if (arg.endsWith('.mjs') && existsSync(resolve(arg))) file = resolve(arg);
  } else if (NAME.test(arg) && names.includes(arg)) {
    file = join(targetsDir, `${arg}.mjs`);
  }
  if (!file) throw new Error(`unknown target "${arg}". Available: ${names.join(', ') || '(none)'}`);

  const target = basename(file, '.mjs');
  // Your own settings (owner, Node folder, …) in a git-ignored local.mjs: over the shared defaults, under the target.
  const localFile = join(factoryRoot, 'local.mjs');
  const local = existsSync(localFile) ? await importTarget(localFile) : {};
  const cfg = { ...config, ...local, ...(await importTarget(file)), target };
  if (!cfg.repo || !cfg.baseBranch) throw new Error(`target ${target}: repo and baseBranch are required`);
  const skillsDir = join(factoryRoot, 'skills'); // the skills agents may use, loaded as a plugin
  return { ...cfg, runDir: cfg.runDir ?? join(factoryRoot, 'runs', target), ...(existsSync(skillsDir) ? { skillsDir } : {}) };
}

export const cloneUrl = (cfg) => cfg.remoteUrl ?? `https://github.com/${cfg.repo}.git`;
