// An issue that lists others under "## Depends on" starts only once they are closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { gate, clean, implement, settled } from './steps.mjs';

test('an issue that depends on another starts on the poll after that one is closed', async () => {
  const w = await world({ settings: { maxParallel: 2 } });
  try {
    const first = w.issue({ labels: ['agent:implement'] });
    const second = w.issue({ labels: ['agent:implement'], body: `Do it.\n\n## Depends on\n\n- #${first}\n` });
    w.script(first, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), clean]);
    w.script(second, [gate(90), implement({ 'src/b.js': 'export const b = 1;\n' }, 'Add b'), clean]);
    const f = w.start();
    await w.until(settled(w, first, 'agent:done'), 20000, `#${first} to reach agent:done`);
    // Polls go on while the first issue stays open: the second waits, and says so once.
    await w.until(() => f.output().split('0 eligible').length > 3, 10000, 'more polls');
    const lines = (text) => f.output().split('\n').filter((l) => l.includes(`#${second} `) && l.includes(text));
    assert.deepEqual(lines('implement started'), [], f.output());
    assert.equal(lines(`waits for #${first}`).length, 1, f.output());
    w.closeIssue(first);
    await w.until(settled(w, second, 'agent:done'), 20000, `#${second} to reach agent:done`);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
