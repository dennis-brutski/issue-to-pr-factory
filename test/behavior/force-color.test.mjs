// A terminal's `node --test` sets FORCE_COLOR in test files; the factory under test must not get it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { gate, clean, implement, settled } from './steps.mjs';

test('the factory started by a test prints no colour codes even when FORCE_COLOR is set', async () => {
  const before = process.env.FORCE_COLOR;
  process.env.FORCE_COLOR = '1';
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:done'), 20000, 'agent:done without agent:in-progress');
    await w.until(() => /done in /.test(f.output()), 10000, 'the done line');
    assert.doesNotMatch(f.output(), /\x1b\[/);
    f.signal('SIGINT'); await f.exited;
  } finally {
    w.close();
    if (before === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = before;
  }
});
