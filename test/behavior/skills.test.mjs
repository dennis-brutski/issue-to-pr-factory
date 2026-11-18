// The factory loads its skills (skills/) into every agent session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { world } from './world.mjs';
import { gate, clean, implement, settled } from './steps.mjs';

const skillsDir = join(import.meta.dirname, '..', '..', 'skills');

test('every agent session gets the skills plugin', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:done'), 20000, 'agent:done without agent:in-progress');
    const calls = w.claudeCalls();
    assert.ok(calls.some((c) => c.session === 'implement'));
    for (const c of calls) assert.equal(c.args[c.args.indexOf('--plugin-dir') + 1], skillsDir, `${c.session} got --plugin-dir`);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
