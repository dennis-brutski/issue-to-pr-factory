#!/usr/bin/env node
// Draws the branch coverage badge for the README, in the look of GitHub's own CI badge,
// so the two sit side by side. CI runs it: node badge.mjs 98.76 > coverage.svg
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = 'branch coverage';
const LABEL_WIDTH = 93; // DejaVu Sans at 11px
const PAD = 5;
// shortcut: widths only for the characters a percentage has; add more if the badge ever shows text.
const CHAR_WIDTH = { '.': 3.5, '%': 10.5 }; // digits are 7
const textWidth = (text) => [...text].reduce((sum, c) => sum + (CHAR_WIDTH[c] ?? 7), 0);

const gradient = (id, top, bottom) =>
  `<linearGradient id="${id}" x1="50%" y1="0%" x2="50%" y2="100%"><stop stop-color="${top}" offset="0%"/><stop stop-color="${bottom}" offset="100%"/></linearGradient>`;
const text = (x, length, words) =>
  `<text x="${x}" y="15" fill="#010101" fill-opacity=".3" textLength="${length}" aria-hidden="true">${words}</text>` +
  `<text x="${x}" y="14" fill="#FFFFFF" textLength="${length}">${words}</text>`;

/**
 * Draw the branch coverage badge.
 * @param {string} branches the branch coverage, such as '98.76'
 * @returns {string} the badge as an SVG document
 * @throws when branches is not a plain number, so nothing else lands in the SVG
 */
export function coverageBadge(branches) {
  if (!/^[0-9]+(\.[0-9]+)?$/.test(branches)) throw new Error(`branch coverage is not a number: '${branches}'`);
  const value = `${branches}%`, valueWidth = textWidth(value);
  const left = LABEL_WIDTH + 2 * PAD, right = valueWidth + 2 * PAD, width = left + right;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${LABEL}: ${value}">` +
    `<title>${LABEL}: ${value}</title>` +
    `<defs>${gradient('label-fill', '#444D56', '#24292E')}${gradient('value-fill', '#34D058', '#28A745')}` +
    `<clipPath id="round"><rect width="${width}" height="20" rx="3"/></clipPath></defs>` +
    `<g clip-path="url(#round)"><rect width="${left}" height="20" fill="url(#label-fill)"/>` +
    `<rect x="${left}" width="${right}" height="20" fill="url(#value-fill)"/></g>` +
    `<g font-family="'DejaVu Sans',Verdana,Geneva,sans-serif" font-size="11">` +
    `${text(PAD, LABEL_WIDTH, LABEL)}${text(left + PAD, valueWidth, value)}</g></svg>\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(coverageBadge(process.argv[2] ?? '')); }
  catch (e) { console.error(`badge cannot be made: ${e.message}`); process.exitCode = 1; }
}
