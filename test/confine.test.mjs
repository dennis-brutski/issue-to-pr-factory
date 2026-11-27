import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, existsSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { run } from '../lib/exec.mjs';
import { bwrapArgs, targetEnv, expandHome } from '../lib/confine.mjs';
import { runChecks, runSetup } from '../lib/checks.mjs';
import { runConfined } from '../lib/confine.mjs';
import { config } from '../config.mjs';
import scorePad from './fixtures/web-app-target.mjs';
/** @import { Config } from '../lib/settings.mjs' */
import { tempDir } from './fakes/tmp.mjs';

const pairs = (args, flag) => args.flatMap((a, i) => (a === flag ? [[args[i + 1], args[i + 2]]] : []));

test('expandHome expands ~ and leaves other paths alone', () => {
  assert.equal(expandHome('~/.npm', '/h'), '/h/.npm');
  assert.equal(expandHome('~', '/h'), '/h');
  assert.equal(expandHome('/opt/x', '/h'), '/opt/x');
});
test('checks get no network and write only to the worktree', () => {
  const a = bwrapArgs({ dir: '/w', gitDir: '/c/.git', home: '/h', network: false, read: [], write: [] });
  assert.ok(a.includes('--unshare-net'));
  assert.deepEqual(pairs(a, '--bind'), [['/w', '/w']]);
  assert.deepEqual(a.slice(0, 2), ['--ro-bind', '/']);
  assert.ok(a.indexOf('--tmpfs') < a.indexOf('--bind'), 'home is hidden before the worktree is bound');
  assert.deepEqual(pairs(a, '--ro-bind').slice(-1), [['/c/.git', '/c/.git']]);
  assert.deepEqual(a.slice(-2), ['--chdir', '/w']);
});
test('setup gets the network and its write caches, home-expanded', () => {
  const home = tempDir('home-');
  const a = bwrapArgs({ dir: '/w', home, network: true, read: [], write: ['~/.npm'] });
  assert.ok(!a.includes('--unshare-net'));
  assert.deepEqual(pairs(a, '--bind'), [['/w', '/w'], [join(home, '.npm'), join(home, '.npm')]]);
  assert.ok(existsSync(join(home, '.npm')), 'write folders are created first');
});
test('read folders are bound read-only, missing ones skipped', () => {
  const home = tempDir('home-');
  mkdirSync(join(home, '.nvm'));
  const a = bwrapArgs({ dir: '/w', home, network: false, read: ['~/.nvm', '~/.missing'], write: [] });
  assert.deepEqual(pairs(a, '--ro-bind').map(([src]) => src), ['/', join(home, '.nvm')]);
});
test('targetEnv sets CI and fills {port} in every value', () => {
  const cfg = { env: { E2E_PORT: '{port}', URL: 'http://localhost:{port}/', KEEP: 'x' } };
  assert.deepEqual(targetEnv(cfg, 4201), { CI: '1', E2E_PORT: '4201', URL: 'http://localhost:4201/', KEEP: 'x' });
  assert.notEqual(targetEnv(cfg, 4201).E2E_PORT, targetEnv(cfg, 4202).E2E_PORT);
});

// Real bwrap, from outside: what an install script or a test can and cannot do.
const bwrapWorks = (await run('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-net', 'true'])).code === 0;
const real = { skip: bwrapWorks ? false : 'bwrap probe failed on this machine' };
const net = "require('net').connect(443, '1.1.1.1').on('connect', () => process.exit(0)).on('error', () => process.exit(3))";
// Setup's network can only be shown where there is one: not in the factory's own check run, which has none.
const online = (await run('node', ['-e', net], { timeoutMs: 5000 })).code === 0;

test('confined checks cannot read home, write outside the worktree or reach the network', real, async () => {
  const id = randomBytes(4).toString('hex');
  const canary = join(homedir(), '.cache', `factory-canary-${id}`), outside = join(homedir(), `factory-escape-${id}`);
  mkdirSync(join(homedir(), '.cache'), { recursive: true });
  writeFileSync(canary, 'canary');
  const dir = tempDir('confine-');
  const cfg = (checks) => ({ ...config, checks });
  try {
    assert.equal((await runChecks(dir, cfg([['cat', [canary]]]), 4201)).ok, false, 'read a file in home');
    await runChecks(dir, cfg([['sh', ['-c', `echo x > ${outside}`]]]), 4201);
    assert.ok(!existsSync(outside), 'wrote outside the worktree');
    assert.equal((await runChecks(dir, cfg([['node', ['-e', net]]]), 4201)).ok, false, 'reached the network');
    assert.equal((await runChecks(dir, cfg([['sh', ['-c', 'echo ok > inside.txt']]]), 4201)).ok, true);
    assert.ok(existsSync(join(dir, 'inside.txt')), 'can write in the worktree');
    if (online) assert.equal((await runSetup(dir, { ...config, setup: [['node', ['-e', net]]] }, 4201)).ok, true, 'setup reaches the network');
    assert.equal((await runSetup(dir, { ...config, setup: [['cat', [canary]]] }, 4201)).ok, false, 'setup read a file in home');
  } finally { rmSync(canary, { force: true }); rmSync(outside, { force: true }); }
});
test('a missing check program reports which one', real, async () => {
  const dir = tempDir('confine-');
  const r = await runChecks(dir, { ...config, checks: [['definitely-missing-cmd', ['x']]] }, 4201);
  assert.equal(r.ok, false);
  assert.equal(r.failed, 'definitely-missing-cmd x');
  assert.match(r.output, /No such file|not found|ENOENT/);
});
test('confined checks can commit with the git identity agents get', real, async () => {
  const dir = tempDir('confine-');
  // A project's tests that make commits do so in repos of their own (the worktree's git data is read-only).
  const r = await runChecks(dir, { ...config, checks: [['sh', ['-c', 'git init -q sub && git -C sub commit -q --allow-empty -m x']]] }, 4201);
  assert.equal(r.ok, true, r.output);
});

test('confined runs reach no user session: no agent sockets, no /run/user, no stray environment', real, async () => {
  const dir = tempDir('confine-');
  process.env.FACTORY_SENTINEL_SECRET = 'leak';
  try {
    const probe = 'test -z "$SSH_AUTH_SOCK" && test -z "$DBUS_SESSION_BUS_ADDRESS" && test -z "$FACTORY_SENTINEL_SECRET" && ! ls -A /run/user/$(id -u) 2>/dev/null | grep -q .';
    for (const run of [runChecks, runSetup]) {
      const key = run === runChecks ? 'checks' : 'setup';
      const r = await run(dir, { ...config, [key]: [['sh', ['-c', probe]]] }, 4201);
      assert.equal(r.ok, true, `${key}: ${r.output}`);
    }
  } finally { delete process.env.FACTORY_SENTINEL_SECRET; }
});
test('confined runs keep PATH, HOME, the target env and the git identity', real, async () => {
  const dir = tempDir('confine-');
  const cfg = { ...config, env: { MY_VAR: 'x{port}' }, checks: [['sh', ['-c', 'test "$MY_VAR" = x4201 && test "$CI" = 1 && test -n "$HOME" && command -v node >/dev/null && test -n "$GIT_AUTHOR_NAME"']]] };
  const r = await runChecks(dir, cfg, 4201);
  assert.equal(r.ok, true, r.output);
});
test('setup can still resolve host names', { skip: real.skip || (online ? false : 'no network on this machine') }, async () => {
  const dir = tempDir('confine-');
  const r = await runSetup(dir, { ...config, setup: [['node', ['-e', "require('dns').lookup('registry.npmjs.org', (e) => process.exit(e ? 3 : 0))"]]] }, 4201);
  assert.equal(r.ok, true, r.output);
});
test('no process outlives a confined run', real, async () => {
  const dir = tempDir('confine-');
  const r = await runChecks(dir, { ...config, checks: [['sh', ['-c', 'setsid sh -c "sleep 2; touch late-write" > /dev/null 2>&1 &']]] }, 4201);
  assert.equal(r.ok, true, r.output);
  await new Promise((res) => setTimeout(res, 3000));
  assert.ok(!existsSync(join(dir, 'late-write')), 'a process kept running after the check');
});
test("the worktree's .git file is read-only for confined runs", real, async () => {
  const dir = tempDir('confine-');
  writeFileSync(join(dir, '.git'), 'gitdir: /somewhere\n');
  const r = await runChecks(dir, { ...config, checks: [['sh', ['-c', 'echo "gitdir: ./.x" > .git']]] }, 4201);
  assert.equal(r.ok, false);
  assert.equal(readFileSync(join(dir, '.git'), 'utf8'), 'gitdir: /somewhere\n');
});
test('targetEnv fills {runDir} too', () => {
  assert.equal(targetEnv({ runDir: '/r', env: { npm_config_cache: '{runDir}/npm-cache' } }, 1).npm_config_cache, '/r/npm-cache');
});
test("setup writes the run folder's cache, never the real home cache", real, async () => {
  const runDir = tempDir('run-'), dir = tempDir('confine-');
  const id = randomBytes(4).toString('hex'), real = join(homedir(), '.npm', `factory-probe-${id}`);
  const cfg = { ...config, runDir, setupWrite: ['{runDir}/npm-cache'], setup: [['sh', ['-c', `touch {runDir}/npm-cache/ok; mkdir -p "$HOME/.npm" && touch "$HOME/.npm/factory-probe-${id}"`.replaceAll('{runDir}', runDir)]]] };
  try {
    const r = await runSetup(dir, cfg, 4201);
    assert.equal(r.ok, true, r.output);
    assert.ok(existsSync(join(runDir, 'npm-cache', 'ok')));
    assert.ok(!existsSync(real), 'setup wrote the real ~/.npm');
  } finally { rmSync(real, { force: true }); }
});
test('without a readable ~/.gitconfig the git identity comes from the environment', async () => {
  // Inside an agent's sandbox the home folder is hidden; the outer factory passed the identity in.
  const home = tempDir('home-');
  const code = "const { gitIdentityEnv } = await import(process.argv[1]); console.log(JSON.stringify(await gitIdentityEnv()));";
  const r = await run(process.execPath, ['--input-type=module', '-e', code, new URL('../lib/confine.mjs', import.meta.url).href], {
    env: { HOME: home, GIT_CONFIG_GLOBAL: join(home, 'missing'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Agent Name', GIT_AUTHOR_EMAIL: 'agent@example.invalid' },
  });
  assert.deepEqual(JSON.parse(r.stdout), { GIT_AUTHOR_NAME: 'Agent Name', GIT_AUTHOR_EMAIL: 'agent@example.invalid', GIT_COMMITTER_NAME: 'Agent Name', GIT_COMMITTER_EMAIL: 'agent@example.invalid' }, r.stderr);
});

// A worktree lives under the home folder, which bwrap hides. Nothing from the home folder
// may be bound at or under the worktree, or `git status` there would show home dotfiles.
const binds = (args) => args.flatMap((a, i) => (a === '--bind' || a === '--ro-bind' ? [[args[i + 1], args[i + 2]]] : []));
const under = (p, dir) => p === dir || p.startsWith(dir + sep);

test('no home path is bound at or under a worktree that lives in the home folder', () => {
  const home = tempDir('home-');
  for (const f of ['.bashrc', '.profile']) writeFileSync(join(home, f), '');
  for (const d of ['.claude', '.idea', '.cache/ms-playwright']) mkdirSync(join(home, d), { recursive: true });
  const runDir = join(home, 'git', 'factory', 'runs', 'demo');
  const dir = join(runDir, 'worktrees', 'issue-1'), gitDir = join(runDir, 'repo', '.git');
  mkdirSync(dir, { recursive: true }); mkdirSync(gitDir, { recursive: true });
  writeFileSync(join(dir, '.git'), `gitdir: ${gitDir}/worktrees/issue-1\n`);
  const fill = (w) => w.replaceAll('{runDir}', runDir);
  const a = bwrapArgs({
    dir, gitDir, home, network: true,
    read: [...scorePad.sandboxRead, '~/.claude'], write: [...scorePad.setupWrite.map(fill), '~/.npm'], env: {},
  });
  const own = new Set([dir, join(dir, '.git')]); // the worktree itself and its .git link
  const inside = binds(a).filter(([, dest]) => under(dest, dir) && !own.has(dest));
  assert.deepEqual(inside, []);
  for (const [src, dest] of binds(a).filter(([, d]) => own.has(d))) assert.equal(src, dest);
  assert.ok(a.indexOf('--tmpfs') < a.indexOf(dir), 'home is hidden before the worktree is bound');
  assert.deepEqual(a.slice(-2), ['--chdir', dir]);
});

test('without ~/.gitconfig or identity variables the git identity is empty', async () => {
  const home = tempDir('home-');
  const code = "const { gitIdentityEnv } = await import(process.argv[1]); console.log(JSON.stringify(await gitIdentityEnv()));";
  const r = await run(process.execPath, ['--input-type=module', '-e', code, new URL('../lib/confine.mjs', import.meta.url).href], {
    env: { PATH: process.env.PATH, HOME: home, GIT_CONFIG_GLOBAL: join(home, 'missing'), GIT_CONFIG_NOSYSTEM: '1' }, inheritEnv: false,
  });
  assert.deepEqual(JSON.parse(r.stdout), { GIT_AUTHOR_NAME: '', GIT_AUTHOR_EMAIL: '', GIT_COMMITTER_NAME: '', GIT_COMMITTER_EMAIL: '' }, r.stderr);
});
test('targetEnv without env sets only CI', () => {
  assert.deepEqual(targetEnv({}, 4201), { CI: '1' });
});
test('a target without env, runtimeRead or sandboxRead still runs confined', real, async () => {
  const dir = tempDir('confine-');
  const r = await runChecks(dir, { checkTimeoutMin: 1, checks: [['sh', ['-c', 'test "$CI" = 1 && test -n "$PATH" && echo ran']]] }, 4201);
  assert.deepEqual(r, { ok: true, failed: null, output: '' });
});
test('a target without setup, checks or held-out checks runs no steps and succeeds', async () => {
  // A missing folder: any step that ran would fail to start there.
  const dir = join(tmpdir(), `confine-missing-${randomBytes(4).toString('hex')}`);
  assert.deepEqual(await runSetup(dir, {}, 4201), { ok: true, failed: null, output: '' });
  assert.deepEqual(await runChecks(dir, {}, 4201), { ok: true, failed: null, output: '' });
});
test('a target without runtimeRead or sandboxRead builds its read list without throwing', async () => {
  // Spreading a missing list throws before bwrap starts; whether bwrap itself works here does not matter.
  const dir = tempDir('confine-');
  const r = await runConfined('true', [], { dir, cfg: /** @type {Config} */ ({}), port: 4201, network: false, timeoutMs: 10_000 });
  assert.deepEqual(Object.keys(r).sort(), ['code', 'stderr', 'stdout', 'timedOut']);
});
