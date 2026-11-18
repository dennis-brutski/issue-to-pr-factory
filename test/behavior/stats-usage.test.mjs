// node stats.mjs <target> reads the session logs in the target's run folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../lib/exec.mjs';
import { world, FAKES_BIN } from './world.mjs';

const STATS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'stats.mjs');

const stats = (w, args = []) => {
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  return run(process.execPath, [STATS, w.settingsFile, ...args], { env: { ...env, PATH: `${FAKES_BIN}:${env.PATH}`, FAKE_GH_STATE: join(w.dir, 'gh.json') }, timeoutMs: 20000 });
};

test('stats says when there are no session logs yet', async () => {
  const w = await world();
  try {
    const r = await stats(w);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /\nagent use: no session logs yet\n/);
  } finally { w.close(); }
});

test('stats prints agent use from the session logs, and --since applies to them', async () => {
  const w = await world();
  try {
    const dir = join(w.runDir, 'logs', 'issue-4');
    mkdirSync(dir, { recursive: true });
    const at = Date.parse('2026-11-10T10:00:00Z');
    const json = JSON.stringify({ num_turns: 12, usage: { input_tokens: 1000, cache_read_input_tokens: 3000, output_tokens: 2500 }, total_cost_usd: 1.5, permission_denials: [{}], terminal_reason: 'max_turns' });
    writeFileSync(join(dir, `${at}-1-implement.json`), `${json}\n--- stderr ---\n`);
    writeFileSync(join(dir, `${at + 1}-2-review.json`), 'Killed\n--- stderr ---\n');
    const r = await stats(w);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /\nagent use \(from session logs; ≈ cost is an estimate at API list price, not your bill\)\n/);
    assert.match(r.stdout, /\n {2}implement +1 +12 +4k \(75%\) +2\.5k +\$1\.50\n/);
    assert.match(r.stdout, /\n {2}most used: #4 ≈ \$1\.50\n/);
    assert.match(r.stdout, /\n {2}stopped early: 1 max_turns · 1 unreadable \(timed out or crashed\)\n/);
    assert.match(r.stdout, /\n {2}tool calls refused: 1\n/);
    const later = await stats(w, ['--since', '2026-11-11']);
    assert.match(later.stdout, /\nagent use: no sessions since 2026-11-11\n/);
  } finally { w.close(); }
});
