import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArgs, interpret, agentSettings } from '../lib/agent.mjs';
import { config } from '../config.mjs';
import scorePad from './fixtures/web-app-target.mjs';
import { stopLabel } from '../stats.mjs';
import { stopped } from '../lib/comments.mjs';

const base = { schema: { type: 'object' }, settings: { sandbox: { enabled: true } }, maxTurns: 150, model: null, readOnly: false };
const result = (o = {}) => ({
  code: o.is_error ? 1 : 0, timedOut: false, stderr: '',
  stdout: JSON.stringify({ type: 'result', is_error: false, terminal_reason: 'completed', session_id: 's1', result: 'done', structured_output: { status: 'complete' }, ...o }),
});

test('buildArgs never contains a permission bypass', () => {
  const a = buildArgs(base).join(' ');
  assert.ok(!/bypassPermissions|dangerously/.test(a));
  assert.ok(a.includes('--permission-mode dontAsk') && a.includes('--permission-prompts none'));
});
test('buildArgs carries schema, settings, turn cap and no user settings', () => {
  const a = buildArgs(base);
  assert.equal(a[a.indexOf('--json-schema') + 1], '{"type":"object"}');
  assert.equal(a[a.indexOf('--settings') + 1], '{"sandbox":{"enabled":true}}');
  assert.equal(a[a.indexOf('--max-turns') + 1], '150');
  assert.equal(a[a.indexOf('--setting-sources') + 1], 'project');
  assert.ok(a.includes('-p') && a.includes('--no-session-persistence'));
});
test('buildArgs always disallows asking, subagents, waiting and the web', () =>
  assert.match(buildArgs(base).join(' '), /--disallowedTools AskUserQuestion,Agent,Monitor,ScheduleWakeup,WebFetch,WebSearch,ListAgents,ReportFindings$/));
test('readOnly disallows the file-writing tools', () =>
  assert.match(buildArgs({ ...base, readOnly: true }).join(' '), /Write,Edit,NotebookEdit/));
test('model is passed only when set', () => {
  assert.ok(!buildArgs(base).includes('--model'));
  const a = buildArgs({ ...base, model: 'sonnet' });
  assert.equal(a[a.indexOf('--model') + 1], 'sonnet');
});
test('interpret: success returns structured_output and session id', () => {
  const r = interpret(result());
  assert.equal(r.ok, true);
  assert.deepEqual(r.output, { status: 'complete' });
  assert.equal(r.sessionId, 's1');
});
test('interpret: timeout', () => {
  const r = interpret({ code: null, stdout: '', stderr: '', timedOut: true }, 45);
  assert.equal(r.ok, false);
  assert.match(r.reason, /timed out after 45 min/);
});
test('interpret: max_turns', () => {
  const r = interpret(result({ terminal_reason: 'max_turns', is_error: true }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /max_turns/);
});
test('interpret: unparseable output is a failure, not a crash', () => {
  const r = interpret({ code: 0, stdout: 'not json', stderr: 'boom', timedOut: false });
  assert.equal(r.ok, false);
  assert.match(r.reason, /boom|not json/);
});
test('interpret: success without structured_output is a failure', () =>
  assert.equal(interpret(result({ structured_output: null })).ok, false));
test('interpret: an error result carries its text as the reason', () =>
  assert.match(interpret(result({ is_error: true, result: 'Usage limit reached' })).reason, /Usage limit reached/));
test('interpret: non-zero exit with empty output reports stderr', () =>
  assert.match(interpret({ code: 1, stdout: '', stderr: 'sandbox is enabled but cannot start', timedOut: false }).reason, /sandbox/));
test('agentSettings scopes file tools to the worktree by absolute path', () => {
  const s = agentSettings('/f/worktrees/issue-7');
  assert.deepEqual(s.permissions.allow.filter((r) => /^(Read|Edit|Write)/.test(r)),
    ['Read(//f/worktrees/issue-7/**)', 'Edit(//f/worktrees/issue-7/**)', 'Write(//f/worktrees/issue-7/**)']);
});
test('agentSettings fails closed, blocks the network and unsandboxed commands', () => {
  const s = agentSettings('/f/worktrees/issue-7').sandbox;
  assert.equal(s.enabled, true); assert.equal(s.failIfUnavailable, true);
  assert.equal(s.allowUnsandboxedCommands, false);
  assert.deepEqual(s.network.allowedDomains, []);
});
test('agentSettings denies push and gh, and switches attribution off', () => {
  const s = agentSettings('/f/worktrees/issue-7');
  assert.ok(s.permissions.deny.includes('Bash(git push*)') && s.permissions.deny.includes('Bash(gh *)'));
  assert.deepEqual(s.attribution, { commit: '', pr: '' });
});
test('agentSettings lets the sandbox read node and the Playwright browsers, nothing else at home', () => {
  const fs = agentSettings('/f/worktrees/issue-7', { ...config, ...scorePad }).sandbox.filesystem;
  assert.deepEqual(fs.denyRead, ['~']);
  assert.ok(fs.allowRead.includes('~/.nvm') && fs.allowRead.includes('~/.cache/ms-playwright'));
  assert.equal(fs.allowRead.length, 3);
});
test('agentSettings adds the runtime and target read folders', () => {
  const fs = agentSettings('/w', { runtimeRead: ['~/.sdkman'], sandboxRead: ['~/.gradle'] }).sandbox.filesystem;
  assert.ok(fs.allowRead.includes('~/.sdkman') && fs.allowRead.includes('~/.gradle'));
});

// Own target's run folder only: never the factory folder, which holds every target's clones and logs.
test('agentSettings lets the session read its own run folder, not the factory folder', async () => {
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const factoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const withRunDir = agentSettings('/f/runs/a/worktrees/issue-1', { ...config, runDir: '/f/runs/a' }).sandbox.filesystem.allowRead;
  assert.ok(withRunDir.includes('/f/runs/a'));
  assert.ok(!withRunDir.includes(factoryRoot) && !withRunDir.includes('/f/runs/b'));
  const without = agentSettings('/w/issue-1', { ...config }).sandbox.filesystem.allowRead;
  assert.ok(without.includes('/w/issue-1') && !without.includes(factoryRoot), 'without a run folder, only the worktree');
});

// A session gets an allowlist of the factory's environment: no tokens, keys or agent sockets.
test('runAgent passes on only allowlisted variables, plus the target env and git identity', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, chmodSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { runAgent } = await import('../lib/agent.mjs');
  const bin = mkdtempSync(join(tmpdir(), 'env-claude-')), dump = join(bin, 'env.json');
  writeFileSync(join(bin, 'claude'), `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(dump)}, JSON.stringify(process.env));
process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({ terminal_reason: 'completed', is_error: false, structured_output: {} })));
`);
  chmodSync(join(bin, 'claude'), 0o755);
  const saved = { ...process.env };
  Object.assign(process.env, { PATH: `${bin}:${process.env.PATH}`, GH_TOKEN: 'secret', SSH_AUTH_SOCK: '/x', ANTHROPIC_API_KEY: 'key', AWS_SECRET_ACCESS_KEY: 'aws' });
  try {
    const r = await runAgent({ cwd: bin, prompt: 'p', schema: { type: 'object' }, cfg: { ...config, env: { MY_VAR: 'v' } }, port: 4201 });
    assert.equal(r.ok, true, r.reason);
    const env = JSON.parse(readFileSync(dump, 'utf8'));
    for (const k of ['GH_TOKEN', 'SSH_AUTH_SOCK', 'ANTHROPIC_API_KEY', 'AWS_SECRET_ACCESS_KEY']) assert.equal(env[k], undefined, k);
    for (const k of ['PATH', 'HOME', 'GIT_AUTHOR_NAME', 'CLAUDE_CODE_DISABLE_CRON']) assert.ok(env[k], k);
    assert.equal(env.MY_VAR, 'v'); assert.equal(env.CI, '1');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('buildArgs loads the skills plugin when given, before --disallowedTools', () => {
  const a = buildArgs({ ...base, pluginDir: '/f/skills' });
  assert.equal(a[a.indexOf('--plugin-dir') + 1], '/f/skills');
  assert.ok(a.indexOf('--plugin-dir') < a.indexOf('--disallowedTools'));
  assert.ok(!buildArgs(base).includes('--plugin-dir'));
});
test('agentSettings lets agents read the skills, never write them', () => {
  const s = agentSettings('/r/worktrees/issue-1', { ...config, runDir: '/r', skillsDir: '/f/skills' });
  assert.ok(s.permissions.allow.includes('Read(//f/skills/**)'));
  assert.ok(!s.permissions.allow.some((p) => /^(Edit|Write)\(\/\/f\/skills/.test(p)));
  assert.ok(s.sandbox.filesystem.allowRead.includes('/f/skills'));
  const none = agentSettings('/r/worktrees/issue-1', { ...config, runDir: '/r' });
  assert.ok(!JSON.stringify(none).includes('skills'));
});

test('a budget adds --max-budget-usd and keeps --disallowedTools last', () => {
  const a = buildArgs({ ...base, maxBudgetUsd: 2 });
  assert.equal(a[a.indexOf('--max-budget-usd') + 1], '2');
  assert.equal(a.at(-2), '--disallowedTools');
});

test('no budget, or zero, leaves the arguments as they were', () => {
  for (const maxBudgetUsd of [null, undefined, 0]) assert.deepEqual(buildArgs({ ...base, maxBudgetUsd }), buildArgs(base));
});

// What claude -p --output-format json printed for a session stopped by --max-budget-usd 0.0001 (CLI, 2026-11-19).
const spent = {
  code: 0, timedOut: false, stderr: '',
  stdout: JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, terminal_reason: 'budget_exhausted', result: null, total_cost_usd: 2.0134, session_id: 's1' }),
};

test('a session that spent its budget fails with a reason that says so', () => {
  const r = interpret(spent, 45);
  assert.equal(r.ok, false);
  assert.match(r.reason, /spent its budget \(≈ \$2\.01\)/);
});

test('stats labels a budget stop as budget cap', () => {
  const reason = `The implement step failed: ${interpret(spent, 45).reason}`;
  assert.equal(stopLabel(stopped('implement', reason, 'agent:needs-human')), 'budget cap');
});

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

async function maxTurnsOf(session, cfg) {
  const { mkdtempSync, writeFileSync, readFileSync, chmodSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { runAgent } = await import('../lib/agent.mjs');
  const bin = mkdtempSync(join(tmpdir(), 'turns-claude-')), dump = join(bin, 'args.json');
  writeFileSync(join(bin, 'claude'), `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(dump)}, JSON.stringify(process.argv.slice(2)));
process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({ terminal_reason: 'completed', is_error: false, structured_output: {} })));
`);
  chmodSync(join(bin, 'claude'), 0o755);
  const saved = process.env.PATH;
  process.env.PATH = `${bin}:${saved}`;
  try {
    const r = await runAgent({ cwd: bin, prompt: 'p', schema: { type: 'object' }, cfg, port: 4201, session });
    assert.equal(r.ok, true, r.reason);
    const args = JSON.parse(readFileSync(dump, 'utf8'));
    return args[args.indexOf('--max-turns') + 1];
  } finally {
    process.env.PATH = saved;
  }
}

test('a gate session is started with the gate\'s turn limit', async () =>
  assert.equal(await maxTurnsOf('gate', config), String(config.turns.gate)));

test('a fix session is started with maxTurns', async () =>
  assert.equal(await maxTurnsOf('fix', config), String(config.maxTurns)));

test('a session type without its own turn limit uses maxTurns', async () =>
  assert.equal(await maxTurnsOf('review', { ...config, turns: { gate: 30 }, maxTurns: 99 }), '99'));

test('the default turn limits per session type', () =>
  assert.deepEqual(config.turns, { gate: 30, review: 60, explore: 80, implement: 80 }));
