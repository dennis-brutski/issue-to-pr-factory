// Test concerns from the review make the pull request a draft that names them, also through a fix; a clean review does not.
// They never reach the fix session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { world } from './world.mjs';
import { gate, implement, ok, settled } from './steps.mjs';

const review = (testConcerns) => ({ session: 'review', output: { verdict: 'clean', findings: [] }, testConcerns });
const findings = (testConcerns) => ({ session: 'review', output: { verdict: 'findings', findings: ['src/a.js: a is wrong'] }, testConcerns });
const fix = { session: 'fix', write: { 'src/a.js': 'export const a = 3;\n' }, commit: 'Fix a', output: ok('Fixed a') };

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

test('a concern from a review with findings is kept from the fix session and keeps the pull request a draft', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    const concern = 'test/a.test.js: early return in test a';
    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), findings([concern]), fix, review([])]);
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
  // Auto-merge needs held-out checks; these pass, kept outside the world's run folder, so the draft is what keeps it from auto-merge.
  const held = mkdtempSync(join(tmpdir(), 'factory-held-out-'));
  writeFileSync(join(held, 'ok.test.mjs'), "import { test } from 'node:test';\ntest('held out', () => {});\n");
  const w = await world({ settings: { autoMerge: true, heldOutDir: held, heldOutChecks: [['node', ['--test', '{heldOut}/ok.test.mjs']]] } });
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    const concern = 'test/a.test.js: expected value widened in test a';
    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), findings([]), fix, review([concern])]);
    const f = w.start();
    await w.until(() => w.item(n).labels.includes('agent:needs-human'), 20000, 'agent:needs-human');
    assert.equal(w.claudeCalls().filter((c) => c.session === 'review').length, 2);
    const pr = w.pr();
    assert.equal(pr.isDraft, true);
    assert.ok(pr.body.includes(concern));
    assert.notEqual(pr.autoMerge, 'squash');
    assert.deepEqual(w.state().calls.filter((c) => c[0] === 'pr' && c[1] === 'merge'), []);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); rmSync(held, { recursive: true, force: true }); }
});
