// A test file the issue lists under "## Tests that change" may change without a draft; without the section it is a draft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { gate, clean, implement, settled } from './steps.mjs';

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
