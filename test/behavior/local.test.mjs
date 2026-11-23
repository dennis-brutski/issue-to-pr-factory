// --local: every agent session goes to a local model behind an Anthropic-compatible server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { gate } from './steps.mjs';

test('--local sends every session to the local server and model', async () => {
  const w = await world({ settings: { local: { baseUrl: 'http://127.0.0.1:9', model: 'local-model' } } });
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(5, ['What exactly?'])]);
    const f = w.start(['--local']);
    await w.until(() => w.item(n).labels.includes('agent:needs-human'), 20000, 'agent:needs-human');
    assert.match(f.output(), /factory started for dennis-brutski\/demo \(demo, local: local-model\)/);
    const [call] = w.claudeCalls();
    assert.equal(call.anthropicBaseUrl, 'http://127.0.0.1:9');
    assert.equal(call.args[call.args.indexOf('--model') + 1], 'local-model');
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('an unknown option stops the factory', async () => {
  const w = await world();
  try {
    const f = w.start(['--locl']);
    await w.until(() => f.proc.exitCode !== null, 15000, 'the factory to exit');
    assert.equal(await f.exited, 1);
    assert.match(f.output(), /factory cannot run: .*locl/);
  } finally { w.close(); }
});

test('--local shows "local" for a session, not a cost, and says when the server gave no counts', async () => {
  const w = await world({ settings: { local: { baseUrl: 'http://127.0.0.1:9', model: 'local-model' } } });
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    const zero = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
    w.script(n, [{ ...gate(5, ['What exactly?']), result: { num_turns: 2, total_cost_usd: 0, usage: zero } }]);
    const f = w.start(['--local']);
    await w.until(() => w.item(n).labels.includes('agent:needs-human'), 20000, 'agent:needs-human');
    assert.match(f.output(), /gate +· 2 turns · local, no token counts\n/);
    assert.doesNotMatch(f.output(), /≈ \$/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
