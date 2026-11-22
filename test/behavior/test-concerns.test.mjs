// Test concerns from the review make the pull request a draft that names them; a clean review does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { gate, implement, settled } from './steps.mjs';

const review = (testConcerns) => ({ session: 'review', output: { verdict: 'clean', findings: [] }, testConcerns });

test('a review with a test concern gives a draft that names it', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), review(['test/a.test.js: early return in test a'])]);
    const f = w.start();
    await w.until(() => w.item(n).labels.includes('agent:needs-human'), 20000, 'agent:needs-human');
    const pr = w.pr();
    assert.equal(pr.isDraft, true);
    assert.match(pr.body, /test\/a\.test\.js: early return in test a/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('a clean review with no test concerns gives a ready pull request', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), review([])]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:done'), 20000, 'agent:done');
    assert.equal(w.pr().isDraft, false);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
