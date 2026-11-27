import { test, describe } from 'node:test';
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

test('columns: 100 shows a plain message as time, icon, message', () => noColour(() => {
  const { show } = setup({ columns: 100 });
  assert.equal(show(T, 'stopping'), `${T}  🏭 stopping`);
}));

test('columns: 100 wraps a long plain message, the rest under the text', () => noColour(() => {
  const { show } = setup({ columns: 100 });
  const words = (k) => Array(k).fill('abcdefghi').join(' ');
  assert.equal(show(T, `factory cannot run: ${words(20)}`), [
    `${T}  ✖ factory cannot run: ${words(6)}`,
    `${PAD}  ${words(8)}`,
    `${PAD}  ${words(6)}`,
  ].join('\n'));
}));

test('columns: 100 shows both lines of a two-line plain message', () => noColour(() => {
  const { show } = setup({ columns: 100 });
  assert.equal(show(T, 'factory cannot run: config.mjs is missing\nrun the setup first'),
    `${T}  ✖ factory cannot run: config.mjs is missing\n${PAD}  run the setup first`);
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

test('a run of local sessions shows no cost when done', () => noColour(() => {
  const { show, clock } = setup();
  show(T, '#39 implement started');
  show(T, '#39 implement session ended · 7 turns · 1k in · 18k out · local');
  show(T, '#39 review session ended · 5 turns · local, no token counts');
  clock.set(6000);
  assert.equal(show(T, '#39 implement done'), `${T}  #39 │ ✔ implement done in 6s · 2 sessions`);
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
  assert.equal(show(T, '#39 gate session ended · 4 turns · 6s · ≈ $0.13'), `${T}  #39 │   gate       ·   4 turns ·      6s ·  ≈ $0.13`);
}));

describe('colours', () => {
  const T = '12:00:00';

  // A stream that answers hasColors(depth) like a terminal with `depth` colours (0: no colour).
  function fakeStream(depth) {
    /** @type {PassThrough & { hasColors?: (count?: number) => boolean }} */
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
});

describe('aligned columns', () => {
  const T = '23:45:47';

  const setup = (columns) => screen({ repo: 'o/r', columns, stream: new PassThrough(), now: () => 0 }).bind(null, T);

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
    assert.match(a, / {2}1 turn {2}· /);
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
});

describe('running polls', () => {
  const setup = (columns, pollSec = 300) => screen({ repo: 'o/r', columns, stream: new PassThrough(), now: () => 0, pollSec });

  test('on a terminal, a poll while runs go on says how many and when it looks again', () => noColour(() => {
    const show = setup(100);
    assert.equal(show('02:33:13', '3 running'), '02:33:13  ◦ 3 running · next check at 02:38:13');
  }));

  test('on a terminal, every such poll is shown, since the next check moves on', () => noColour(() => {
    const show = setup(100);
    show('02:33:13', '1 running');
    assert.equal(show('02:38:13', '1 running'), '02:38:13  ◦ 1 running · next check at 02:43:13');
  }));

  test('on a terminal, the plan usage comes after the next check', () => noColour(() => {
    const show = setup(100);
    assert.equal(show('02:33:13', '3 running · plan 5h 54% (resets 02:00) · week 92%'), '02:33:13  ◦ 3 running · next check at 02:38:13 · plan 5h 54% (resets 02:00) · week 92%');
  }));

  test('not on a terminal, a running line with plan usage stays as written', () => noColour(() => {
    const show = setup(undefined);
    assert.equal(show('02:33:13', '3 running · plan 5h 54% · week 92%'), '02:33:13  3 running · plan 5h 54% · week 92%');
  }));

  test('on a terminal, a window at 75% or more is yellow, at 90% or more red', () => withColour(() => {
    const out = setup(100)('02:33:13', '0 eligible · plan 5h 85% · week 92%');
    assert.match(out, /\u001b\[33m5h 85%\u001b\[39m/);
    assert.match(out, /\u001b\[31mweek 92%\u001b\[39m/);
  }));

  test('on a terminal, windows under 75% are neither yellow nor red', () => withColour(() => {
    const out = setup(100)('02:33:13', '3 running · plan 5h 74% · week 18%');
    assert.doesNotMatch(out, /\u001b\[3[13]m/);
    assert.ok(out.includes('5h 74%') && out.includes('week 18%'));
  }));

  test('on a terminal, 90% is red and 75% is yellow', () => withColour(() => {
    const out = setup(100)('02:33:13', '3 running · plan 5h 90% (resets 02:00) · week 75%');
    assert.match(out, /\u001b\[31m5h 90%\u001b\[39m/);
    assert.match(out, /\u001b\[33mweek 75%\u001b\[39m/);
    assert.doesNotMatch(out, /\u001b\[3[13]m[^\u001b]*resets/);
  }));

  test('on a terminal, 5h 75% and week 89% are both yellow', () => withColour(() => {
    const out = setup(100)('02:33:13', '3 running · plan 5h 75% · week 89%');
    assert.match(out, /\u001b\[33m5h 75%\u001b\[39m/);
    assert.match(out, /\u001b\[33mweek 89%\u001b\[39m/);
  }));

  test('on a terminal without colour, a line at 92% has no escape codes', () => noColour(() => {
    const show = setup(100);
    assert.equal(show('02:33:13', '3 running · plan 5h 92% (resets 02:00) · week 92%'), '02:33:13  ◦ 3 running · next check at 02:38:13 · plan 5h 92% (resets 02:00) · week 92%');
    assert.equal(show('02:38:13', '0 eligible · plan 5h 92% · week 92%'), '02:38:13  ◦ waiting for labelled issues · next check at 02:43:13 · plan 5h 92% · week 92%');
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
});

describe('durations', () => {
  const T = '12:00:00';

  function setup(columns) {
    let t = 0;
    const clock = { now: () => t, set: (ms) => { t = ms; } };
    const show = screen({ repo: 'o/r', columns, stream: new PassThrough(), now: clock.now });
    return { show, clock };
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
});

describe('start line title', () => {
  const T = '12:00:00';

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
});

describe('waiting line', () => {
  // A non-terminal stream, so no colour codes; columns tells screen it is drawing for a terminal.
  const setup = (opts = {}) => screen({ repo: 'o/r', columns: 80, pollSec: 300, stream: new PassThrough(), now: () => 0, ...opts });

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

  test('the waiting line shows the plan usage after the next check', () => noColour(() => {
    const show = setup({ columns: 100 });
    assert.equal(show('23:42:26', '0 eligible · plan 5h 54% · week 92%'), '23:42:26  ◦ waiting for labelled issues · next check at 23:47:26 · plan 5h 54% · week 92%');
  }));

  test('a waiting line too long for the terminal is cleared row by row when the next one replaces it', () => noColour(() => {
    const show = setup();
    show('23:42:26', '0 eligible · plan 5h 54% · week 92%'); // 89 characters: two rows at 80 columns
    assert.equal(show('23:47:26', '0 eligible'), '\x1b[1A\x1b[2K\x1b[1A\x1b[2K23:47:26  ◦ waiting for labelled issues · next check at 23:52:26');
  }));

  test('not on a terminal, 0 eligible with plan usage stays as written', () => noColour(() => {
    const show = setup({ columns: undefined });
    assert.equal(show('23:42:26', '0 eligible · plan 5h 54% · week 92%'), '23:42:26  0 eligible · plan 5h 54% · week 92%');
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
});

describe('waiting line updates', () => {
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
    // The terminal wraps the 64-character line over 4 rows of 20; the next one clears all 4.
    assert.equal(line, `${UP.repeat(4)}03:17:29  ◦ waiting for labelled issues · next check at 03:22:29`);
    assert.ok(!line.includes('\n'));
  }));

  test('not a terminal: 0 eligible every poll, no escape codes', () => noColour(() => {
    const show = setup({ columns: undefined });
    assert.equal(show('03:12:29', '0 eligible'), '03:12:29  0 eligible');
    assert.equal(show('03:17:29', '0 eligible'), '03:17:29  0 eligible');
  }));
});
