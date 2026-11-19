import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { screen } from '../lib/screen.mjs';

const setup = (columns, pollSec = 300) => screen({ repo: 'o/r', columns, stream: new PassThrough(), now: () => 0, pollSec });

function noColour(fn) {
  const { FORCE_COLOR } = process.env;
  delete process.env.FORCE_COLOR;
  try { fn(); } finally { if (FORCE_COLOR !== undefined) process.env.FORCE_COLOR = FORCE_COLOR; }
}

test('on a terminal, a poll while runs go on says how many and when it looks again', () => noColour(() => {
  const show = setup(100);
  assert.equal(show('02:33:13', '3 running'), '02:33:13  ◦ 3 running · next check at 02:38:13');
}));

test('on a terminal, every such poll is shown, since the next check moves on', () => noColour(() => {
  const show = setup(100);
  show('02:33:13', '1 running');
  assert.equal(show('02:38:13', '1 running'), '02:38:13  ◦ 1 running · next check at 02:43:13');
}));

test('on a terminal, without pollSec there is no next check part', () => noColour(() => {
  const show = setup(100, null);
  assert.equal(show('02:33:13', '2 running'), '02:33:13  ◦ 2 running');
}));

test('the waiting line still shows after a running line', () => noColour(() => {
  const show = setup(100);
  show('02:33:13', '1 running');
  assert.match(show('02:38:13', '0 eligible'), /waiting for labelled issues/);
}));

test('not on a terminal, the running line stays as written', () => noColour(() => {
  const show = setup(undefined);
  assert.equal(show('02:33:13', '3 running'), '02:33:13  3 running');
}));
