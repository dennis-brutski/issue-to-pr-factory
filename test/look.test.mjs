import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { look, paint, logLine } from '../lib/look.mjs';

const ESC = '\u001b[';
const cases = [
  ['#12 implement started', '▶', 'cyan'],
  ['#12 implement session started', '·', 'dim'],
  ['#12 implement session ended after 4 turns', '·', 'dim'],
  ['#12 implement done: https://github.com/o/r/pull/3', '✔', 'green'],
  ['#12 rework done', '✔', 'green'],
  ['#12 finished; worktree removed', '✔', 'green'],
  ['#12 implement parked: checks failed\n          npm test exited 1', '⏸', 'yellow'],
  ['#12 parked: needs the ready label', '⏸', 'yellow'],
  ['#12 re-queued after an interrupted run', '↻', 'yellow'],
  ['warning: `spec/` is in targets/demo.mjs but not on master', '⚠', 'yellow'],
  ['#12 implement crashed: boom', '✖', 'red'],
  ['could not list issues: gh failed', '✖', 'red'],
  ['#12 could not be parked: gh failed', '✖', 'red'],
  ['#12 could not record the park on GitHub: no', '✖', 'red'],
  ['#12 cleanup failed: busy', '✖', 'red'],
  ['factory cannot run: no settings', '✖', 'red'],
  ['factory started for o/r (demo) — polling every 60s, up to 2 at a time', '🏭', 'bold'],
  ['stopping', '🏭', 'bold'],
  ['stopped', '🏭', 'bold'],
  ['0 eligible', '', 'plain'],
  ['created label factory:ready', '', 'plain'],
  ['#12 explore promoted: explore found it safe; queued for implement', '', 'plain'],
  ['#12 held-out check output:\nall good', '', 'plain'],
];

for (const [msg, icon, tone] of cases) {
  test(`look: ${msg.split('\n')[0]}`, () => {
    assert.deepEqual(look(msg), { icon, tone });
  });
}

const notTerminal = () => new PassThrough();

test('paint leaves out escape codes when the stream is not a terminal', () => {
  const { FORCE_COLOR } = process.env;
  delete process.env.FORCE_COLOR;
  try {
    assert.equal(paint('#12 implement crashed: boom', 'red', notTerminal()), '#12 implement crashed: boom');
    assert.equal(paint('x', 'plain', notTerminal()), 'x');
  } finally { if (FORCE_COLOR !== undefined) process.env.FORCE_COLOR = FORCE_COLOR; }
});

test('paint adds escape codes with FORCE_COLOR=1', () => {
  const { FORCE_COLOR, NO_COLOR } = process.env;
  process.env.FORCE_COLOR = '1';
  delete process.env.NO_COLOR;
  try {
    const out = paint('#12 implement crashed: boom', 'red', notTerminal());
    assert.ok(out.includes(ESC), JSON.stringify(out));
    assert.ok(out.includes('#12 implement crashed: boom'));
    assert.equal(paint('x', 'plain', notTerminal()), 'x');
  } finally {
    if (FORCE_COLOR === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = FORCE_COLOR;
    if (NO_COLOR !== undefined) process.env.NO_COLOR = NO_COLOR;
  }
});

test('logLine without colour: time, icon, message; details keep their indent', () => {
  const { FORCE_COLOR } = process.env;
  delete process.env.FORCE_COLOR;
  try {
    assert.equal(logLine('12:00:00', '#12 implement started', notTerminal()), '12:00:00  ▶ #12 implement started');
    assert.equal(logLine('12:00:00', '0 eligible', notTerminal()), '12:00:00  0 eligible');
    assert.equal(logLine('12:00:00', '#12 implement parked: a\n          b', notTerminal()), '12:00:00  ⏸ #12 implement parked: a\n          b');
  } finally { if (FORCE_COLOR !== undefined) process.env.FORCE_COLOR = FORCE_COLOR; }
});

test('logLine with colour: dim time, bold issue number, details in the first line\'s tone', () => {
  const { FORCE_COLOR, NO_COLOR } = process.env;
  process.env.FORCE_COLOR = '1';
  delete process.env.NO_COLOR;
  try {
    const out = logLine('12:00:00', '#12 implement crashed: a\n          b', notTerminal());
    const [first, second] = out.split('\n');
    assert.ok(first.startsWith(`${ESC}2m12:00:00`), JSON.stringify(first));
    assert.ok(first.includes(`${ESC}1m#12`), JSON.stringify(first));
    assert.ok(first.includes(`${ESC}31m`), JSON.stringify(first));
    assert.equal(second, `${ESC}31m          b${ESC}39m`);
    assert.equal(out.replace(/\u001b\[\d+m/g, ''), '12:00:00  ✖ #12 implement crashed: a\n          b');
  } finally {
    if (FORCE_COLOR === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = FORCE_COLOR;
    if (NO_COLOR !== undefined) process.env.NO_COLOR = NO_COLOR;
  }
});
