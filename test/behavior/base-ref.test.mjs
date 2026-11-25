// The brakes measure the branch against the base commit on GitHub. A session
// that moves the clone's origin ref must not make a workflow change invisible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

test('the review diffs against the base commit on GitHub even when the clone\'s origin ref was moved', async () => {
  const w = await world();
  try {
    const base = execFileSync('git', ['-C', w.origin, 'rev-parse', 'master'], { encoding: 'utf8' }).trim();
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), { ...implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), git: [['update-ref', 'refs/remotes/origin/master', 'HEAD']] }, clean]);
    const f = w.start();
    await w.until(() => w.claudeCalls().some((c) => c.session === 'review'), 20000, 'review session');
    const review = w.claudeCalls().find((c) => c.session === 'review');
    assert.ok(review.prompt.includes(`git diff ${base}...HEAD`), review.prompt);
    assert.doesNotMatch(review.prompt, /origin\//);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
