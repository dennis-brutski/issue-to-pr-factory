// After explore, the owner's "build step 1" refers to the write-up, so gate and implement are given it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { gate, clean, implement, settled } from './steps.mjs';

test('gate and implement get the explore write-up the owner refers to', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:explore'] });
    const writeup = 'Step 1: change a to 2. Step 2: WRITEUP-STEP-TWO.';
    w.script(n, [{ session: 'explore', output: { writeup, easy_to_undo: false, small_reach: true } }]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:needs-human'), 20000, 'the explore write-up');
    assert.ok(w.item(n).comments.some((c) => c.body.startsWith('🏭 **Factory explore write-up**') && c.body.includes(writeup)));
    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), clean]);
    w.comment(n, 'build step 1');
    w.unlabel(n, 'agent:explore');
    w.unlabel(n, 'agent:needs-human');
    w.label(n, 'agent:implement');
    await w.until(settled(w, n, 'agent:done'), 20000, 'a pull request');
    for (const session of ['gate', 'implement']) {
      const prompt = w.claudeCalls().find((c) => c.session === session).prompt;
      assert.ok(prompt.includes(`### The factory's explore write-up\n\n${writeup}`), session);
      assert.match(prompt, /- build step 1/, session);
    }
    assert.doesNotMatch(w.claudeCalls().find((c) => c.session === 'review').prompt, /WRITEUP-STEP-TWO/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
