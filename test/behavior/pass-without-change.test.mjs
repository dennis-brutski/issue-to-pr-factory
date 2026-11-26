// With testFiles set, the branch's new and changed tests also run on the base's code. One that passes there
// says nothing about the change: the pull request notes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { clean, gate, implement, settled } from './steps.mjs';

const testFiles = [['node', ['--test', '{files}']]];
const NOTE = /## Tests that pass without the change\n\n.+\n\n- `test\/b\.test\.js`\n/;
const testOf = (assertion) => `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { a } from '../src/a.js';\ntest('b', () => { ${assertion}; });\n`;

async function run(settings, testFile) {
  const w = await world({ settings });
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n', 'test/b.test.js': testFile }, 'Change a'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:done'), 30000, 'agent:done');
    f.signal('SIGINT'); await f.exited;
    return { body: w.pr().body, draft: w.pr().isDraft };
  } finally { w.close(); }
}

test('a branch adding a test that passes on the base gets the note, and the pull request stays ready', async () => {
  const { body, draft } = await run({ testFiles }, testOf("assert.equal(typeof a, 'number')"));
  assert.match(body, NOTE);
  assert.equal(draft, false);
});

test('a branch adding a test that fails on the base gets no note', async () => {
  const { body } = await run({ testFiles }, testOf('assert.equal(a, 2)'));
  assert.doesNotMatch(body, /Tests that pass without the change/);
});

test('without testFiles the pull request has no such section', async () => {
  const { body } = await run({}, testOf("assert.equal(typeof a, 'number')"));
  assert.doesNotMatch(body, /Tests that pass without the change/);
});
