// The existing tests an agent changed, as it reported them, listed in the pull request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { ok, gate, clean, implement, factoryComments, toPullRequest } from './steps.mjs';

const renamed = "import { test } from 'node:test';\ntest('a2', () => {});\n";
const change = { file: 'test/a.test.js', test: 'a', reason: 'the test name changed with the issue' };

test('an implement session that reports a test change lists it in the pull request', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), { ...implement({ 'test/a.test.js': renamed }, 'Rename test'), testChanges: [change] }, clean]);
    const f = w.start();
    await w.until(() => w.item(n).labels.includes('agent:needs-human'), 20000, 'agent:needs-human');
    assert.match(w.pr().body, /## Tests changed\n\n- `test\/a\.test\.js` · a — the test name changed with the issue\n/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('without test changes the pull request has no tests changed section', async () => {
  const w = await world();
  try {
    const [, , f] = await toPullRequest(w);
    assert.doesNotMatch(w.pr().body, /## Tests changed/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('a fix that reports a test change lists it in the pull request', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'),
      { session: 'review', output: { verdict: 'findings', findings: ['rename the test'] } },
      { session: 'fix', write: { 'test/a.test.js': renamed }, commit: 'Rename test', output: ok('Renamed'), testChanges: [change] }]);
    const f = w.start();
    await w.until(() => w.item(n).labels.includes('agent:needs-human'), 20000, 'agent:needs-human');
    assert.match(w.pr().body, /## Tests changed\n\n- `test\/a\.test\.js` · a — the test name changed with the issue\n/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('a rework that reports a test change adds it to the pull request body', async () => {
  const w = await world();
  try {
    const [n, p, f] = await toPullRequest(w);
    w.comment(p, 'rename the test');
    w.script(n, [{ session: 'rework', write: { 'test/a.test.js': renamed }, commit: 'Rename test', output: ok('Renamed'), testChanges: [change] }]);
    w.label(p, 'agent:review');
    await w.until(() => !w.item(p).labels.includes('agent:in-progress') && factoryComments(w, p).length > 0, 20000, 'the rework');
    const body = w.pr().body;
    assert.match(body, /## Tests changed\n\n- `test\/a\.test\.js` · a — the test name changed with the issue\n/);
    assert.match(body, /## What changed/);
    assert.match(body, /## Checks/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
