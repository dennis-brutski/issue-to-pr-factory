// How a log line looks in the terminal: an icon and a colour picked from its text.
// styleText leaves colours out when the stream is not a terminal or NO_COLOR is set; icons stay.
import { styleText } from 'node:util';

// Each rule matches only the start of the line, so free text after "parked:" or "done:" cannot change the look.
// First match wins; the order matters ("session started" before "started").
/** @type {[RegExp, string, string][]} */
const RULES = [
  [/^(factory started\b|stopping$|stopped$)/, '🏭', 'bold'],
  [/^warning: /, '⚠', 'yellow'],
  [/^(#\d+ )?could not |^#\d+ \S+ (crashed|failed): |^factory cannot run: /, '✖', 'red'],
  [/^#\d+ \S+ session (started|ended)\b/, '·', 'dim'],
  [/^#\d+ (\S+ )?parked: /, '⏸', 'yellow'],
  [/^#\d+ re-queued\b/, '↻', 'yellow'],
  [/^#\d+ \S+ done(:|$)|^#\d+ finished; worktree removed$/, '✔', 'green'],
  [/^#\d+ \S+ started( on PR #\d+)?( \(.*\))?$/, '▶', 'cyan'], // the title is in brackets
];

export function look(msg) {
  const first = String(msg).split('\n')[0];
  for (const [re, icon, tone] of RULES) if (re.test(first)) return { icon, tone };
  return { icon: '', tone: 'plain' };
}

// A run that ends with a draft pull request is done; the lines that say why it is a draft are a warning.
const DRAFT_DONE = /^#\d+ \S+ done: \S+\n\s*draft: /;

/**
 * The colour of a log line's detail lines: the first line's, but yellow under a done line for a draft pull request.
 * @param {string} msg
 * @returns {string}
 */
export function detailTone(msg) {
  return DRAFT_DONE.test(String(msg)) ? 'yellow' : look(msg).tone;
}

export function paint(line, tone, stream) {
  return tone === 'plain' || !line ? line : styleText(tone, line, { stream });
}

// "HH:MM:SS  <icon> #<n> message": time dim, issue number bold, the rest in the line's tone.
export function logLine(time, msg, stream) {
  const { icon, tone } = look(msg);
  const below = detailTone(msg);
  const [first, ...details] = String(msg).split('\n');
  const [, num = '', rest = first] = first.match(/^(#\d+)(.*)$/s) ?? [];
  const head = (num ? styleText('bold', num, { stream }) : '') + paint(rest, tone, stream);
  const lead = `${paint(time, 'dim', stream)}  ${icon ? `${paint(icon, tone, stream)} ` : ''}`;
  return [lead + head, ...details.map((d) => paint(d, below, stream))].join('\n');
}
