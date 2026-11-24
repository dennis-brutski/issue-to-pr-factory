import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.mjs';
import { loadSettings, cloneUrl, parseFactoryArgs, targetNames } from '../lib/settings.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'factory-settings-'));
const target = (fields = {}) => `export default ${JSON.stringify({ repo: 'a/b', baseBranch: 'main', ...fields })};\n`;
function root(targets = {}, local = "export default { owner: 'alex' };\n") {
  const r = tmp();
  mkdirSync(join(r, 'targets'));
  if (local) writeFileSync(join(r, 'local.mjs'), local);
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
  const cfg = await loadSettings('factory-target', { factoryRoot: root(), targetsDir: join(import.meta.dirname, 'fixtures') });
  assert.equal(cfg.baseBranch, 'main');
  const flagged = (path) => protectedPathViolations([{ status: 'M', path }], cfg).length === 1;
  for (const p of ['lib/agent.mjs', 'lib/brakes.mjs', 'lib/checks.mjs', 'lib/confine.mjs', 'lib/eligibility.mjs', 'prompts/_rules.md',
    'config.mjs', 'package.json', 'targets/x.mjs', 'smoke/containment.mjs', 'AGENTS.md', 'test/brakes.test.mjs']) assert.ok(flagged(p), p);
  assert.ok(!flagged('lib/loop.mjs'));
});
test("the web app's setup caches live in its run folder, not in ~/.npm", async () => {
  const cfg = await loadSettings('web-app-target', { factoryRoot: root(), targetsDir: join(import.meta.dirname, 'fixtures') });
  assert.deepEqual(cfg.setupWrite, ['{runDir}/npm-cache']);
  assert.equal(cfg.env.npm_config_cache, '{runDir}/npm-cache');
});
test('local.mjs holds your own settings: over the defaults, under the target', async () => {
  const r = root({ one: target({ maxParallel: 1 }) });
  writeFileSync(join(r, 'local.mjs'), "export default { owner: 'alex', ownerName: 'Alex', maxParallel: 3, pollSec: 60 };\n");
  const cfg = await loadSettings('one', { factoryRoot: r });
  assert.deepEqual([cfg.owner, cfg.ownerName, cfg.pollSec, cfg.maxParallel], ['alex', 'Alex', 60, 1]);
});
test('without an owner in local.mjs or the target the factory does not start', async () => {
  await assert.rejects(loadSettings('one', { factoryRoot: root({ one: target() }, null) }), /owner is not set.*local\.mjs/);
  const cfg = await loadSettings('one', { factoryRoot: root({ one: target({ owner: 'sam' }) }, null) });
  assert.deepEqual([cfg.owner, cfg.ownerName], ['sam', config.ownerName]);
});

test('skillsDir is set only when <factory>/skills exists', async () => {
  const r = root({ one: target() });
  assert.equal((await loadSettings('one', { factoryRoot: r })).skillsDir, undefined);
  mkdirSync(join(r, 'skills'));
  assert.equal((await loadSettings('one', { factoryRoot: r })).skillsDir, join(r, 'skills'));
});

test('parseFactoryArgs: target and --local in either order', () => {
  assert.deepEqual(parseFactoryArgs(['demo', '--local']), { target: 'demo', local: true });
  assert.deepEqual(parseFactoryArgs(['--local', 'demo']), { target: 'demo', local: true });
  assert.deepEqual(parseFactoryArgs(['--local']), { target: undefined, local: true });
  assert.deepEqual(parseFactoryArgs([]), { target: undefined, local: false });
});
test('parseFactoryArgs refuses two targets', () => {
  assert.throws(() => parseFactoryArgs(['one', 'two']), { message: 'one target at a time' });
});
test('parseFactoryArgs refuses an unknown option', () => {
  assert.throws(() => parseFactoryArgs(['demo', '--locl']), /locl/);
});
test('--local lays the local block over the target, with the server in env', async () => {
  const r = root({ one: target({ model: 'opus', maxParallel: 3, env: { npm_config_cache: 'x' } }) });
  writeFileSync(join(r, 'local.mjs'), "export default { owner: 'alex', maxBudgetUsd: 5, local: { baseUrl: 'http://localhost:11434', model: 'qwen', maxParallel: 1 } };\n");
  const cfg = await loadSettings('one', { factoryRoot: r, local: true });
  assert.deepEqual([cfg.model, cfg.gateModel, cfg.simpleModel, cfg.maxParallel, cfg.maxBudgetUsd], ['qwen', 'qwen', 'qwen', 1, null]);
  assert.deepEqual(cfg.env, { npm_config_cache: 'x', ANTHROPIC_BASE_URL: 'http://localhost:11434', ANTHROPIC_AUTH_TOKEN: 'local',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qwen', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' });
});
test('--local keeps gateModel and simpleModel the block names', async () => {
  const r = root({ one: target({ local: { baseUrl: 'http://h', model: 'big', gateModel: 'small', simpleModel: 'mid' } }) });
  const cfg = await loadSettings('one', { factoryRoot: r, local: true });
  assert.deepEqual([cfg.model, cfg.gateModel, cfg.simpleModel], ['big', 'small', 'mid']);
});
test('--local without a usable local block stops', async () => {
  for (const local of [undefined, { model: 'qwen' }, { baseUrl: 'http://h' }]) {
    const r = root({ one: target(local ? { local } : {}) });
    await assert.rejects(loadSettings('one', { factoryRoot: r, local: true }), /--local needs a local block with baseUrl and model in local\.mjs/);
  }
});
test('a local block without --local changes nothing', async () => {
  const r = root({ one: target({ local: { baseUrl: 'http://h', model: 'qwen' } }) });
  const cfg = await loadSettings('one', { factoryRoot: r });
  assert.deepEqual([cfg.model, cfg.maxBudgetUsd, cfg.env], [config.model, config.maxBudgetUsd, config.env]);
});
test('npm run start:local passes --local itself: npm drops a bare --local from npm start', () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['start:local'], 'node factory.mjs --local');
});
test("--local: the block's own env wins, for a server that needs a real key", async () => {
  const r = root({ one: target({ local: { baseUrl: 'http://h', model: 'qwen', env: { ANTHROPIC_AUTH_TOKEN: 'sk-proxy' } } }) });
  const cfg = await loadSettings('one', { factoryRoot: r, local: true });
  assert.equal(cfg.env.ANTHROPIC_AUTH_TOKEN, 'sk-proxy');
  assert.equal(cfg.env.ANTHROPIC_BASE_URL, 'http://h');
});
test('--local marks the settings as a local run; without it they are not', async () => {
  const r = root({ one: target({ local: { baseUrl: 'http://h', model: 'qwen' } }) });
  assert.equal((await loadSettings('one', { factoryRoot: r, local: true })).localRun, true);
  assert.equal((await loadSettings('one', { factoryRoot: r })).localRun, undefined);
});

test('targetNames lists targets/*.mjs by name, in name order', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'factory-names-')), 'targets');
  mkdirSync(dir);
  for (const f of ['two.mjs', 'one.mjs', 'notes.txt']) writeFileSync(join(dir, f), '');
  assert.deepEqual(targetNames(dir), ['one', 'two']);
});
test('targetNames of a missing folder is empty', () => {
  assert.deepEqual(targetNames(join(mkdtempSync(join(tmpdir(), 'factory-names-')), 'targets')), []);
});
