import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePlan, planUsage } from '../lib/plan.mjs';

const body = { five_hour: { utilization: 41.6, resets_at: '2026-11-24T14:30:00Z' }, seven_day: { utilization: 18, resets_at: '2026-11-28T09:00:00Z' } };

test('parsePlan reads both windows', () => {
  assert.deepEqual(parsePlan(body), { fiveHour: 42, fiveHourResetsAt: Date.parse('2026-11-24T14:30:00Z'), week: 18 });
});

test('parsePlan keeps what is there', () => {
  assert.deepEqual(parsePlan({ five_hour: { utilization: 42 } }), { fiveHour: 42 });
  assert.deepEqual(parsePlan({ five_hour: { utilization: 42, resets_at: 'not a date' }, seven_day: { utilization: null } }), { fiveHour: 42 });
  assert.deepEqual(parsePlan({ five_hour: null, seven_day: { utilization: 18 } }), { week: 18 });
});

test('parsePlan gives null for nothing useful', () => {
  assert.equal(parsePlan({}), null);
  assert.equal(parsePlan(null), null);
  assert.equal(parsePlan([]), null);
  assert.equal(parsePlan({ five_hour: { utilization: null }, seven_day: { utilization: 'x' } }), null);
});

// A local server that records each request's headers and answers with `answer(req, res)`.
async function server(answer) {
  const seen = [];
  const s = createServer((req, res) => { seen.push(req.headers); answer(req, res); });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${s.address().port}/api/oauth/usage`;
  return { url, seen, close: () => { s.closeAllConnections(); return new Promise((r) => s.close(r)); } };
}
const json = (code, value) => (req, res) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
function configDir(token) {
  const dir = mkdtempSync(join(tmpdir(), 'plan-'));
  if (token) writeFileSync(join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: token } }));
  return dir;
}

test('planUsage asks with the login token', async () => {
  const s = await server(json(200, body)), dir = configDir('tok');
  try {
    assert.deepEqual(await planUsage({ configDir: dir, url: s.url }), parsePlan(body));
    assert.equal(s.seen.length, 1);
    assert.equal(s.seen[0].authorization, 'Bearer tok');
    assert.equal(s.seen[0]['anthropic-beta'], 'oauth-2025-04-20');
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('planUsage gives null without a token file', async () => {
  const s = await server(json(200, body)), dir = configDir(null);
  try {
    assert.equal(await planUsage({ configDir: dir, url: s.url }), null);
    assert.equal(s.seen.length, 0);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('planUsage gives null on a non-OK answer', async () => {
  const s = await server(json(401, { error: 'expired' })), dir = configDir('tok');
  try {
    assert.equal(await planUsage({ configDir: dir, url: s.url }), null);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('planUsage gives null when the server is slow', async () => {
  const s = await server(() => {}), dir = configDir('tok');
  try {
    const t = Date.now();
    assert.equal(await planUsage({ configDir: dir, url: s.url, timeoutMs: 100 }), null);
    assert.ok(Date.now() - t < 1000, `took ${Date.now() - t} ms`);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('planUsage gives null when the access token is not a non-empty string', async () => {
  const s = await server(json(200, body));
  try {
    for (const accessToken of ['', 42, null]) {
      const dir = mkdtempSync(join(tmpdir(), 'plan-'));
      try {
        writeFileSync(join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken } }));
        assert.equal(await planUsage({ configDir: dir, url: s.url }), null);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
    assert.equal(s.seen.length, 0);
  } finally { await s.close(); }
});
