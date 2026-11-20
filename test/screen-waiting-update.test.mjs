import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { screen } from '../lib/screen.mjs';

// A non-terminal stream, so no colour codes; columns tells screen it is drawing for a terminal.
const setup = (opts = {}) => screen({ repo: 'o/r', columns: 80, pollSec: 300, stream: new PassThrough(), now: () => 0, ...opts });
const UP = '\x1b[1A\x1b[2K'; // cursor up one line, clear it

function noColour(fn) {
  const { FORCE_COLOR } = process.env;
  delete process.env.FORCE_COLOR;
  try { fn(); } finally { if (FORCE_COLOR !== undefined) process.env.FORCE_COLOR = FORCE_COLOR; }
}

test('a second 0 eligible right after replaces the waiting line with the new times', () => noColour(() => {
  const show = setup();
  show('03:12:29', '0 eligible');
  assert.equal(show('03:17:29', '0 eligible'), `${UP}03:17:29  ◦ waiting for labelled issues · next check at 03:22:29`);
  assert.equal(show('03:22:29', '0 eligible'), `${UP}03:22:29  ◦ waiting for labelled issues · next check at 03:27:29`);
}));

test('after another line the waiting line is a new line again', () => noColour(() => {
  const show = setup();
  show('03:12:29', '0 eligible');
  show('03:13:00', '#44 implement started');
  assert.equal(show('03:17:29', '0 eligible'), '03:17:29  ◦ waiting for labelled issues · next check at 03:22:29');
}));

test('after a running line the waiting line is a new line again', () => noColour(() => {
  const show = setup();
  show('03:12:29', '0 eligible');
  show('03:17:29', '1 running');
  assert.equal(show('03:22:29', '0 eligible'), '03:22:29  ◦ waiting for labelled issues · next check at 03:27:29');
}));

test('the waiting line stays one line even on a narrow terminal', () => noColour(() => {
  const show = setup({ columns: 20 });
  show('03:12:29', '0 eligible');
  const line = show('03:17:29', '0 eligible');
  assert.equal(line, `${UP}03:17:29  ◦ waiting for labelled issues · next check at 03:22:29`);
  assert.ok(!line.includes('\n'));
}));

test('not a terminal: 0 eligible every poll, no escape codes', () => noColour(() => {
  const show = setup({ columns: undefined });
  assert.equal(show('03:12:29', '0 eligible'), '03:12:29  0 eligible');
  assert.equal(show('03:17:29', '0 eligible'), '03:17:29  0 eligible');
}));
