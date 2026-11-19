import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { screen } from '../lib/screen.mjs';

const T = '23:45:47';

const setup = (columns) => screen({ repo: 'o/r', columns, stream: new PassThrough(), now: () => 0 }).bind(null, T);

function noColour(fn) {
  const { FORCE_COLOR } = process.env;
  delete process.env.FORCE_COLOR;
  try { fn(); } finally { if (FORCE_COLOR !== undefined) process.env.FORCE_COLOR = FORCE_COLOR; }
}

// Where each " · " starts in a line.
const dots = (line) => [...line.matchAll(/ · /g)].map((m) => m.index);

const GATE = '#47 gate session ended · 3 turns · 3s · 37k in (63% cached) · 260 out · ≈ $0.06';
const IMPL = '#47 implement session ended · 13 turns · 51s · 280k in (90% cached) · 3.9k out · ≈ $0.35';

test('on a terminal, the parts of session lines line up', () => noColour(() => {
  const show = setup(100);
  const a = show(GATE), b = show(IMPL);
  assert.equal(dots(a).length, 5);
  assert.deepEqual(dots(a), dots(b), `\n${a}\n${b}`);
}));

test('on a terminal, the session name lines up with the text after the run icon', () => noColour(() => {
  const show = setup(100);
  const run = show('#47 implement started');
  const s = show(GATE);
  assert.equal(s.indexOf('gate'), run.indexOf('implement'), `\n${run}\n${s}`);
}));

test('on a terminal, 1 turn lines up with 13 turns', () => noColour(() => {
  const show = setup(100);
  const a = show('#47 gate session ended · 1 turn · 3s · ≈ $0.01');
  const b = show('#47 gate session ended · 13 turns · 3s · ≈ $0.01');
  assert.deepEqual(dots(a), dots(b), `\n${a}\n${b}`);
  assert.match(a, / {2}1 turn  · /);
}));

test('on a terminal, started sits in the turns column', () => noColour(() => {
  const show = setup(100);
  const s = show('#47 gate session started');
  const e = show(GATE);
  assert.equal(s.indexOf('started') + 'started'.length, e.indexOf('turns') + 'turns'.length, `\n${s}\n${e}`);
  assert.equal(dots(s)[0], dots(e)[0]);
}));

test('on a terminal, a session line without usage still shows the padded name', () => noColour(() => {
  const show = setup(100);
  assert.equal(show('#47 gate session ended'), `${T}  #47 │   gate      `);
}));

test('on a terminal, a long duration fits the time column', () => noColour(() => {
  const show = setup(100);
  const a = show('#47 implement session ended · 13 turns · 1m55s · ≈ $0.35');
  const b = show('#47 gate session ended · 3 turns · 3s · ≈ $0.06');
  assert.deepEqual(dots(a), dots(b), `\n${a}\n${b}`);
  assert.match(a, /1m 55s/);
}));

test('on a terminal, an unknown part stays as it is', () => noColour(() => {
  const show = setup(100);
  assert.match(show('#47 gate session ended · 3 turns · something new'), / · something new$/);
}));

test('not on a terminal, session lines stay as written', () => noColour(() => {
  const show = setup(undefined);
  assert.equal(show(GATE), `${T}  #47 │ gate       · 3 turns · 3s · 37k in (63% cached) · 260 out · ≈ $0.06`);
}));
