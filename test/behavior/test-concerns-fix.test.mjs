// Test concerns stay draft reasons through a fix and never reach the fix session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { gate, implement, ok } from './steps.mjs';

const findings = (testConcerns) => ({ session: 'review', output: { verdict: 'findings', findings: ['src/a.js: a is wrong'] }, testConcerns });
const cleanWith = (testConcerns) => ({ session: 'review', output: { verdict: 'clean', findings: [] }, testConcerns });
const fix = { session: 'fix', write: { 'src/a.js': 'export const a = 3;\n' }, commit: 'Fix a', output: ok('Fixed a') };

test('a concern from a review with findings is kept from the fix session and keeps the pull request a draft', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    const concern = 'test/a.test.js: early return in test a';
    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), findings([concern]), fix]);
    const f = w.start();
    await w.until(() => w.item(n).labels.includes('agent:needs-human'), 20000, 'agent:needs-human');
    const fixes = w.claudeCalls().filter((c) => c.session === 'fix');
    assert.equal(fixes.length, 1);
    assert.match(fixes[0].prompt, /src\/a\.js: a is wrong/);
    assert.doesNotMatch(fixes[0].prompt, /early return in test a/);
    const pr = w.pr();
    assert.equal(pr.isDraft, true);
    assert.ok(pr.body.includes(concern));
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('with autoMerge on, a concern from the review after the fix makes a draft that names it', async () => {
  const w = await world({ settings: { autoMerge: true } });
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    const concern = 'test/a.test.js: expected value widened in test a';
    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), findings([]), fix, cleanWith([concern])]);
    const f = w.start();
    await w.until(() => w.item(n).labels.includes('agent:needs-human'), 20000, 'agent:needs-human');
    assert.equal(w.claudeCalls().filter((c) => c.session === 'review').length, 2);
    const pr = w.pr();
    assert.equal(pr.isDraft, true);
    assert.ok(pr.body.includes(concern));
    assert.notEqual(pr.autoMerge, 'squash');
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
