import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArgs, interpret, agentSettings } from '../lib/agent.mjs';
import { config } from '../config.mjs';
import scorePad from '../targets/gin-rummy-score-pad.mjs';

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
  assert.match(buildArgs(base).join(' '), /--disallowedTools AskUserQuestion,Agent,Monitor,ScheduleWakeup,WebFetch,WebSearch$/));
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
