import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { config } from '../config.mjs';
import { tick, freePort } from '../lib/loop.mjs';

const issue = (number) => ({
  number, kind: 'issue', title: `Issue ${number}`, body: '', author: 'dennis-brutski', bodyEditedAt: null,
  labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: '2026-11-01T10:00:00Z' }],
  comments: [], headRef: null, headRepo: null,
});
const canBind = (port) => new Promise((resolve) => {
  const s = createServer();
  s.once('error', () => resolve(false));
  s.listen(port, () => s.close(() => resolve(true)));
});

test('freePort returns a port that can be bound', async () => {
  const port = await freePort();
  assert.ok(Number.isInteger(port) && port > 0, `port ${port}`);
  assert.ok(await canBind(port), `port ${port} is not free`);
});
test('runs whose slots differ by 500 get different free ports in the same tick', async () => {
  const started = [];
  const deps = {
    cfg: { ...config, maxParallel: 2 }, log: () => {},
    gh: { listCandidates: async () => [issue(3), issue(503)] },
    runItem: async (item, stage, d, port) => { started.push({ n: item.number, port, free: await canBind(port) }); return { outcome: 'done' }; },
  };
  const running = new Map();
  assert.deepEqual(await tick(deps, running), [3, 503]);
  await Promise.all(running.values());
  const [a, b] = started;
  assert.ok(a.port && b.port && a.port !== b.port, `ports ${a.port} and ${b.port}`);
  assert.ok(a.free && b.free, 'each port can be bound');
});
