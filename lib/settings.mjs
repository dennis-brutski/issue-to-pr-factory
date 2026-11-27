import { existsSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { config } from '../config.mjs';
import { same } from './text.mjs';

const NAME = /^[a-z0-9][a-z0-9-]*$/;

/**
 * The settings a run gets: the defaults in config.mjs, then local.mjs, then the target file,
 * then the local block with --local. Fields whose default is null or [] get their real type here.
 * loadSettings always sets repo, baseBranch and target; they are optional for callers that pass only the defaults.
 * @typedef {Omit<typeof config, 'owner' | 'ownerName' | 'remoteUrl' | 'runDir' | 'heldOutDir' | 'maxBudgetUsd'
 *   | 'protectedFiles' | 'protectedDirs' | 'testDirs' | 'testSupport' | 'turns'> & {
 *   owner: string, ownerName: string | null, remoteUrl: string | null, runDir: string, heldOutDir: string | null,
 *   maxBudgetUsd: number | null, turns: Record<string, number>,
 *   protectedFiles: string[], protectedDirs: string[], testDirs: string[], testSupport: string[],
 *   repo?: string, baseBranch?: string, target?: string,
 *   skillsDir?: string, localRun?: boolean, autoMerge?: boolean, planUsageUrl?: string,
 *   local?: { baseUrl?: string, model?: string, env?: Record<string, string> } & Record<string, unknown>,
 * }} Config
 */

// The factory's arguments: one target (or none) and --local. A misspelt option stops it,
// so it never runs on Claude by mistake.
export function parseFactoryArgs(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: { local: { type: 'boolean', default: false } }, allowPositionals: true, strict: true });
  if (positionals.length > 1) throw new Error('one target at a time');
  return { target: positionals[0], local: values.local };
}

// --local: the local block goes over everything, the target too, since its model names
// mean Claude models. claude finds the local server through the environment.
/** @param {Config} cfg @returns {Config} */
function localSettings(cfg) {
  const { baseUrl, ...block } = cfg.local ?? {};
  if (!baseUrl || !block.model) throw new Error('--local needs a local block with baseUrl and model in local.mjs');
  return {
    ...cfg, gateModel: block.model, simpleModel: block.model, ...block, maxBudgetUsd: null, localRun: true,
    env: { ...cfg.env, ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_AUTH_TOKEN: 'local', // a placeholder; the block's env may set a real key
      ANTHROPIC_DEFAULT_HAIKU_MODEL: block.model, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ...block.env },
  };
}

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

/**
 * The GitHub repo a git remote points at.
 * @param {string} url an https, ssh or scp-style remote
 * @returns {string | null} `owner/name`, or null when it is not a GitHub remote
 */
export function repoOfRemote(url) {
  const m = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(String(url).trim());
  return m ? m[1] : null;
}

// One target per factory: `arg` is a target name (targets/<name>.mjs), a path to
// an .mjs file, or nothing when exactly one target exists. Its fields go on top
// of the shared defaults in config.mjs.
/**
 * Reads local.mjs and one target file over the shared defaults.
 * @param {string | undefined} arg
 * @param {{ factoryRoot: string, targetsDir?: string, local?: boolean }} opts
 * @returns {Promise<Config>} throws when the target is unknown or a required field is missing
 */
export async function loadSettings(arg, { factoryRoot, targetsDir = join(factoryRoot, 'targets'), local: isLocal = false }) {
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
  const merged = { ...config, ...local, ...(await importTarget(file)), target };
  if (!merged.repo || !merged.baseBranch) throw new Error(`target ${target}: repo and baseBranch are required`);
  if (!merged.owner) throw new Error('owner is not set: put your GitHub login in local.mjs (see the README)');
  const cfg = isLocal ? localSettings(merged) : merged;
  const skillsDir = join(factoryRoot, 'skills'); // the skills agents may use, loaded as a plugin
  return { ...cfg, runDir: cfg.runDir ?? join(factoryRoot, 'runs', target), ...(existsSync(skillsDir) ? { skillsDir } : {}) };
}

/**
 * The targets a script works on: every target, one named target, or the one whose repo the folder's origin remote points at.
 * @param {string[]} argv `[]`, `[<target>]` or `['--current']`
 * @param {{ factoryRoot: string, remote: () => Promise<string> }} deps `remote` gives the origin URL; it is called only for --current
 * @returns {Promise<Awaited<ReturnType<typeof loadSettings>>[]>} the targets' settings, in name order
 * @throws when the target is unknown, or --current runs outside a target's folder
 */
export async function chooseTargets(argv, { factoryRoot, remote }) {
  const all = () => Promise.all(targetNames(join(factoryRoot, 'targets')).map((n) => loadSettings(n, { factoryRoot })));
  if (argv[0] === '--current') {
    const url = await remote();
    const repo = repoOfRemote(url);
    const cfg = repo === null ? undefined : (await all()).find((c) => same(c.repo, repo));
    if (!cfg) throw new Error(`this folder is not a target: ${url || '(no origin remote)'}`);
    return [cfg];
  }
  if (argv[0] !== undefined) return [await loadSettings(argv[0], { factoryRoot })];
  return all();
}

/** @param {Pick<Config, 'repo' | 'remoteUrl'>} cfg */
export const cloneUrl = (cfg) => cfg.remoteUrl ?? `https://github.com/${cfg.repo}.git`;
