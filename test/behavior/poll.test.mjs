import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { gate, ok } from './steps.mjs';



// A poll that starts nothing new while a run goes on still says so.
test('a poll during a run logs how many are running', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), { session: 'implement', hang: true, output: ok('x') }]);
    const f = w.start();
    await w.until(() => /\b1 running\b/.test(f.output()), 20000, 'a "1 running" line');
    assert.doesNotMatch(f.output().split('1 running')[0], /0 eligible/); // the run started on the first poll
    f.signal('SIGINT');
    await w.until(() => f.output().includes('Ctrl-C again'), 5000, 'the first Ctrl-C');
    f.signal('SIGINT');
    await f.exited;
  } finally { w.close(); }
});

// A poll that starts runs also says how many are running, so the next check shows right away.
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
