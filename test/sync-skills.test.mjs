import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SKILLS, latestVersion, rewrite, sync } from '../sync-skills.mjs';

test('latestVersion compares by number', () => {
  assert.equal(latestVersion(['7.0.2', '7.0.10', '7.0.0']), '7.0.10');
  assert.equal(latestVersion([]), null);
  assert.equal(latestVersion(['notes', '7.0.2']), '7.0.2'); // non-versions ignored
});

test('rewrite points vendored skills at the factory plugin only', () => {
  assert.equal(rewrite('use superpowers:test-driven-development'), 'use factory:test-driven-development');
  assert.equal(rewrite('see superpowers:writing-skills'), 'see superpowers:writing-skills');
});

// A plugin cache with two versions; each has the four skills and one we do not take.
function cache() {
  const dir = mkdtempSync(join(tmpdir(), 'factory-skills-cache-'));
  for (const v of ['7.0.0', '7.0.2']) {
    for (const name of [...SKILLS, 'brainstorming']) {
      mkdirSync(join(dir, v, 'skills', name), { recursive: true });
      writeFileSync(join(dir, v, 'skills', name, 'SKILL.md'), `${name} ${v}: see superpowers:test-driven-development\n`);
    }
    writeFileSync(join(dir, v, 'skills', 'systematic-debugging', 'root-cause-tracing.md'), 'trace\n');
  }
  return dir;
}

test('sync copies the four skills with their extra files and records the version', () => {
  const cacheDir = cache(), outDir = mkdtempSync(join(tmpdir(), 'factory-skills-out-'));
  const r = sync({ cacheDir, outDir });
  assert.equal(r.version, '7.0.2');
  assert.deepEqual(r.skills, SKILLS);
  assert.ok(existsSync(join(outDir, 'skills/systematic-debugging/root-cause-tracing.md')));
  assert.ok(!existsSync(join(outDir, 'skills/brainstorming')));
  assert.equal(readFileSync(join(outDir, 'skills/test-driven-development/SKILL.md'), 'utf8'),
    'test-driven-development 7.0.2: see factory:test-driven-development\n');
  const plugin = JSON.parse(readFileSync(join(outDir, '.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(plugin.name, 'factory');
  assert.equal(plugin.version, '7.0.2');
  assert.match(plugin.description, /superpowers 7\.0\.2/);
});

test('sync removes a skill file that upstream dropped', () => {
  const cacheDir = cache(), outDir = mkdtempSync(join(tmpdir(), 'factory-skills-out-'));
  mkdirSync(join(outDir, 'skills', 'test-driven-development'), { recursive: true });
  writeFileSync(join(outDir, 'skills', 'test-driven-development', 'old.md'), 'gone upstream\n');
  sync({ cacheDir, outDir });
  assert.ok(!existsSync(join(outDir, 'skills', 'test-driven-development', 'old.md')));
});

test('sync with no version in the cache says so', () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'factory-skills-empty-'));
  assert.throws(() => sync({ cacheDir, outDir: join(cacheDir, 'out') }), /no superpowers plugin in/);
});
