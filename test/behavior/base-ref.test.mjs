// The brakes measure the branch against the base commit on GitHub. A session
// that moves the clone's origin ref must not make a workflow change invisible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { gate, clean, implement, factoryComments, settled } from './steps.mjs';

test('a session that moves the base ref to its head still cannot push a workflow change', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), { ...implement({ '.github/workflows/ci.yml': 'on: push\n' }, 'Add CI'), git: [['update-ref', 'refs/remotes/origin/master', 'HEAD']] }, clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:needs-human'), 20000, 'agent:needs-human');
    assert.equal(w.branch(`factory/issue-${n}`), null);
    assert.equal(w.pr(), undefined);
    assert.match(factoryComments(w, n).at(-1).body, /\.github\/workflows\/ci\.yml/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
