import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { coverageBadge } from '../badge.mjs';

const script = fileURLToPath(new URL('../badge.mjs', import.meta.url));
const width = (svg) => Number(/<svg[^>]* width="([\d.]+)"/.exec(svg)[1]);

test('the badge says branch coverage and the percentage', () => {
  const svg = coverageBadge('98.76');
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, /<title>branch coverage: 98.76%<\/title>/);
  assert.match(svg, />branch coverage</);
  assert.match(svg, />98.76%</);
});

test('the badge has the colours of GitHub\'s CI badge', () => {
  const svg = coverageBadge('98.76');
  for (const colour of ['#444D56', '#24292E', '#34D058', '#28A745']) assert.ok(svg.includes(colour), colour);
});

test('the badge text has one light shadow, like GitHub\'s, and no blurred one', () => {
  const svg = coverageBadge('98.76');
  assert.equal(svg.match(/fill-opacity=".3"/g).length, 2);
  assert.doesNotMatch(svg, /blur|filter/);
});

test('a longer percentage makes a wider badge', () => {
  assert.ok(width(coverageBadge('100')) < width(coverageBadge('98.76')));
  assert.ok(width(coverageBadge('9.5')) < width(coverageBadge('100')));
});

test('anything but a number is refused', () => {
  for (const bad of ['', '98%', 'abc', '1<script>']) assert.throws(() => coverageBadge(bad), /not a number/, bad);
});

test('run as a script, it prints the badge', () => {
  assert.equal(execFileSync(process.execPath, [script, '98.76'], { encoding: 'utf8' }), coverageBadge('98.76'));
});

test('run as a script with a bad number, it fails and says why', () => {
  const r = spawnSync(process.execPath, [script, 'abc'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /badge cannot be made: branch coverage is not a number: 'abc'/);
  assert.equal(r.stdout, '');
});
