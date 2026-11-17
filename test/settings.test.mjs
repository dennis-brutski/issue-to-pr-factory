import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.mjs';
import { loadSettings, cloneUrl } from '../lib/settings.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'factory-settings-'));
const target = (fields = {}) => `export default ${JSON.stringify({ repo: 'a/b', baseBranch: 'main', ...fields })};\n`;
function root(targets = {}) {
  const r = tmp();
  mkdirSync(join(r, 'targets'));
  for (const [name, text] of Object.entries(targets)) writeFileSync(join(r, 'targets', `${name}.mjs`), text);
  return r;
}

test('a name loads targets/<name>.mjs and sets runs/<name>', async () => {
  const r = root({ one: target() });
  const cfg = await loadSettings('one', { factoryRoot: r });
  assert.equal(cfg.target, 'one');
  assert.equal(cfg.repo, 'a/b');
  assert.equal(cfg.runDir, join(r, 'runs', 'one'));
  assert.deepEqual(cfg.triggers, config.triggers);
});
test('no argument runs the only target', async () => {
  const r = root({ one: target() });
  assert.equal((await loadSettings(undefined, { factoryRoot: r })).target, 'one');
});
test('no argument with two targets lists them', async () => {
  const r = root({ one: target(), two: target() });
  await assert.rejects(loadSettings(undefined, { factoryRoot: r }), /choose a target: one, two/);
});
test('no targets at all', async () => {
  await assert.rejects(loadSettings(undefined, { factoryRoot: root() }), /no targets/);
});
test('an unknown name is refused', async () => {
  const r = root({ one: target() });
  await assert.rejects(loadSettings('nope', { factoryRoot: r }), /unknown target "nope"\. Available: one/);
});
test('a path that is not an .mjs file is refused', async () => {
  const r = root({ one: target() });
  await assert.rejects(loadSettings('../x', { factoryRoot: r }), /unknown target "\.\.\/x"/);
});
test('a target file given by path loads, named after the file', async () => {
  const r = root();
  const file = join(tmp(), 'demo.mjs');
  writeFileSync(file, target({ pollSec: 1, runDir: '/tmp/x' }));
  const cfg = await loadSettings(file, { factoryRoot: r });
  assert.equal(cfg.target, 'demo');
  assert.equal(cfg.pollSec, 1);
  assert.equal(cfg.runDir, '/tmp/x');
});
test('a target without baseBranch is refused', async () => {
  const r = root({ one: "export default { repo: 'a/b' };\n" });
  await assert.rejects(loadSettings('one', { factoryRoot: r }), /target one: repo and baseBranch are required/);
});
test('a broken target names its file', async () => {
  const r = root({ bad: 'export default {\n' });
  await assert.rejects(loadSettings('bad', { factoryRoot: r }), /cannot load settings .*bad\.mjs/);
});
test('cloneUrl defaults to GitHub and honours remoteUrl', () => {
  assert.equal(cloneUrl({ repo: 'a/b', remoteUrl: null }), 'https://github.com/a/b.git');
  assert.equal(cloneUrl({ repo: 'a/b', remoteUrl: '/tmp/o.git' }), '/tmp/o.git');
});
test('the factory target protects its own confinement', async () => {
  const { protectedPathViolations } = await import('../lib/brakes.mjs');
  const cfg = await loadSettings('issue-to-pr-factory', { factoryRoot: join(import.meta.dirname, '..') });
  assert.equal(cfg.baseBranch, 'main');
  const flagged = (path) => protectedPathViolations([{ status: 'M', path }], cfg).length === 1;
  for (const p of ['lib/agent.mjs', 'lib/brakes.mjs', 'lib/checks.mjs', 'lib/confine.mjs', 'lib/eligibility.mjs', 'prompts/_rules.md',
    'config.mjs', 'package.json', 'targets/x.mjs', 'smoke/containment.mjs', 'AGENTS.md', 'test/brakes.test.mjs']) assert.ok(flagged(p), p);
  assert.ok(!flagged('lib/loop.mjs'));
});
