// The pull request body follows the issue and keeps what others wrote in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, renameSync, openSync, closeSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { world } from './world.mjs';
import { ok, gate, clean, implement, settled, factoryComments, toPullRequest } from './steps.mjs';

// Edits an item's body on the fake GitHub, with the same lock and atomic write as the fake gh.
function setBody(w, n, body) {
  const file = join(w.dir, 'gh.json'), lock = `${file}.lock`, end = Date.now() + 5000;
  for (;;) {
    try { closeSync(openSync(lock, 'wx')); break; } catch (e) {
      if (e.code !== 'EEXIST' || Date.now() > end) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'));
    s.items.find((x) => x.number === n).body = body;
    writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 1)); renameSync(`${file}.tmp`, file);
  } finally { rmSync(lock, { force: true }); }
}

test('an implement re-run puts a Tests that change list added since into the pull request body', async () => {
  const w = await world();
  try {
    const [n, , f] = await toPullRequest(w);
    assert.doesNotMatch(w.pr().body, /## Tests that change/);
    setBody(w, n, 'Do it.\n\n## Tests that change\n\n- `test/a.test.js`: expects 2\n');
    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 3;\n' }, 'Change a again'), clean]);
    w.unlabel(n, 'agent:done');
    await w.until(settled(w, n, 'agent:done'), 20000, 'the second run');
    assert.match(w.pr().body, /Closes #\d+\n\n## Tests that change\n\n- `test\/a\.test\.js`\n\n## What changed/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('a body edited after the poll keeps the edit when the review stage adds test changes', async () => {
  const w = await world();
  try {
    const [n, p, f] = await toPullRequest(w);
    const change = { file: 'test/a.test.js', test: 'a', reason: 'renamed' };
    w.comment(p, 'rename the test');
    w.script(n, [{ session: 'rework', write: { 'test/a.test.js': "import { test } from 'node:test';\ntest('a2', () => {});\n" },
      commit: 'Rename test', output: ok('Renamed'), testChanges: [change], delayMs: 1500 }]);
    w.label(p, 'agent:review');
    await w.until(() => w.claudeCalls().some((c) => c.session === 'rework'), 20000, 'the rework session');
    setBody(w, p, `${w.pr().body}\n\nEdited by Dennis.`);
    await w.until(() => !w.item(p).labels.includes('agent:in-progress') && factoryComments(w, p).length > 0, 20000, 'the rework');
    const body = w.pr().body;
    assert.match(body, /## Tests changed\n\n- `test\/a\.test\.js` · a — renamed\n/);
    assert.match(body, /Edited by Dennis\.$/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
