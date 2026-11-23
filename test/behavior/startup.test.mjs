// What the factory checks before its first poll.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { polls } from './steps.mjs';
import { config } from '../../config.mjs';

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
