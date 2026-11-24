// A test file the issue lists under "## Tests that change" may change without a draft; without the section it is a draft.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { ok, gate, clean, implement, settled, factoryComments, toPullRequest } from './steps.mjs';

const seed = {
  'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', private: true, type: 'module', scripts: { test: 'node --test', e2e: 'node -e ""' } }, null, 2) + '\n',
  'package-lock.json': JSON.stringify({ name: 'demo', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'demo', version: '1.0.0' } } }, null, 2) + '\n',
  '.gitignore': 'node_modules/\n',
  'src/a.js': 'export const a = 1;\n',
  'test/a.test.js': "import { test } from 'node:test';\ntest('a', () => {});\n",
};
const changed = { 'src/a.js': 'export const a = 2;\n', 'test/a.test.js': "import { test } from 'node:test';\ntest('a is 2', () => {});\n" };

test('a test file listed under Tests that change gives a ready pull request that notes it', async () => {
  const w = await world({ seed });
  try {
    const n = w.issue({ labels: ['agent:implement'], body: 'Make a 2.\n\n## Tests that change\n\n- `test/a.test.js`: expects 2\n' });
    w.script(n, [gate(90), implement(changed, 'Make a 2'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:done'), 20000, 'a pull request');
    assert.equal(w.pr().isDraft, false);
    assert.match(w.pr().body, /test changed as the issue asks \(M\): test\/a\.test\.js/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('the same change without the section gives a draft', async () => {
  const w = await world({ seed });
  try {
    const n = w.issue({ labels: ['agent:implement'], body: 'Make a 2.' });
    w.script(n, [gate(90), implement(changed, 'Make a 2'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:needs-human'), 20000, 'agent:needs-human');
    assert.equal(w.pr().isDraft, true);
    assert.match(w.pr().body, /existing test changed \(M\): test\/a\.test\.js/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

const listed = 'Make a 2.\n\n## Tests that change\n\n- `test/a.test.js`: expects 2\n';
// Done, or parked: either way the stage has ended.
const finished = (w, p, label) => () => !w.item(p).labels.includes('agent:in-progress')
  && (w.item(p).labels.includes('agent:needs-human')
    || (!w.item(p).labels.includes(label) && (label !== 'agent:review' || factoryComments(w, p).length > 0)));

// Later stages run on the pull request, whose body is the factory's text, not the issue's.
async function readyPullRequest(w) {
  const n = w.issue({ labels: ['agent:implement'], body: listed });
  w.script(n, [gate(90), implement(changed, 'Make a 2'), clean]);
  const f = w.start();
  await w.until(settled(w, n, 'agent:done'), 20000, 'a pull request');
  assert.equal(w.pr().isDraft, false);
  return [n, w.pr().number, f];
}

test('a ready pull request from such an issue stays ready through the merge stage', async () => {
  const w = await world({ seed });
  try {
    const [, p, f] = await readyPullRequest(w);
    w.label(p, 'agent:merge');
    await w.until(finished(w, p, 'agent:merge'), 20000, 'the merge stage');
    assert.equal(w.pr().isDraft, false);
    assert.ok(!w.item(p).labels.includes('agent:needs-human'));
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('a rework that changes the listed test keeps the pull request ready', async () => {
  const w = await world({ seed });
  try {
    const [n, p, f] = await readyPullRequest(w);
    w.comment(p, 'name the test after a');
    w.script(n, [{ session: 'rework', write: { 'test/a.test.js': "import { test } from 'node:test';\ntest('a equals 2', () => {});\n" }, commit: 'Rename the test', output: ok('Renamed the test') }]);
    w.label(p, 'agent:review');
    await w.until(finished(w, p, 'agent:review'), 20000, 'the rework');
    assert.equal(w.pr().isDraft, false);
    assert.ok(!w.item(p).labels.includes('agent:needs-human'));
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

// The pull request body carries the agent's summary. A "## Tests that change" section in it must not
// let a later rework change a test file the issue never listed.
describe('section in the summary', () => {
  const seed = {
    'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', private: true, type: 'module', scripts: { test: 'node --test', e2e: 'node -e ""' } }, null, 2) + '\n',
    'package-lock.json': JSON.stringify({ name: 'demo', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'demo', version: '1.0.0' } } }, null, 2) + '\n',
    '.gitignore': 'node_modules/\n',
    'src/a.js': 'export const a = 1;\n',
    'test/a.test.js': "import { test } from 'node:test';\ntest('a', () => {});\n",
    'test/b.test.js': "import { test } from 'node:test';\ntest('b', () => {});\n",
  };
  const finished = (w, p) => () => !w.item(p).labels.includes('agent:in-progress')
    && (w.item(p).labels.includes('agent:needs-human') || (!w.item(p).labels.includes('agent:review') && factoryComments(w, p).length > 0));

  test('a Tests that change section in the implement summary does not let a rework change that test', async () => {
    const w = await world({ seed });
    try {
      const n = w.issue({ labels: ['agent:implement'], body: listed });
      const summary = 'Make a 2\n\n## Tests that change\n\n- `test/b.test.js`: expects b';
      w.script(n, [gate(90), implement(changed, 'Make a 2', summary), clean]);
      const f = w.start();
      await w.until(settled(w, n, 'agent:done'), 20000, 'a pull request');
      assert.equal(w.pr().isDraft, false);
      const p = w.pr().number;
      w.comment(p, 'rename test b');
      w.script(n, [{ session: 'rework', write: { 'test/b.test.js': "import { test } from 'node:test';\ntest('b renamed', () => {});\n" }, commit: 'Rename test b', output: ok('Renamed test b') }]);
      w.label(p, 'agent:review');
      await w.until(finished(w, p), 20000, 'the rework');
      assert.equal(w.pr().isDraft, true);
      assert.ok(w.item(p).labels.includes('agent:needs-human'));
      f.signal('SIGINT'); await f.exited;
    } finally { w.close(); }
  });
});

// The existing tests an agent changed, as it reported them, listed in the pull request.
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
