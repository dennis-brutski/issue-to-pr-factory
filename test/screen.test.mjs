import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { screen } from '../lib/screen.mjs';

const ESC = '\u001b[';
const T = '12:00:00';
const PAD = ' '.repeat(10);

// A non-terminal stream and a clock the test moves by hand.
function setup(opts = {}) {
  let t = 0;
  const clock = { now: () => t, set: (ms) => { t = ms; } };
  const show = screen({ repo: 'o/r', columns: undefined, stream: new PassThrough(), now: clock.now, ...opts });
  return { show, clock };
}

function noColour(fn) {
  const { FORCE_COLOR } = process.env;
  delete process.env.FORCE_COLOR;
  try { fn(); } finally { if (FORCE_COLOR !== undefined) process.env.FORCE_COLOR = FORCE_COLOR; }
}

function withColour(fn) {
  const { FORCE_COLOR, NO_COLOR } = process.env;
  process.env.FORCE_COLOR = '1';
  delete process.env.NO_COLOR;
  try { fn(); } finally {
    if (FORCE_COLOR === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = FORCE_COLOR;
    if (NO_COLOR !== undefined) process.env.NO_COLOR = NO_COLOR;
  }
}

test('session started is shown, lined up with session ended', () => noColour(() => {
  const { show } = setup();
  assert.equal(show(T, '#39 implement session started'), `${T}  #39 │ implement  · started`);
}));

test('session ended: name padded to 10, then the usage', () => noColour(() => {
  const { show } = setup();
  assert.equal(show(T, '#39 gate session ended · 4 turns · 6s · ≈ $0.13'), `${T}  #39 │ gate       · 4 turns · 6s · ≈ $0.13`);
}));

test('session ended without usage still shows the session name', () => noColour(() => {
  const { show } = setup();
  assert.equal(show(T, '#39 implement session ended').trimEnd(), `${T}  #39 │ implement`);
}));

test('issue prefix is padded so the bar lines up', () => noColour(() => {
  const { show } = setup();
  assert.equal(show(T, '#7 implement started'), `${T}  #7  │ ▶ implement started`);
  assert.equal(show(T, '#39 implement started'), `${T}  #39 │ ▶ implement started`);
}));

test('the same issue always gets the same colour, other issues another', () => withColour(() => {
  const a = setup().show(T, '#39 implement started');
  const b = setup().show(T, '#39 review started');
  const c = setup().show(T, '#40 implement started');
  const colourOf = (s) => s.match(/\u001b\[(\d+)m#\d+/)?.[1];
  assert.ok(colourOf(a), JSON.stringify(a));
  assert.equal(colourOf(a), colourOf(b));
  assert.notEqual(colourOf(a), colourOf(c));
  for (const s of [a, c]) assert.ok(!['32', '33', '31'].includes(colourOf(s)), 'green, yellow and red are reserved');
  assert.ok(a.includes(`${ESC}39m │ ▶`) || a.includes(' │ ▶'), 'bar and icon stay without colour');
}));

test('lines not about an issue look as before', () => noColour(() => {
  const { show } = setup();
  assert.equal(show(T, '0 eligible'), `${T}  0 eligible`);
  assert.equal(show(T, 'stopped'), `${T}  🏭 stopped`);
  assert.equal(show(T, 'warning: x is off'), `${T}  ⚠ warning: x is off`);
}));

test('done adds duration, sessions and summed cost', () => noColour(() => {
  const { show, clock } = setup();
  clock.set(1000);
  show(T, '#39 implement started');
  show(T, '#39 implement session started');
  show(T, '#39 implement session ended · 7 turns · ≈ $0.20');
  show(T, '#39 review session started');
  show(T, '#39 review session ended · 5 turns · ≈ $0.30');
  clock.set(1000 + 156_000);
  assert.equal(show(T, '#39 implement done: https://github.com/o/r/pull/3'),
    `${T}  #39 │ ✔ implement done in 2m36s · 2 sessions · ≈ $0.50: https://github.com/o/r/pull/3`);
}));

test('done without detail still gets the summary', () => noColour(() => {
  const { show, clock } = setup();
  show(T, '#39 rework started');
  show(T, '#39 rework session ended · ≈ $0.10');
  clock.set(45_000);
  assert.equal(show(T, '#39 rework done'), `${T}  #39 │ ✔ rework done in 45s · 1 session · ≈ $0.10`);
}));

test('done without a known start leaves the parts out', () => noColour(() => {
  const { show } = setup();
  show(T, '#39 review session ended · ≈ $0.30');
  assert.equal(show(T, '#39 implement done: https://github.com/o/r/pull/3'), `${T}  #39 │ ✔ implement done: https://github.com/o/r/pull/3`);
}));

test('cost is left out when a session gave none', () => noColour(() => {
  const { show, clock } = setup();
  show(T, '#39 implement started');
  show(T, '#39 implement session ended');
  clock.set(6000);
  assert.equal(show(T, '#39 implement done'), `${T}  #39 │ ✔ implement done in 6s · 1 session`);
}));

test('a long park reason is cut to 3 lines, with … and a link', () => noColour(() => {
  const { show } = setup();
  const reason = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join(`\n${PAD}`);
  const out = show(T, `#40 implement parked: ${reason}`).split('\n');
  assert.deepEqual(out, [
    `${T}  #40 │ ⏸ implement parked: line 1`,
    `${PAD}#40 │   line 2`,
    `${PAD}#40 │   line 3 …`,
    `${PAD}#40 │   full text: https://github.com/o/r/issues/40`,
  ]);
}));

test('a park reason that fits is shown in full, without the link', () => noColour(() => {
  const { show } = setup();
  assert.equal(show(T, '#40 parked: needs the ready label'), `${T}  #40 │ ⏸ parked: needs the ready label`);
}));

test('held-out check output keeps all its lines', () => noColour(() => {
  const { show } = setup();
  const lines = Array.from({ length: 50 }, (_, i) => `out ${i + 1}`);
  const out = show(T, `#39 held-out check output:\n${lines.join('\n')}`).split('\n');
  assert.equal(out.length, 51);
  assert.equal(out[0], `${T}  #39 │ held-out check output:`);
  assert.equal(out[50], `${PAD}#39 │   out 50`);
}));

test('crashed keeps every line', () => noColour(() => {
  const { show } = setup();
  const out = show(T, '#39 implement crashed: a\nb\nc\nd\ne').split('\n');
  assert.equal(out.length, 5);
  assert.equal(out[4], `${PAD}#39 │   e`);
}));

test('columns: 60 wraps at word boundaries with a hanging indent', () => noColour(() => {
  const { show } = setup({ columns: 60 });
  const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
  const out = show(T, `#39 implement crashed: ${words}`).split('\n');
  assert.ok(out.length > 1, JSON.stringify(out));
  assert.ok(out[0].startsWith(`${T}  #39 │ ✖ implement crashed: word0`));
  for (const l of out) assert.ok(l.length <= 60, JSON.stringify(l));
  for (const l of out.slice(1)) assert.match(l, /^ {10}#39 │ {3}word\d+/);
  assert.equal(out.join(' ').match(/word\d+/g).length, 30);
}));

test('columns: undefined does not wrap', () => noColour(() => {
  const { show } = setup();
  const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
  assert.equal(show(T, `#39 implement crashed: ${words}`), `${T}  #39 │ ✖ implement crashed: ${words}`);
}));

// A cut park reason on a terminal: at most 3 lines on screen, the last ending in …, then the link on one line.
function assertParkCut(out) {
  assert.equal(out.length, 4, JSON.stringify(out));
  assert.ok(out[2].endsWith(' …'), JSON.stringify(out));
  assert.equal(out[3], `${PAD}#40 │   full text: https://github.com/o/r/issues/40`);
  for (const l of out.slice(0, 3)) assert.ok(l.length <= 60, JSON.stringify(l));
}

test('columns: 60 cuts a single long one-line park reason by lines on screen', () => noColour(() => {
  const { show } = setup({ columns: 60 });
  const long = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ');
  const out = show(T, `#40 implement parked: ${long}`).split('\n');
  assert.ok(out[0].startsWith(`${T}  #40 │ ⏸ implement parked: w0 w1`), JSON.stringify(out));
  assertParkCut(out);
}));

test('columns: 60 cuts a two-long-line park reason by lines on screen', () => noColour(() => {
  const { show } = setup({ columns: 60 });
  const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ');
  const out = show(T, `#40 implement parked: Could not finish:\n${PAD}${long}\n${PAD}${long}`).split('\n');
  assert.equal(out[0], `${T}  #40 │ ⏸ implement parked: Could not finish:`);
  assert.match(out[1], /^ {10}#40 │ {3}w0 w1/);
  assertParkCut(out);
}));

test('with colour, wrapping uses the full visible width', () => withColour(() => {
  const { show } = setup({ columns: 60 });
  const words = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ');
  const out = show(T, `#39 implement crashed: ${words}`).split('\n');
  const visible = out.map((l) => l.replace(/\u001b\[\d+(;\d+)*m/g, ''));
  assert.ok(out.length > 1, JSON.stringify(visible));
  for (const l of visible) assert.ok(l.length <= 60, JSON.stringify(l));
  assert.ok(Math.max(...visible.map((l) => l.length)) >= 57, JSON.stringify(visible));
}));

test('session ended keeps its padding when columns is known', () => noColour(() => {
  const { show } = setup({ columns: 100 });
  assert.equal(show(T, '#39 gate session ended · 4 turns · 6s · ≈ $0.13'), `${T}  #39 │ gate       · 4 turns · 6s · ≈ $0.13`);
}));
