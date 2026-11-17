// A long backlog of waiting issues must not hide a newer one.
import { test } from 'node:test';
import { world } from './world.mjs';
import { gate, clean, implement, settled } from './steps.mjs';

test('an issue behind more than 50 labelled open issues is started', async () => {
  const w = await world();
  try {
    for (let k = 0; k < 55; k++) w.issue({ labels: ['agent:implement', k % 2 ? 'agent:done' : 'agent:needs-human'] });
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:done'), 20000, `#${n} to reach agent:done`);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
