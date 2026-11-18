#!/usr/bin/env node
// Copy the skills the factory's agents use from the local superpowers plugin into skills/.
// Run: npm run sync-skills, then read `git diff skills/` before committing:
// a skill update changes what unattended agents are told.
import { readdirSync, existsSync, rmSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Only skills that work without asking a person, subagents, git push or gh.
export const SKILLS = ['test-driven-development', 'verification-before-completion', 'systematic-debugging', 'receiving-code-review'];

const VERSION = /^\d+\.\d+\.\d+$/;
const parts = (v) => v.split('.').map(Number);

// The highest x.y.z, compared by number (7.0.10 is newer than 7.0.2). Pure.
export function latestVersion(names) {
  const versions = names.filter((n) => VERSION.test(n));
  if (!versions.length) return null;
  return versions.sort((a, b) => {
    const [x, y] = [parts(a), parts(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  }).at(-1);
}

// References to a skill we copy point at our plugin; others are left as they are. Pure.
export const rewrite = (text) =>
  text.replace(/superpowers:([a-z-]+)/g, (all, name) => (SKILLS.includes(name) ? `factory:${name}` : all));

function rewriteMarkdown(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) rewriteMarkdown(p);
    else if (e.name.endsWith('.md')) writeFileSync(p, rewrite(readFileSync(p, 'utf8')));
  }
}

export function sync({ cacheDir, outDir }) {
  const version = existsSync(cacheDir) ? latestVersion(readdirSync(cacheDir)) : null;
  if (!version) throw new Error(`no superpowers plugin in ${cacheDir}`);
  rmSync(join(outDir, 'skills'), { recursive: true, force: true }); // drops files upstream removed
  for (const name of SKILLS) {
    const to = join(outDir, 'skills', name);
    cpSync(join(cacheDir, version, 'skills', name), to, { recursive: true });
    rewriteMarkdown(to);
  }
  mkdirSync(join(outDir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(outDir, '.claude-plugin', 'plugin.json'), `${JSON.stringify({
    name: 'factory', version,
    description: `Skills for the factory's agents, copied from superpowers ${version} by sync-skills.mjs. Do not edit here.`,
  }, null, 2)}\n`);
  return { version, skills: [...SKILLS] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cacheDir = join(homedir(), '.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers');
  try {
    const r = sync({ cacheDir, outDir: join(dirname(fileURLToPath(import.meta.url)), 'skills') });
    console.log(`copied ${r.skills.length} skills from superpowers ${r.version}; read git diff skills/ before committing`);
  } catch (e) { console.error(`sync-skills cannot run: ${e.message}`); process.exitCode = 1; }
}
