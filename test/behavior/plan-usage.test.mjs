// After each session the log shows the account's plan usage, read from a fake usage endpoint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { world } from './world.mjs';
import { gate, clean, implement, settled } from './steps.mjs';

test('the session line shows plan usage', async () => {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(req.headers.authorization);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ five_hour: { utilization: 42 }, seven_day: { utilization: 18 } }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const w = await world({ settings: { planUsageUrl: `http://127.0.0.1:${server.address().port}/` } });
  try {
    writeFileSync(join(w.claudeConfig, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'dummy-token' } }));
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:done'), 20000, 'agent:done without agent:in-progress');
    assert.match(f.output(), /gate +· plan 5h 42% · week 18%\n/);
    assert.ok(seen.length >= 1 && seen.every((a) => a === 'Bearer dummy-token'));
    assert.doesNotMatch(f.output(), /dummy-token/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); }
});
