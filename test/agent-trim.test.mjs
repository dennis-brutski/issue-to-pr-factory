import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArgs } from '../lib/agent.mjs';

const base = { schema: { type: 'object' }, settings: { sandbox: { enabled: true } }, maxTurns: 150, model: null, readOnly: false };

test('buildArgs keeps per-machine details out of the system prompt', () => {
  const a = buildArgs(base);
  assert.ok(a.includes('--exclude-dynamic-system-prompt-sections'));
  assert.equal(a.at(-2), '--disallowedTools');
});

test('buildArgs disallows the tools no stage uses', () =>
  assert.match(buildArgs(base).at(-1), /,ListAgents,ReportFindings$/));

test('runAgent turns off Claude Code\'s memory', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, chmodSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { runAgent } = await import('../lib/agent.mjs');
  const { config } = await import('../config.mjs');
  const bin = mkdtempSync(join(tmpdir(), 'trim-claude-')), dump = join(bin, 'env.json');
  writeFileSync(join(bin, 'claude'), `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(dump)}, JSON.stringify(process.env));
process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({ terminal_reason: 'completed', is_error: false, structured_output: {} })));
`);
  chmodSync(join(bin, 'claude'), 0o755);
  const saved = process.env.PATH;
  process.env.PATH = `${bin}:${saved}`;
  try {
    const r = await runAgent({ cwd: bin, prompt: 'p', schema: { type: 'object' }, cfg: config, port: 4201 });
    assert.equal(r.ok, true, r.reason);
    assert.equal(JSON.parse(readFileSync(dump, 'utf8')).CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
  } finally {
    process.env.PATH = saved;
  }
});
