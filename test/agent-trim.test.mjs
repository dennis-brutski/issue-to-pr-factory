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
