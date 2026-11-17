import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { run } from '../lib/exec.mjs';
import { bwrapArgs, targetEnv, expandHome } from '../lib/confine.mjs';
import { runChecks, runSetup } from '../lib/checks.mjs';
import { config } from '../config.mjs';

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
  const home = mkdtempSync(join(tmpdir(), 'home-'));
  const a = bwrapArgs({ dir: '/w', home, network: true, read: [], write: ['~/.npm'] });
  assert.ok(!a.includes('--unshare-net'));
  assert.deepEqual(pairs(a, '--bind'), [['/w', '/w'], [join(home, '.npm'), join(home, '.npm')]]);
  assert.ok(existsSync(join(home, '.npm')), 'write folders are created first');
});
test('read folders are bound read-only, missing ones skipped', () => {
  const home = mkdtempSync(join(tmpdir(), 'home-'));
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

test('confined checks cannot read home, write outside the worktree or reach the network', real, async () => {
  const id = randomBytes(4).toString('hex');
  const canary = join(homedir(), '.cache', `factory-canary-${id}`), escape = join(homedir(), `factory-escape-${id}`);
  mkdirSync(join(homedir(), '.cache'), { recursive: true });
  writeFileSync(canary, 'canary');
  const dir = mkdtempSync(join(tmpdir(), 'confine-'));
  const cfg = (checks) => ({ ...config, checks });
  try {
    assert.equal((await runChecks(dir, cfg([['cat', [canary]]]), 4201)).ok, false, 'read a file in home');
    await runChecks(dir, cfg([['sh', ['-c', `echo x > ${escape}`]]]), 4201);
    assert.ok(!existsSync(escape), 'wrote outside the worktree');
    assert.equal((await runChecks(dir, cfg([['node', ['-e', net]]]), 4201)).ok, false, 'reached the network');
    assert.equal((await runChecks(dir, cfg([['sh', ['-c', 'echo ok > inside.txt']]]), 4201)).ok, true);
    assert.ok(existsSync(join(dir, 'inside.txt')), 'can write in the worktree');
    assert.equal((await runSetup(dir, { ...config, setup: [['node', ['-e', net]]] }, 4201)).ok, true, 'setup reaches the network');
    assert.equal((await runSetup(dir, { ...config, setup: [['cat', [canary]]] }, 4201)).ok, false, 'setup read a file in home');
  } finally { rmSync(canary, { force: true }); rmSync(escape, { force: true }); }
});
test('a missing check program reports which one', real, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'confine-'));
  const r = await runChecks(dir, { ...config, checks: [['definitely-missing-cmd', ['x']]] }, 4201);
  assert.equal(r.ok, false);
  assert.equal(r.failed, 'definitely-missing-cmd x');
  assert.match(r.output, /No such file|not found|ENOENT/);
});
test('confined checks can commit with the git identity agents get', real, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'confine-'));
  await run('git', ['init', '-q', dir]);
  const r = await runChecks(dir, { ...config, checks: [['git', ['commit', '-q', '--allow-empty', '-m', 'x']]] }, 4201, join(dir, '.git'));
  assert.equal(r.ok, true, r.output);
});
