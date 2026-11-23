// Terminal lines about a pull request carry its issue's number, so one piece of work shows under one number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { ok, gate, clean, implement, factoryComments } from './steps.mjs';

test('lines about a factory pull request are tagged with its issue', async () => {
  const w = await world();
  try {
    for (let i = 1; i < 7; i++) w.issue(); // unlabelled, so issue 7 is the one that runs
    const n = w.issue({ labels: ['agent:implement'] });
    assert.equal(n, 7);
    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), clean,
      { session: 'rework', output: ok('Nothing to change') }]);
    const f = w.start();
    await w.until(() => w.pr() && w.item(n).labels.includes('agent:done'), 20000, 'a pull request');
    const p = w.pr().number;
    assert.notEqual(p, n);
    w.comment(p, 'is this right?');
    w.label(p, 'agent:review');
    await w.until(() => !w.item(p).labels.includes('agent:review') && !w.item(p).labels.includes('agent:in-progress')
      && factoryComments(w, p).length > 0, 20000, 'the review');
    await w.until(() => /review (done|parked)/.test(f.output()), 5000, 'the review outcome line');
    const out = f.output();
    assert.doesNotMatch(out, new RegExp(`#${p}\\s+│`));
    assert.match(out, new RegExp(`#${n}\\s+│ ▶ review started on PR #${p}\\b`));
    assert.match(out, new RegExp(`#${n}\\s+│ .*rework.*started`));
    assert.match(out, new RegExp(`#${n}\\s+│ . review (done|parked) in \\d+s · 1 session`));
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
