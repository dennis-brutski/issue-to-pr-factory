// After each poll the check line shows the account's plan usage, read from a fake usage endpoint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { world } from './world.mjs';
import { gate, clean, implement, settled } from './steps.mjs';

test('the check lines show plan usage, the session line does not', async () => {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(req.headers.authorization);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ five_hour: { utilization: 42 }, seven_day: { utilization: 18 } }));
  });
  await /** @type {Promise<void>} */ (new Promise((r) => server.listen(0, '127.0.0.1', r)));
  const w = await world({ settings: { planUsageUrl: `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}/` } });
  try {
    writeFileSync(join(w.claudeConfig, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'dummy-token' } }));
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:done'), 20000, 'agent:done without agent:in-progress');
    await w.until(() => /0 eligible · plan 5h 42% · week 18%\n/.test(f.output()), 20000, 'a 0 eligible line with plan usage');
    assert.match(f.output(), /1 running · plan 5h 42% · week 18%\n/);
    assert.doesNotMatch(f.output(), /gate[^\n]*plan/);
    assert.ok(seen.length >= 1 && seen.every((a) => a === 'Bearer dummy-token'));
    assert.doesNotMatch(f.output(), /dummy-token/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); }
});
