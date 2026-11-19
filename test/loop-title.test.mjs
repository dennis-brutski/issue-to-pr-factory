import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.mjs';
import { tick, shortTitle } from '../lib/loop.mjs';

test('shortTitle removes control characters and escape codes', () => {
  assert.equal(shortTitle('Fix\x00 the\x07 \x1b[31mbug\x1b[0m\x7f'), 'Fix the [31mbug[0m');
});

test('shortTitle removes a control character inside a word', () => {
  assert.equal(shortTitle('a\x1bb\x00c'), 'abc');
});

test('shortTitle collapses whitespace and trims', () => {
  assert.equal(shortTitle('  Fix \t the\n\n  bug  '), 'Fix the bug');
});

test('shortTitle cuts a long title to 80 characters with …', () => {
  const t = shortTitle('a'.repeat(100));
  assert.equal(t.length, 80);
  assert.equal(t, `${'a'.repeat(79)}…`);
  assert.equal(shortTitle('b'.repeat(80)), 'b'.repeat(80));
});

test('shortTitle of no title is empty', () => {
  assert.equal(shortTitle(undefined), '');
  assert.equal(shortTitle(' \x1b '), '');
});

const T = '2026-11-01T10:00:00Z';
const issue = (number, o = {}) => ({
  number, kind: 'issue', title: '', body: '', author: 'dennis-brutski', bodyEditedAt: null,
  labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }],
  comments: [], headRef: null, headRepo: null, ...o,
});

async function startLog(item) {
  const logs = [];
  const running = new Map();
  await tick({
    cfg: config, log: (m) => logs.push(m),
    runItem: async () => ({ outcome: 'done' }),
    gh: { listCandidates: async () => [item] },
  }, running);
  await Promise.all(running.values());
  return logs.find((l) => l.includes('started'));
}

test('the start line names the issue title', async () => {
  assert.equal(await startLog(issue(3, { title: 'Fix the bug' })), '#3 implement started (Fix the bug)');
});

test('the start line stays as it was without a title', async () => {
  assert.equal(await startLog(issue(3, { title: '' })), '#3 implement started');
  assert.equal(await startLog(issue(3, { title: undefined })), '#3 implement started');
});
