// How each log message is shown in the terminal. The messages stay as lib/loop.mjs and lib/stages.mjs write them;
// this only decides the look: an issue prefix, a session line when it starts and ends, a run summary, a cut park reason, wrapping.
// Keeps a little state per issue (start time, sessions, cost); no I/O.
import { styleText } from 'node:util';
import { look, paint, logLine } from './look.mjs';
import { duration } from './usage.mjs';

// Picked by issue number, so an issue keeps its colour across restarts. Light 256-colour hues that read on dark and light
// backgrounds and stay clear of the line tones (cyan start, green done, yellow park, red fail). Ordered so that issues
// n, n+1 and n+2 get far apart hues: orange, teal-green, violet, gold, sky, pink.
const HUES = [208, 79, 141, 178, 75, 205];
// For streams that cannot say how many colours they have (not a terminal, colour forced by FORCE_COLOR).
/** @type {import('node:util').InspectColor[]} */
const COLOURS = ['cyan', 'magenta', 'blue', 'cyanBright', 'magentaBright', 'blueBright'];

// The issue tag: a hue with 256 colours, bold with 16, plain without colour.
function tint(n, tag, stream) {
  if (typeof stream?.hasColors !== 'function') return styleText(COLOURS[n % COLOURS.length], tag, { stream });
  if (!stream.hasColors()) return tag;
  if (stream.hasColors(256)) return `\x1b[38;5;${HUES[n % HUES.length]}m${tag}\x1b[39m`;
  return `\x1b[1m${tag}\x1b[22m`;
}
const GAP = ' '.repeat(10); // under "HH:MM:SS  "
const INDENT = '  '; // under the text after the icon
const MORE = 2; // park reason lines shown after the first

// One line → pieces of at most `width` characters, broken at spaces. A word longer than the width stays whole.
function wrap(line, width) {
  if (!width || line.length <= width) return [line];
  const [, lead, body] = line.match(/^(\s*)(.*)$/s);
  const room = Math.max(width - lead.length, 10);
  const pieces = [];
  let cur = '';
  for (const word of body.split(/ +/)) {
    if (cur && cur.length + 1 + word.length > room) { pieces.push(cur); cur = word; } else cur = cur ? `${cur} ${word}` : word;
  }
  pieces.push(cur);
  return pieces.map((p) => lead + p);
}

const plural = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;

// "HH:MM:SS" plus some seconds, as "HH:MM:SS"; wraps past midnight.
function later(time, sec) {
  const [h, m, s] = time.split(':').map(Number);
  const t = (h * 3600 + m * 60 + s + sec) % 86400;
  return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map((x) => String(x).padStart(2, '0')).join(':');
}

// On a terminal, durations read easier with a space: "1m 55s", "1h 03m". Logs piped to a file keep "1m55s".
const spaced = (text) => text.replace(/\b(\d+)m(\d{2})s\b/g, '$1m $2s').replace(/\b(\d+)h(\d{2})m\b/g, '$1h $2m');

// On a terminal, each part of a session's usage gets a fixed width, so the numbers line up from line to line.
// A part that matches no rule stays as it is.
/** @type {[RegExp, (m: RegExpMatchArray) => string][]} */
const COLUMNS = [
  [/^(\d+) (turns?)$/, ([, n, w]) => `${n.padStart(3)} ${w.padEnd(5)}`],
  [/^started$/, ([s]) => s.padStart(9)], // in the turns column
  [/^\d+[hms]( \d+[ms])?$/, ([t]) => t.padStart(7)],
  [/^(\S+) in \((\d+)% cached\)$/, ([, n, p]) => `${n.padStart(5)} in ${' '.repeat(Math.max(3 - p.length, 0))}(${p}% cached)`],
  [/^(\S+) in$/, ([, n]) => `${n.padStart(5)} in`],
  [/^\S+ out$/, ([o]) => o.padStart(8)],
  [/^≈ \$\S+$/, ([c]) => c.padStart(8)],
];
const column = (part) => {
  for (const [re, fit] of COLUMNS) {
    const m = part.match(re);
    if (m) return fit(m);
  }
  return part;
};
const columned = (text) => text.split(' · ').map(column).join(' · ');

// How full a plan window looks on a terminal. Claude Code's /usage draws every bar in one colour, so these are the factory's own.
const PLAN_TONES = [[90, 'red'], [75, 'yellow']];
const planTone = (pct) => PLAN_TONES.find(([at]) => pct >= at)?.[1] ?? 'dim';

// A check line: dim, but each plan window ("5h 92%", "week 92%") in the tone for how much of it is used.
function checkLine(text, plan, stream) {
  let out = paint(text, 'dim', stream), last = 0;
  if (!plan) return out;
  for (const m of plan.matchAll(/\b(?:5h|week) (\d+)%/g)) {
    out += paint(plan.slice(last, m.index), 'dim', stream) + paint(m[0], planTone(Number(m[1])), stream);
    last = m.index + m[0].length;
  }
  return out + paint(plan.slice(last), 'dim', stream);
}

/**
 * The terminal view of the log: one call per log line, returns what to print.
 * @param {{ repo: string, columns: number | undefined, stream: NodeJS.WritableStream & { hasColors?: (count?: number) => boolean },
 *   now?: () => number, pollSec?: number }} opts no columns: plain lines, no layout; no pollSec: no next check time
 * @returns {(time: string, msg: string) => string}
 */
export function screen({ repo, columns, stream, now = Date.now, pollSec }) {
  const runs = new Map(); // issue number → { start, sessions, cost } since its last "<stage> started"
  let waiting = 0; // rows the waiting line took when it is the last thing shown; the next one clears them
  let numWidth = 3; // "#39"; grows for longer numbers so the bars line up

  // The time, the icon and the text; continuation lines go under the text.
  const lines = (time, lead, icon, tone, texts, room) => {
    const out = [];
    texts.forEach((text, i) => {
      wrap(text, room).forEach((piece, j) => {
        const first = i === 0 && j === 0;
        const head = first ? `${paint(time, 'dim', stream)}  ${lead}${icon ? `${icon} ` : ''}` : `${GAP}${lead}${INDENT}`;
        out.push(head + paint(piece, tone, stream));
      });
    });
    return out.join('\n');
  };

  return function show(time, msg) {
    msg = String(msg);
    // On a terminal, say what the factory waits for. Piped logs keep "0 eligible": tests and grep count it.
    if (columns !== undefined) {
      // A check line may end with the plan usage (" · plan …"); it goes after the next check.
      const check = msg.match(/^(0 eligible|\d+ running)( · plan .*)?$/);
      const next = pollSec ? ` · next check at ${later(time, pollSec)}` : '';
      if (check?.[1] === '0 eligible') {
        // Right after the last waiting line: cursor up and clear each row it took, so one line shows the latest check.
        const up = '\x1b[1A\x1b[2K'.repeat(waiting);
        const text = `◦ waiting for labelled issues${next}`;
        waiting = Math.max(1, Math.ceil((time.length + 2 + text.length + (check[2] ?? '').length) / columns));
        return `${up}${paint(time, 'dim', stream)}  ${checkLine(text, check[2], stream)}`;
      }
      waiting = 0;
      // A poll while runs go on: shown every time, since the next check moves on.
      if (check) return `${paint(time, 'dim', stream)}  ${checkLine(`◦ ${check[1]}${next}`, check[2], stream)}`;
    }
    const { icon, tone } = look(msg);
    const m = msg.match(/^#(\d+) (.*)$/s);
    if (!m) {
      if (columns === undefined) return logLine(time, msg, stream);
      return lines(time, '', icon, tone, msg.split('\n'), columns - GAP.length - INDENT.length);
    }
    const n = Number(m[1]);
    let [first, ...details] = m[2].split('\n');
    details = details.map((d) => d.replace(/^ {10}/, '')); // lib/loop.mjs indents details by 10

    const started = first.match(/^(\S+) session started$/);
    const ended = started ? null : first.match(/^(\S+) session ended(?: · (.*))?$/);
    const session = started ?? ended;
    if (started) {
      first = `${started[1].padEnd(10)} · ${columns === undefined ? 'started' : column('started')}`; // shows what is running right now
    } else if (ended) {
      const [, name, used] = ended;
      const run = runs.get(n);
      if (run) {
        run.sessions += 1;
        const cost = used?.match(/≈ \$(\d+(?:\.\d+)?)/);
        if (cost) run.cost += Number(cost[1]); else run.costKnown = false;
      }
      if (columns === undefined) first = used ? `${name.padEnd(10)} · ${used}` : name;
      else first = `${name.padEnd(10)}${used ? ` · ${columned(spaced(used))}` : ''}`;
    } else if (/^\S+ started( on PR #\d+)?( \(.*\))?$/.test(first)) {
      runs.set(n, { start: now(), sessions: 0, cost: 0, costKnown: true });
    }

    const done = first.match(/^(\S+) done(?:: (.*))?$/);
    if (done) {
      const run = runs.get(n);
      runs.delete(n);
      const parts = [];
      if (run) {
        parts.push(`in ${duration(now() - run.start)}`);
        if (run.sessions) parts.push(plural(run.sessions, 'session'));
        if (run.sessions && run.costKnown) parts.push(`≈ $${run.cost.toFixed(2)}`);
      }
      first = `${done[1]} done${parts.length ? ` ${parts.join(' · ')}` : ''}${done[2] !== undefined ? `: ${done[2]}` : ''}`;
    }

    if (columns !== undefined) [first, ...details] = [first, ...details].map(spaced);

    numWidth = Math.max(numWidth, m[1].length + 1);
    const tag = `#${n}`.padEnd(numWidth);
    // Worked out from the plain prefix: the coloured one holds escape codes that take no room on screen.
    const room = columns === undefined ? undefined : columns - GAP.length - `${tag} │ `.length - INDENT.length;
    let wrapAt = room;

    if (/^(\S+ )?parked: /.test(first)) {
      // Cut by lines on screen: one long reason paragraph wraps into many.
      const texts = [first, ...details.filter((d) => d.trim())];
      const pieces = texts.flatMap((t) => wrap(t, room));
      if (pieces.length > 1 + MORE) {
        const kept = texts.flatMap((t) => wrap(t, room && room - 2)).slice(0, 1 + MORE); // room for " …"
        kept[MORE] += ' …';
        [first, ...details] = [...kept, `full text: https://github.com/${repo}/issues/${n}`];
        wrapAt = undefined; // already wrapped; the link stays on one line
      }
    }

    // On a terminal, session lines start where the text after a run's ▶/✔ starts.
    if (session && columns !== undefined) first = `  ${first}`;
    const lead = `${tint(n, tag, stream)} │ `;
    return lines(time, lead, session ? '' : icon, tone, [first, ...details], wrapAt);
  };
}
