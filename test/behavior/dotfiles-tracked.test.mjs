// A target that tracks .vscode/ may get new files there; the dotfile guard only stops folders the base lacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { gate, clean, implement, settled } from './steps.mjs';

const seed = {
  'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', private: true, type: 'module', scripts: { test: 'node --test', e2e: 'node -e ""' } }, null, 2) + '\n',
  'package-lock.json': JSON.stringify({ name: 'demo', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'demo', version: '1.0.0' } } }, null, 2) + '\n',
  '.gitignore': 'node_modules/\n',
  '.vscode/settings.json': '{}\n',
  'src/a.js': 'export const a = 1;\n',
  'test/a.test.js': "import { test } from 'node:test';\ntest('a', () => {});\n",
};

test('a commit adding .vscode/extensions.json is pushed when the base tracks .vscode/', async () => {
  const w = await world({ seed });
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ '.vscode/extensions.json': '{"recommendations":[]}\n' }, 'Recommend extensions'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:done'), 20000, 'a pull request');
    assert.equal(w.pr().isDraft, false);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
