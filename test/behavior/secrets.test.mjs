// An agent's only way out is the pushed branch. A commit that adds a token is never pushed, and the stop comment does not show it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { gate, clean, implement, factoryComments, settled } from './steps.mjs';

test('a commit adding a token is not pushed and the comment does not show it', async () => {
  const token = 'gh' + 'p_' + 'Q'.repeat(36);
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ 'src/a.js': `export const t = '${token}';\n` }, 'Change a'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:needs-human'), 20000, 'agent:needs-human');
    assert.equal(w.branch(`factory/issue-${n}`), null);
    assert.equal(w.pr(), undefined);
    const body = factoryComments(w, n).at(-1).body;
    assert.match(body, /looks like a secret/);
    assert.match(body, /src\/a\.js line 1: looks like a GitHub token/);
    assert.ok(!body.includes(token), body);
    f.signal('SIGINT'); await f.exited;
    assert.ok(!f.output().includes(token));
  } finally { w.close(); }
});
