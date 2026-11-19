// An implement session that leaves HEAD detached on its work still ends in a pull request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { gate, clean, implement, settled } from './steps.mjs';

test('a session that detaches HEAD on top of its branch still opens the pull request', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), { ...implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), git: [['checkout', '-q', '--detach']] }, clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:done'), 20000, 'a pull request');
    assert.match(f.output(), new RegExp(`#${n} +│ HEAD was detached; moved factory/issue-${n} to [0-9a-f]{7}`));
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
