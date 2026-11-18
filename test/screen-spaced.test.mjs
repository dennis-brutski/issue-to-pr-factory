import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { screen } from '../lib/screen.mjs';

const T = '12:00:00';

function setup(columns) {
  let t = 0;
  const clock = { now: () => t, set: (ms) => { t = ms; } };
  const show = screen({ repo: 'o/r', columns, stream: new PassThrough(), now: clock.now });
  return { show, clock };
}

function noColour(fn) {
  const { FORCE_COLOR } = process.env;
  delete process.env.FORCE_COLOR;
  try { fn(); } finally { if (FORCE_COLOR !== undefined) process.env.FORCE_COLOR = FORCE_COLOR; }
}

test('on a terminal, a session duration gets a space', () => noColour(() => {
  const { show } = setup(80);
  const out = show(T, '#39 implement session ended · 7 turns · 1m55s · ≈ $0.20');
  assert.match(out, /1m 55s/);
  assert.doesNotMatch(out, /1m55s/);
}));

test('on a terminal, the run summary duration gets a space', () => noColour(() => {
  const { show, clock } = setup(80);
  show(T, '#39 implement started');
  clock.set((60 + 3) * 60 * 1000);
  const out = show(T, '#39 implement done');
  assert.match(out, /done in 1h 03m/);
}));

test('on a terminal, a duration in a park reason gets a space', () => noColour(() => {
  const { show } = setup(80);
  const out = show(T, '#39 parked: the session ran for 5m30s and stopped');
  assert.match(out, /5m 30s/);
  assert.doesNotMatch(out, /5m30s/);
}));

test('not on a terminal, durations stay as written', () => noColour(() => {
  const { show, clock } = setup(undefined);
  assert.match(show(T, '#39 implement session ended · 7 turns · 1m55s · ≈ $0.20'), /1m55s/);
  assert.match(show(T, '#39 parked: the session ran for 5m30s and stopped'), /5m30s/);
  show(T, '#40 implement started');
  clock.set((60 + 3) * 60 * 1000);
  assert.match(show(T, '#40 implement done'), /done in 1h03m/);
}));
