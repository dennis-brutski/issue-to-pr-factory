// A retry after a park is told why the last run stopped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { gate, clean, implement, settled } from './steps.mjs';

test('after a red check park and a retry, the implement prompt carries the check output', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    const failing = "import { test } from 'node:test';\nimport assert from 'node:assert';\ntest('b', () => assert.fail('RED-BOOM'));\n";
    w.script(n, [gate(90), implement({ 'test/b.test.js': failing }, 'Add b'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:needs-human'), 20000, 'agent:needs-human');
    w.script(n, [gate(90), implement({ 'test/b.test.js': "import { test } from 'node:test';\ntest('b', () => {});\n" }, 'Fix b'), clean]);
    w.unlabel(n, 'agent:needs-human');
    await w.until(settled(w, n, 'agent:done'), 20000, 'a pull request');
    const runs = w.claudeCalls().filter((c) => c.session === 'implement');
    assert.equal(runs.length, 2);
    assert.doesNotMatch(runs[0].prompt, /Why the last run stopped/);
    assert.match(runs[1].prompt, /## Why the last run stopped/);
    assert.match(runs[1].prompt, /RED-BOOM/);
    assert.doesNotMatch(w.claudeCalls().filter((c) => c.session === 'gate')[1].prompt, /RED-BOOM/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

// The last push is the factory's own newest comment, not a commit date a session can set.
const FAILING = "import { test } from 'node:test';\nimport assert from 'node:assert';\ntest('b', () => assert.fail('RED-BOOM'));\n";
const PASSING = "import { test } from 'node:test';\ntest('b', () => {});\n";

test('a session that dates its commit in the future does not hide the last stop', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), { ...implement({ 'test/b.test.js': FAILING }, 'Add b'), committerDate: '2099-01-01T00:00:00Z' }, clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:needs-human'), 20000, 'agent:needs-human');
    w.script(n, [gate(90), implement({ 'test/b.test.js': PASSING }, 'Fix b'), clean]);
    w.unlabel(n, 'agent:needs-human');
    await w.until(settled(w, n, 'agent:done'), 20000, 'a pull request');
    const runs = w.claudeCalls().filter((c) => c.session === 'implement');
    assert.match(runs[1].prompt, /## Why the last run stopped/);
    assert.match(runs[1].prompt, /RED-BOOM/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('a session that dates its commit in the past does not bring an older stop back', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ 'test/b.test.js': FAILING }, 'Add b'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:needs-human'), 20000, 'agent:needs-human');
    w.script(n, [gate(90), { ...implement({ 'test/b.test.js': PASSING }, 'Fix b'), committerDate: '2000-01-01T00:00:00Z' }, clean]);
    w.unlabel(n, 'agent:needs-human');
    await w.until(settled(w, n, 'agent:done'), 20000, 'a pull request');
    w.script(n, [gate(90), { session: 'implement', output: { status: 'complete', summary: 'Nothing more', detail: '' } }, clean]);
    w.unlabel(n, 'agent:done');
    w.label(n, 'agent:implement');
    await w.until(() => w.claudeCalls().filter((c) => c.session === 'implement').length === 3 && settled(w, n, 'agent:done')(), 20000, 'the third implement');
    const runs = w.claudeCalls().filter((c) => c.session === 'implement');
    assert.match(runs[1].prompt, /RED-BOOM/);
    assert.doesNotMatch(runs[2].prompt, /Why the last run stopped/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
