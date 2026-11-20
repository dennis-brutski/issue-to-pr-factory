import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { screen } from '../lib/screen.mjs';

// A non-terminal stream, so no colour codes; columns tells screen it is drawing for a terminal.
const setup = (opts = {}) => screen({ repo: 'o/r', columns: 80, pollSec: 300, stream: new PassThrough(), now: () => 0, ...opts });

function noColour(fn) {
  const { FORCE_COLOR } = process.env;
  delete process.env.FORCE_COLOR;
  try { fn(); } finally { if (FORCE_COLOR !== undefined) process.env.FORCE_COLOR = FORCE_COLOR; }
}

test('0 eligible shows what the factory waits for and when it looks again', () => noColour(() => {
  const show = setup();
  assert.equal(show('23:42:26', '0 eligible'), '23:42:26  ◦ waiting for labelled issues · next check at 23:47:26');
}));

test('a second 0 eligible right after replaces the waiting line', () => noColour(() => {
  const show = setup();
  show('23:42:26', '0 eligible');
  assert.equal(show('23:47:26', '0 eligible'), '\x1b[1A\x1b[2K23:47:26  ◦ waiting for labelled issues · next check at 23:52:26');
}));

test('the waiting line comes back after any other line', () => noColour(() => {
  const show = setup();
  assert.equal(show('23:42:26', '0 eligible'), '23:42:26  ◦ waiting for labelled issues · next check at 23:47:26');
  show('23:43:00', '#44 implement started');
  assert.equal(show('23:50:00', '0 eligible'), '23:50:00  ◦ waiting for labelled issues · next check at 23:55:00');
}));

test('without pollSec there is no next check part', () => noColour(() => {
  const show = setup({ pollSec: undefined });
  assert.equal(show('23:42:26', '0 eligible'), '23:42:26  ◦ waiting for labelled issues');
}));

test('next check wraps past midnight', () => noColour(() => {
  const show = setup();
  assert.equal(show('23:58:00', '0 eligible'), '23:58:00  ◦ waiting for labelled issues · next check at 00:03:00');
}));

test('not a terminal: 0 eligible stays as it is, every time', () => noColour(() => {
  const show = setup({ columns: undefined });
  assert.equal(show('23:42:26', '0 eligible'), '23:42:26  0 eligible');
  assert.equal(show('23:47:26', '0 eligible'), '23:42:26  0 eligible'.replace('23:42:26', '23:47:26'));
}));

test('the waiting line is dim when colour is on', () => {
  const { FORCE_COLOR, NO_COLOR } = process.env;
  process.env.FORCE_COLOR = '1';
  delete process.env.NO_COLOR;
  try {
    const line = setup()('23:42:26', '0 eligible');
    assert.ok(line.includes('\u001b[2m◦ waiting for labelled issues'), JSON.stringify(line));
  } finally {
    if (FORCE_COLOR === undefined) delete process.env.FORCE_COLOR; else process.env.FORCE_COLOR = FORCE_COLOR;
    if (NO_COLOR !== undefined) process.env.NO_COLOR = NO_COLOR;
  }
});
