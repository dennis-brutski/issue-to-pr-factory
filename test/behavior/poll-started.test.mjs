// A poll that starts runs also says how many are running, so the next check shows right away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { gate, ok } from './steps.mjs';

test('the poll that starts a run logs how many are running', async () => {
  const w = await world({ settings: { pollSec: 600 } }); // only the first poll happens during the test
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), { session: 'implement', hang: true, output: ok('x') }]);
    const f = w.start();
    await w.until(() => /\b1 running\b/.test(f.output()), 10000, 'a "1 running" line after the first poll');
    assert.ok(f.output().indexOf('implement started') < f.output().indexOf('1 running'));
    f.signal('SIGINT');
    await w.until(() => f.output().includes('Ctrl-C again'), 5000, 'the first Ctrl-C');
    f.signal('SIGINT');
    await f.exited;
  } finally { w.close(); }
});
