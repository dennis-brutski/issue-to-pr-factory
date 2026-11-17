// Failing checks, and what happens after the pull request is open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { ok, gate, clean, implement, factoryComments, settled, toPullRequest } from './steps.mjs';

const reworked = (w, p) => () => !w.item(p).labels.includes('agent:review') && !w.item(p).labels.includes('agent:in-progress')
  && factoryComments(w, p).length > 0;

test('failing checks park with the output and push nothing', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    const failing = "import { test } from 'node:test';\nimport assert from 'node:assert';\ntest('b', () => assert.fail('boom'));\n";
    w.script(n, [gate(90), implement({ 'test/b.test.js': failing }, 'Add b'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:needs-human'), 20000, 'agent:needs-human');
    const park = factoryComments(w, n).at(-1).body;
    assert.match(park, /npm test/);
    assert.match(park, /boom/);
    assert.equal(w.branch(`factory/issue-${n}`), null);
    assert.equal(w.pr(), undefined);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('a review comment brings a new commit and an answer', async () => {
  const w = await world();
  try {
    const [n, p, f] = await toPullRequest(w);
    w.comment(p, 'rename a to b', { path: 'src/a.js' });
    w.script(n, [{ session: 'rework', write: { 'src/a.js': 'export const b = 2;\n' }, commit: 'Rename a to b', output: ok('Renamed a') }]);
    w.label(p, 'agent:review');
    await w.until(reworked(w, p), 20000, 'the rework');
    assert.deepEqual(w.branch(`factory/issue-${n}`).subjects, ['Change a', 'Rename a to b']);
    assert.ok(factoryComments(w, p).some((c) => c.body.includes('🏭 **Rework**') && c.body.includes('Renamed a')));
    assert.ok(!w.item(p).labels.includes('agent:needs-human'));
    assert.match(w.claudeCalls().at(-1).prompt, /rename a to b/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('a rework that changes nothing answers without pushing', async () => {
  const w = await world();
  try {
    const [n, p, f] = await toPullRequest(w);
    w.comment(p, 'is this right?');
    w.script(n, [{ session: 'rework', output: ok('Yes, nothing to change') }]);
    w.label(p, 'agent:review');
    await w.until(reworked(w, p), 20000, 'the rework answer');
    assert.deepEqual(w.branch(`factory/issue-${n}`).subjects, ['Change a']);
    assert.ok(factoryComments(w, p).some((c) => c.body.includes('Yes, nothing to change')));
    assert.ok(!w.item(p).labels.includes('agent:needs-human'));
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test("the factory's own comments never reach the agent", async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(5, ['What exactly?'])]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:needs-human'), 20000, 'the park');
    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 3;\n' }, 'Change a'), clean]);
    w.unlabel(n, 'agent:needs-human');
    await w.until(settled(w, n, 'agent:done'), 20000, 'a pull request');
    const gates = w.claudeCalls().filter((c) => c.session === 'gate');
    assert.equal(gates.length, 2);
    assert.doesNotMatch(gates[1].prompt, /Factory stopped/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
