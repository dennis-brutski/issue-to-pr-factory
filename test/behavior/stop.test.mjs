// Ctrl-C stops the factory promptly, even in the middle of a poll.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';

test('Ctrl-C during a poll stops at once, without waiting out pollSec', async () => {
  const w = await world({ settings: { pollSec: 60 } });
  try {
    w.slowLists(1000); // the first poll's list call is still running when Ctrl-C comes
    const f = w.start();
    await w.until(() => f.output().includes('factory started'), 20000, 'the start');
    const sent = Date.now();
    f.signal('SIGINT');
    const code = await Promise.race([f.exited, new Promise((r) => setTimeout(() => r('still running'), 10000))]);
    assert.equal(code, 0, f.output());
    assert.ok(Date.now() - sent < 10000);
    assert.match(f.output(), /stopped/);
  } finally { w.close(); }
});
