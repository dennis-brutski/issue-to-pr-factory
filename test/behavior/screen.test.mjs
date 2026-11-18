// What the factory prints for a run: issue prefix, no "session started" lines, a run summary at the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { gate, clean, implement, settled } from './steps.mjs';

test('a run is shown with the issue prefix and a summary', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:done'), 20000, 'agent:done without agent:in-progress');
    await w.until(() => /done in /.test(f.output()), 10000, 'the done line');
    const out = f.output();
    assert.match(out, new RegExp(`#${n} +│ ▶ implement started`));
    assert.doesNotMatch(out, /session started/);
    assert.match(out, new RegExp(`#${n} +│ ✔ implement done in \\d+s · \\d+ sessions?.*: https://`));
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
