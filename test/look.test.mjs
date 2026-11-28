import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { look, paint, logLine, detailTone } from '../lib/look.mjs';

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

describe('free-text reasons', () => {
  // Park reasons and done summaries are free text; words like "could not" in them must not turn the line red.
  const cases = [
    ['#12 implement parked: The agent could not finish:\n\nno tests', '⏸', 'yellow'],
    ['#12 implement parked: The agent could not fix the review findings:\n\nx', '⏸', 'yellow'],
    ['#12 rework parked: The agent could not finish the rework:\n\nx', '⏸', 'yellow'],
    ['#12 implement parked: The implement step failed: the agent session failed: x', '⏸', 'yellow'],
    ['#12 implement parked: A held-out check failed: `npm test`. Its output is in the factory\'s terminal', '⏸', 'yellow'],
    ['#12 rework done: could not reproduce the crashed: case', '✔', 'green'],
    ['#12 re-queued after the run failed: boom', '↻', 'yellow'],
  ];

  for (const [msg, icon, tone] of cases) {
    test(`look keeps the tone of the status, not the reason: ${msg.split('\n')[0]}`, () => {
      assert.deepEqual(look(msg), { icon, tone });
    });
  }

  test('look keeps a park yellow when its reason says the session ended', () => {
    const msg = '#12 implement parked: The implement step failed: the agent session ended without the required status report';
    assert.deepEqual(look(msg), { icon: '⏸', tone: 'yellow' });
  });
});

test('a start line with a title is ▶ cyan', () => {
  assert.deepEqual(look('#12 implement started (Fix the bug)'), { icon: '▶', tone: 'cyan' });
});

test('a start line without a title still looks the same', () => {
  assert.deepEqual(look('#12 implement started'), { icon: '▶', tone: 'cyan' });
});

test('a title cannot change the look', () => {
  assert.deepEqual(look('#12 implement started (Make it started)'), { icon: '▶', tone: 'cyan' });
  assert.deepEqual(look('#12 implement started (parked: oops)'), { icon: '▶', tone: 'cyan' });
  assert.deepEqual(look('#12 implement started (done)'), { icon: '▶', tone: 'cyan' });
});

test('text after started that is not a title is not a start line', () => {
  assert.deepEqual(look('#12 implement started later'), { icon: '', tone: 'plain' });
});

// A run that ends with a draft pull request is done: the line is green, why it is a draft is yellow under it.
describe('draft pull requests', () => {
  const DRAFT = '\n          draft: it changes files you should check:\n          - protected file changed: AGENTS.md';
  for (const stage of ['implement', 'rework', 'merge']) {
    test(`a ${stage} run with a draft is ✔ green, its draft lines yellow`, () => {
      const msg = `#12 ${stage} done: https://github.com/o/r/pull/3${DRAFT}`;
      assert.deepEqual(look(msg), { icon: '✔', tone: 'green' });
      assert.equal(detailTone(msg), 'yellow');
    });
  }

  test('other lines keep their details in the first line\'s tone', () => {
    assert.equal(detailTone('#12 implement crashed: a\n          b'), 'red');
    assert.equal(detailTone('#12 rework done: changed it\n          and more'), 'green');
    assert.equal(detailTone('#12 implement parked: a\n          draft: b'), 'yellow');
    assert.equal(detailTone('0 eligible'), 'plain');
  });

  test('logLine with colour: the done line green, the draft lines yellow', () => {
    const { FORCE_COLOR, NO_COLOR } = process.env;
    process.env.FORCE_COLOR = '1';
    delete process.env.NO_COLOR;
    try {
      const [first, ...rest] = logLine('12:00:00', `#12 implement done: https://github.com/o/r/pull/3${DRAFT}`, notTerminal()).split('\n');
      assert.ok(first.includes(`${ESC}32m`), JSON.stringify(first));
      for (const line of rest) assert.ok(line.startsWith(`${ESC}33m`), JSON.stringify(line));
    } finally {
      if (FORCE_COLOR === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = FORCE_COLOR;
      if (NO_COLOR !== undefined) process.env.NO_COLOR = NO_COLOR;
    }
  });
});
