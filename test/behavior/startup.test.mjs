// What the factory checks before its first poll.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { world } from './world.mjs';
import { polls } from './steps.mjs';
import { config } from '../../config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const version = () => { try { return execFileSync('git', ['-C', ROOT, 'describe', '--tags', '--always', '--dirty'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } };
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the start line names the factory version', async () => {
  const w = await world();
  try {
    const f = w.start();
    await w.until(() => polls(f) >= 1, 10000, 'a poll');
    assert.match(f.output(), new RegExp(`\\(demo\\) at ${escape(version())} — polling`));
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('startup creates missing labels and warns about drift', async () => {
  const w = await world({ settings: { testDirs: ['test/', 'spec/'] } });
  try {
    const f = w.start();
    await w.until(() => polls(f) >= 1, 10000, 'a poll');
    assert.match(f.output(), /warning: `spec\/` is in targets\/demo\.mjs but not on master/);
    assert.doesNotMatch(f.output(), /warning: `test\/`/);
    const all = [...Object.values(config.triggers), ...Object.values(config.states)];
    assert.deepEqual([...w.state().repoLabels].sort(), all.sort());
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('startup does not warn about a configured path the base branch ignores', async () => {
  const w = await world({ settings: { protectedDirs: ['node_modules/', 'spec/'] } });
  try {
    const f = w.start();
    await w.until(() => polls(f) >= 1, 10000, 'a poll');
    assert.match(f.output(), /warning: `spec\/` is in targets\/demo\.mjs but not on master/);
    assert.doesNotMatch(f.output(), /warning: `node_modules\/`/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('a missing base branch stops the factory', async () => {
  const w = await world({ settings: { baseBranch: 'nope' } });
  try {
    const f = w.start();
    await w.until(() => f.proc.exitCode !== null, 15000, 'the factory to exit');
    assert.equal(await f.exited, 1);
    assert.match(f.output(), /base branch "nope" not found on dennis-brutski\/demo/);
  } finally { w.close(); }
});

test('without an owner the factory does not start', async () => {
  const w = await world({ settings: { owner: null } });
  try {
    const f = w.start();
    await w.until(() => f.proc.exitCode !== null, 15000, 'the factory to exit');
    assert.equal(await f.exited, 1);
    assert.match(f.output(), /factory cannot run: owner is not set: put your GitHub login in local\.mjs/);
    assert.deepEqual(w.state().calls, []); // stopped before any gh call
  } finally { w.close(); }
});
