import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../config.mjs';

// The defaults in config.mjs, with an optional settings file's fields on top.
export async function loadSettings(arg, { factoryRoot }) {
  let overrides = {};
  if (arg) {
    const file = resolve(arg);
    try {
      const mod = await import(pathToFileURL(file).href);
      overrides = mod.default ?? mod.settings ?? {};
    } catch (e) { throw new Error(`cannot load settings ${file}: ${e.message}`); }
  }
  const cfg = { ...config, ...overrides };
  return { ...cfg, runDir: cfg.runDir ?? factoryRoot };
}

export const cloneUrl = (cfg) => cfg.remoteUrl ?? `https://github.com/${cfg.repo}.git`;
