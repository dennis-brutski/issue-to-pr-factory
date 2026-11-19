import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { screen } from '../lib/screen.mjs';

const T = '12:00:00';

// A stream that answers hasColors(depth) like a terminal with `depth` colours (0: no colour).
function fakeStream(depth) {
  const stream = new PassThrough();
  stream.hasColors = (count = 16) => depth >= count;
  return stream;
}

// styleText also colours the time; keep the environment from forcing it, so only the stream decides.
function plainEnv(fn) {
  const { FORCE_COLOR, NO_COLOR } = process.env;
  delete process.env.FORCE_COLOR;
  delete process.env.NO_COLOR;
  try { fn(); } finally {
    if (FORCE_COLOR !== undefined) process.env.FORCE_COLOR = FORCE_COLOR;
    if (NO_COLOR !== undefined) process.env.NO_COLOR = NO_COLOR;
  }
}

const tagOf = (depth, n, stream = fakeStream(depth)) =>
  screen({ repo: 'o/r', columns: 100, stream })(T, `#${n} implement started`);
const code256 = (s) => s.match(/\u001b\[38;5;(\d+)m#\d+/)?.[1];

// Hard to read on a dark background, or the same as a line tone (cyan, green, yellow, red).
const DENY = ['4', '6', '12', '14', '18', '19', '20', '21', '2', '3', '1'];

test('with 256 colours, the issue tag carries a 256-colour code', () => plainEnv(() => {
  const out = tagOf(256, 56);
  assert.ok(code256(out), JSON.stringify(out));
  assert.match(out, /#56\s*\u001b\[39m │/);
}));

test('with 256 colours, six issues in a row get six different readable codes', () => plainEnv(() => {
  for (const start of [54, 55, 60]) {
    const codes = Array.from({ length: 6 }, (_, i) => code256(tagOf(256, start + i)));
    assert.equal(new Set(codes).size, 6, JSON.stringify(codes));
    for (const c of codes) assert.ok(c && !DENY.includes(c), `code ${c} is hard to read or clashes with a tone`);
  }
}));

test('with 16 colours, the issue tag is bold without a colour code', () => plainEnv(() => {
  const out = tagOf(16, 56);
  assert.match(out, /\u001b\[1m#56\s*\u001b\[22m │/);
  assert.doesNotMatch(out, /\u001b\[(3\d|9\d|38;5;\d+)m#56/);
}));

test('without colour, no escape codes at all', () => plainEnv(() => {
  const out = tagOf(0, 56);
  assert.ok(!out.includes('\u001b'), JSON.stringify(out));
  assert.equal(out, `${T}  #56 │ ▶ implement started`);
}));

test('the same issue gets the same code on two screens', () => plainEnv(() => {
  assert.equal(code256(tagOf(256, 57)), code256(tagOf(256, 57)));
  assert.equal(code256(tagOf(256, 57)), code256(tagOf(256, 63)), 'picked by n % 6');
}));
