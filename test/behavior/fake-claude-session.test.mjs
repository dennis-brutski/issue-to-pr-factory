// The fake claude knows a session by the marker on the prompt's first line and the issue
// by its worktree folder, so rewording a prompt heading does not break the behaviour tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../lib/exec.mjs';
import { runAgent } from '../../lib/agent.mjs';
import { renderPrompt } from '../../lib/stages.mjs';
import { config } from '../../config.mjs';
import { FAKES_BIN } from './world.mjs';
import { sessionOf } from './fakes/session.mjs';

const SESSIONS = ['gate', 'implement', 'review', 'fix', 'rework', 'merge', 'explore'];
const vars = { number: 7, branch: 'factory/issue-7', base: 'main', title: 'T', body: 'B', comments: 'C', findings: 'F' };
const reword = (prompt) => prompt.replace(/^# .*$/m, '# Something else entirely');

test('every session prompt starts with its marker', () => {
  for (const name of SESSIONS) {
    const first = readFileSync(new URL(`../../prompts/${name}.md`, import.meta.url), 'utf8').split('\n')[0];
    assert.equal(first, `<!-- session: ${name} -->`, name);
  }
});

test('the fake finds each session by its marker even when the heading is reworded', () => {
  for (const name of SESSIONS) {
    const prompt = reword(renderPrompt(name, vars));
    assert.doesNotMatch(prompt, /#7/, `${name}: the issue number must come from the folder`);
    assert.deepEqual(sessionOf(prompt, '/runs/t/worktrees/issue-42'), { session: name, issue: 42 }, name);
  }
});

test('a prompt without a marker or known heading is unknown', () =>
  assert.equal(sessionOf('# Do something\n', '/runs/t/worktrees/issue-1').session, null));

test('a reworded prompt runs through the fake claude', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fake-claude-marker-')), dir = join(root, 'worktrees', 'issue-9');
  mkdirSync(dir, { recursive: true });
  await run('git', ['init', '-q', dir]);
  const script = join(root, 'script.json'), log = join(root, 'log.jsonl');
  const output = { verdict: 'clean', findings: [] };
  writeFileSync(script, JSON.stringify({ 9: [{ session: 'review', output }] }));
  writeFileSync(log, '');
  if (!process.env.PATH.startsWith(FAKES_BIN)) process.env.PATH = `${FAKES_BIN}:${process.env.PATH}`;
  const prompt = reword(renderPrompt('review', { ...vars, number: 9, branch: 'factory/issue-9' }));
  const cfg = { ...config, maxTurns: 1, sessionTimeoutMin: 1 };
  const r = await runAgent({ cwd: dir, prompt, schema: { type: 'object' }, cfg, env: { FAKE_CLAUDE_SCRIPT: script, FAKE_CLAUDE_LOG: log } });
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.output, output);
  const [call] = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual([call.issue, call.session], [9, 'review']);
});
