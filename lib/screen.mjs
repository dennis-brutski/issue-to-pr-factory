// How each log message is shown in the terminal. The messages stay as lib/loop.mjs and lib/stages.mjs write them;
// this only decides the look: an issue prefix, a session line when it starts and ends, a run summary, a cut park reason, wrapping.
// Keeps a little state per issue (start time, sessions, cost); no I/O.
import { styleText } from 'node:util';
import { look, paint, logLine } from './look.mjs';
import { duration } from './usage.mjs';

// Picked by issue number, so an issue keeps its colour across restarts. Green, yellow and red mean done, parked, failed.
const COLOURS = ['cyan', 'magenta', 'blue', 'cyanBright', 'magentaBright', 'blueBright'];
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

// On a terminal, durations read easier with a space: "1m 55s", "1h 03m". Logs piped to a file keep "1m55s".
const spaced = (text) => text.replace(/\b(\d+)m(\d{2})s\b/g, '$1m $2s').replace(/\b(\d+)h(\d{2})m\b/g, '$1h $2m');

export function screen({ repo, columns, stream, now = Date.now }) {
  const runs = new Map(); // issue number → { start, sessions, cost } since its last "<stage> started"
  let numWidth = 3; // "#39"; grows for longer numbers so the bars line up

  // The time, the icon and the text; continuation lines go under the text.
  const lines = (time, lead, icon, tone, texts, room) => {
    const out = [];
    texts.forEach((text, i) => wrap(text, room).forEach((piece, j) => {
      const first = i === 0 && j === 0;
      const head = first ? `${paint(time, 'dim', stream)}  ${lead}${icon ? `${icon} ` : ''}` : `${GAP}${lead}${INDENT}`;
      out.push(head + paint(piece, tone, stream));
    }));
    return out.join('\n');
  };

  return function show(time, msg) {
    msg = String(msg);
    const { icon, tone } = look(msg);
    const m = msg.match(/^#(\d+) (.*)$/s);
    if (!m) {
      if (columns === undefined) return logLine(time, msg, stream);
      return lines(time, '', icon, tone, msg.split('\n'), columns - GAP.length - INDENT.length);
    }
    const n = Number(m[1]);
    let [first, ...details] = m[2].split('\n');
    details = details.map((d) => d.replace(/^ {10}/, '')); // lib/loop.mjs indents details by 10

    let session;
    if ((session = first.match(/^(\S+) session started$/))) {
      first = `${session[1].padEnd(10)} · started`; // shows what is running right now
    } else if ((session = first.match(/^(\S+) session ended(?: · (.*))?$/))) {
      const [, name, used] = session;
      const run = runs.get(n);
      if (run) {
        run.sessions += 1;
        const cost = used?.match(/≈ \$(\d+(?:\.\d+)?)/);
        if (cost) run.cost += Number(cost[1]); else run.costKnown = false;
      }
      first = used ? `${name.padEnd(10)} · ${used}` : name;
    } else if (/^\S+ started$/.test(first)) {
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

    const lead = `${styleText(COLOURS[n % COLOURS.length], tag, { stream })} │ `;
    return lines(time, lead, session ? '' : icon, tone, [first, ...details], wrapAt);
  };
}
