// The factory as a whole program: labelled issues in, pull requests or parks out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { gate, clean, implement, polls, factoryComments, settled } from './steps.mjs';

test('a clear labelled issue becomes a pull request', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:done'), 20000, 'agent:done without agent:in-progress');
    const pr = w.pr();
    assert.match(pr.body, new RegExp(`Closes #${n}`));
    assert.equal(pr.isDraft, false);
    assert.deepEqual(w.branch(`factory/issue-${n}`).subjects, ['Change a']);
    assert.ok(w.claudeCalls().every((c) => c.hadNodeModules), 'setup ran before every agent session');
    assert.ok(factoryComments(w, n).some((c) => c.body.startsWith('🏭 Pull request:')));
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('a vague issue parks once and stays parked', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(5, ['What exactly?'])]);
    let f = w.start();
    await w.until(() => w.item(n).labels.includes('agent:needs-human'), 20000, 'agent:needs-human');
    const park = factoryComments(w, n);
    assert.equal(park.length, 1);
    assert.match(park[0].body, /What exactly\?/);
    assert.match(park[0].body, /confidence 5/);
    const seen = polls(f);
    await w.until(() => polls(f) >= seen + 2, 10000, 'two more polls');
    assert.equal(factoryComments(w, n).length, 1);
    assert.equal(w.claudeCalls().length, 1);
    assert.equal(w.pr(), undefined);
    f.signal('SIGINT'); await f.exited;
    f = w.start();
    await w.until(() => polls(f) >= 1, 10000, 'a poll after restart');
    assert.equal(w.claudeCalls().length, 1);
    assert.equal(factoryComments(w, n).length, 1);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('an issue labelled by someone else is never touched', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'], by: 'mallory' });
    const f = w.start();
    await w.until(() => polls(f) >= 2, 10000, 'two polls');
    assert.equal(w.claudeCalls().length, 0);
    assert.equal(w.item(n).comments.length, 0);
    assert.deepEqual(w.item(n).labels, ['agent:implement']);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('changing an existing test opens a draft with the warning', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ 'test/a.test.js': "import { test } from 'node:test';\ntest('a2', () => {});\n" }, 'Rename test'), clean]);
    const f = w.start();
    await w.until(() => w.item(n).labels.includes('agent:needs-human'), 20000, 'agent:needs-human');
    const pr = w.pr();
    assert.equal(pr.isDraft, true);
    assert.match(pr.body, /existing test changed \(M\): test\/a\.test\.js/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('an issue that contradicts itself parks even with high confidence, listing the contradiction', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [{ session: 'gate', output: { confidence: 90, questions: ['Which holds?'], contradictions: ['Item 1 keeps the list; item 4 changes it'], missing: [] } }]);
    const f = w.start();
    await w.until(() => w.item(n).labels.includes('agent:needs-human'), 20000, 'agent:needs-human');
    const park = factoryComments(w, n);
    assert.equal(park.length, 1);
    assert.match(park[0].body, /not clear enough to build without guessing \(confidence 90 of 100, needs \d+\)\.\n\nContradictions:\n\n- Item 1 keeps the list; item 4 changes it\n\nQuestions:\n\n- Which holds\?/);
    assert.equal(w.claudeCalls().length, 1);
    assert.equal(w.pr(), undefined);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
