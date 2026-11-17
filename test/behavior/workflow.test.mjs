// A CI workflow written by an agent must never reach GitHub unread.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { gate, clean, implement, factoryComments, settled } from './steps.mjs';

test('a workflow change is never pushed', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ '.github/workflows/ci.yml': 'on: push\n' }, 'Add CI'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:needs-human'), 20000, 'agent:needs-human');
    assert.equal(w.branch(`factory/issue-${n}`), null);
    assert.equal(w.pr(), undefined);
    assert.match(factoryComments(w, n).at(-1).body, /\.github\/workflows\/ci\.yml/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('another .github change is pushed as a draft', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ '.github/CODEOWNERS': '* @someone\n' }, 'Add owners'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:needs-human'), 20000, 'agent:needs-human');
    assert.equal(w.pr().isDraft, true);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
