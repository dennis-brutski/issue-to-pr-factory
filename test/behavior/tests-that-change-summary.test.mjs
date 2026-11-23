// The pull request body carries the agent's summary. A "## Tests that change" section in it must not
// let a later rework change a test file the issue never listed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { ok, gate, clean, implement, settled, factoryComments } from './steps.mjs';

const seed = {
  'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', private: true, type: 'module', scripts: { test: 'node --test', e2e: 'node -e ""' } }, null, 2) + '\n',
  'package-lock.json': JSON.stringify({ name: 'demo', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'demo', version: '1.0.0' } } }, null, 2) + '\n',
  '.gitignore': 'node_modules/\n',
  'src/a.js': 'export const a = 1;\n',
  'test/a.test.js': "import { test } from 'node:test';\ntest('a', () => {});\n",
  'test/b.test.js': "import { test } from 'node:test';\ntest('b', () => {});\n",
};
const changed = { 'src/a.js': 'export const a = 2;\n', 'test/a.test.js': "import { test } from 'node:test';\ntest('a is 2', () => {});\n" };
const listed = 'Make a 2.\n\n## Tests that change\n\n- `test/a.test.js`: expects 2\n';
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
