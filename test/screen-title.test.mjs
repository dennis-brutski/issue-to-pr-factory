import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { screen } from '../lib/screen.mjs';

const T = '12:00:00';

function noColour(fn) {
  const { FORCE_COLOR } = process.env;
  delete process.env.FORCE_COLOR;
  try { fn(); } finally { if (FORCE_COLOR !== undefined) process.env.FORCE_COLOR = FORCE_COLOR; }
}

function setup() {
  let t = 0;
  const show = screen({ repo: 'o/r', columns: undefined, stream: new PassThrough(), now: () => t });
  return { show, set: (ms) => { t = ms; } };
}

test('a start line with a title is shown with ▶', () => noColour(() => {
  const { show } = setup();
  assert.equal(show(T, '#39 implement started (Fix the bug)'), `${T}  #39 │ ▶ implement started (Fix the bug)`);
}));

test('a start line with a title still starts the run timer', () => noColour(() => {
  const { show, set } = setup();
  set(1000);
  show(T, '#39 implement started (Fix the bug)');
  show(T, '#39 implement session ended · ≈ $0.20');
  set(46_000);
  assert.equal(show(T, '#39 implement done'), `${T}  #39 │ ✔ implement done in 45s · 1 session · ≈ $0.20`);
}));
