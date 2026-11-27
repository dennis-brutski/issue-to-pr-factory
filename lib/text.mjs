// Small text helpers the factory's modules share. Pure: no I/O.

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
