import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.mjs';
import { loadSettings, cloneUrl } from '../lib/settings.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'factory-settings-'));

test('loadSettings without an argument returns the defaults with runDir = factoryRoot', async () => {
  const cfg = await loadSettings(undefined, { factoryRoot: '/f' });
  assert.equal(cfg.repo, config.repo);
  assert.equal(cfg.runDir, '/f');
});
test('a settings file overrides single fields', async () => {
  const file = join(tmp(), 's.mjs');
  writeFileSync(file, "export default { pollSec: 1, runDir: '/tmp/x' };\n");
  const cfg = await loadSettings(file, { factoryRoot: '/f' });
  assert.equal(cfg.pollSec, 1);
  assert.equal(cfg.runDir, '/tmp/x');
  assert.deepEqual(cfg.triggers, config.triggers);
});
test('a broken settings file names the file', async () => {
  const file = join(tmp(), 's.mjs');
  writeFileSync(file, 'export default {\n');
  await assert.rejects(loadSettings(file, { factoryRoot: '/f' }), /cannot load settings .*s\.mjs/);
});
test('cloneUrl defaults to GitHub and honours remoteUrl', () => {
  assert.equal(cloneUrl({ repo: 'a/b', remoteUrl: null }), 'https://github.com/a/b.git');
  assert.equal(cloneUrl({ repo: 'a/b', remoteUrl: '/tmp/o.git' }), '/tmp/o.git');
});
