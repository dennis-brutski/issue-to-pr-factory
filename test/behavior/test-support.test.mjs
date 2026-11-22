// Extending a fake (lines only added) opens a ready pull request with a note; removing a line there makes a draft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { gate, clean, implement, settled } from './steps.mjs';

const FAKE = 'export const a = 1;\n';
const seed = {
  'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', private: true, type: 'module', scripts: { test: 'node --test', e2e: 'node -e ""' } }, null, 2) + '\n',
  'package-lock.json': JSON.stringify({ name: 'demo', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'demo', version: '1.0.0' } } }, null, 2) + '\n',
  '.gitignore': 'node_modules/\n',
  'src/a.js': 'export const a = 1;\n',
  'test/a.test.js': "import { test } from 'node:test';\ntest('a', () => {});\n",
  'test/fakes/gh.mjs': FAKE,
};
const settings = { testSupport: ['test/fakes/'] };

test('lines added to a fake give a ready pull request that notes it', async () => {
  const w = await world({ seed, settings });
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ 'test/fakes/gh.mjs': `${FAKE}export const b = 2;\n` }, 'Teach the fake b'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:done'), 20000, 'a pull request');
    assert.equal(w.pr().isDraft, false);
    assert.match(w.pr().body, /test support extended, lines only added: test\/fakes\/gh\.mjs/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('a line removed from a fake gives a draft', async () => {
  const w = await world({ seed, settings });
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ 'test/fakes/gh.mjs': 'export const a = 2;\n' }, 'Change the fake'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:needs-human'), 20000, 'agent:needs-human');
    assert.equal(w.pr().isDraft, true);
    assert.match(w.pr().body, /existing test changed \(M\): test\/fakes\/gh\.mjs/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
