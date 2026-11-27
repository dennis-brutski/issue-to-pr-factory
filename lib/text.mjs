// Small text helpers the factory's modules share. Pure: no I/O.
import { secretViolations } from './brakes.mjs';

/**
 * Compares two logins or repo names without regard to case.
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b null and undefined count as ''.
 * @returns {boolean}
 */
export const same = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();

/**
 * Wraps text in a Markdown code fence. A fence inside the text becomes ''' so it cannot close this one.
 * @param {unknown} text
 * @returns {string}
 */
export const fence = (text) => '```\n' + String(text).replaceAll('```', "'''") + '\n```';

/**
 * One Markdown bullet line per item.
 * @param {unknown[]} items
 * @returns {string} '' when there are no items.
 */
export const list = (items) => items.map((v) => `- ${v}`).join('\n');

const REMOVED = '(removed: looks like a secret)';
const ZW = '​'; // zero-width space: GitHub shows the text but links nothing
const isSecret = (text) => secretViolations([], [text]).length > 0;
// A word that looks like a secret; a line still holding one (a key header has spaces) goes whole.
const noSecrets = (line) => {
  const words = line.replace(/\S+/g, (w) => (isSecret(w) ? REMOVED : w));
  return isSecret(words) ? REMOVED : words;
};
const CLOSING = /\b((?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+)((?:[\w.-]+\/[\w.-]+)?#\d|https?:\/\/)/gi;

/**
 * Agent text made safe to post in a comment or pull request body. Agents can be steered by issue text,
 * so their text must not fetch images, notify people, close issues or carry secrets.
 * Secrets become "(removed: looks like a secret)", images show as text, `@login` and `Fixes #n` are
 * broken with a zero-width space, and a lone carriage return becomes a line break.
 * @param {unknown} text null and undefined count as ''.
 * @returns {string}
 */
export function agentText(text) {
  return String(text ?? '').replace(/\r(?!\n)/g, '\n')
    .split('\n').map(noSecrets).join('\n')
    .replaceAll('![', '!\\[')
    .replace(/<(?=\/?(?:img|picture|source|video|audio|svg|image)\b)/gi, '&lt;')
    .replace(/(?<![\w.@])@(?=[A-Za-z0-9])/g, `@${ZW}`)
    .replace(CLOSING, (_, keyword, ref) => {
      const at = ref.indexOf('#');
      return at < 0 ? `${keyword}${ZW}${ref}` : `${keyword}${ref.slice(0, at)}${ZW}${ref.slice(at)}`;
    });
}
