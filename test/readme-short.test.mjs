import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const README = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md'), 'utf8');
const section = (heading) => {
  const start = README.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, heading);
  const end = README.indexOf('\n## ', start + 1);
  return README.slice(start, end < 0 ? undefined : end);
};
const count = (text, re) => (text.match(re) ?? []).length;

test('the README is at most 290 lines', () => {
  const lines = README.split('\n').length - (README.endsWith('\n') ? 1 : 0);
  assert.ok(lines <= 290, `${lines} lines`);
});

test('the terminal screenshot has no text stand-in any more', () => {
  assert.doesNotMatch(README, /Until the screenshot is there/);
  assert.doesNotMatch(README, /```text/);
});

test('the gate is explained only under How a run works', () => {
  assert.equal(count(README, /scores how clear the issue is/g), 0);
  assert.equal(count(README, /from 0 to 100/g), 1);
  assert.match(section('How a run works'), /from 0 to 100/);
});

test('the auto-merge rules are written out only under How a run works', () => {
  assert.equal(count(README, /gh pr merge --squash --auto/g), 1);
  assert.match(section('How a run works'), /gh pr merge --squash --auto/);
  assert.doesNotMatch(README.slice(0, README.indexOf('## A day with the factory')), /small, simple, cleanly reviewed/);
});

test('the brakes are listed only under Confinement and brakes', () => {
  assert.doesNotMatch(section('How a run works'), /Changed workflow files stop the push/);
  assert.match(section('How a run works'), /\*\*Brakes:\*\*.*Confinement and brakes/);
  const brakes = section('Confinement and brakes');
  for (const part of ['attribution lines', 'Co-Authored-By', 'testSupport', '.only', 'draft', 'git ls-remote'])
    assert.ok(brakes.includes(part), part);
});

test('the label state diagram and the two stopping words are gone', () => {
  assert.doesNotMatch(README, /stateDiagram-v2/);
  assert.doesNotMatch(README, /Two words for two kinds of stopping/);
  assert.doesNotMatch(section('Use'), /A day with the factory/);
});

test('Statistics says what it prints in a few sentences', () => {
  const stats = section('Statistics');
  assert.match(stats, /only reads from GitHub/);
  assert.match(stats, /`other:`/);
  assert.doesNotMatch(stats, /Revert "<title>"/);
});

test('the pull request screenshot sits under How a run works, the others by the stop table', () => {
  assert.match(section('How a run works'), /docs\/img\/pull-request\.png/);
  const stops = section('When it stops (`agent:needs-human`)');
  assert.match(stops, /docs\/img\/stop-comment\.png/);
  assert.match(stops, /docs\/img\/explore-writeup\.png/);
  assert.doesNotMatch(stops, /docs\/img\/pull-request\.png/);
});
