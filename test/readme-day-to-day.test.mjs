import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const README = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md'), 'utf8');
const gettingStarted = README.slice(README.indexOf('\n## Getting started\n'), README.indexOf('\n## Use\n'));

test('Getting started keeps the day-to-day advice', () => {
  assert.match(gettingStarted, /Day to day:/);
  assert.match(gettingStarted, /as clearly as for a colleague/);
  assert.match(gettingStarted, /`agent:explore` when unsure/);
  assert.match(gettingStarted, /pull request \(`agent:done`\) or a stop \(`agent:needs-human`/);
});
