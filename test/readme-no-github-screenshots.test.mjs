import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const README = readFileSync(join(root, 'README.md'), 'utf8');
const section = (heading) => {
  const start = README.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, heading);
  const end = README.indexOf('\n## ', start + 1);
  return README.slice(start, end < 0 ? undefined : end);
};

test('the three GitHub screenshots are gone from the README and docs/img/', () => {
  for (const name of ['pull-request', 'stop-comment', 'explore-writeup']) {
    assert.doesNotMatch(README, new RegExp(`docs/img/${name}\\.png`), name);
    assert.equal(existsSync(join(root, 'docs', 'img', `${name}.png`)), false, name);
  }
  for (const name of ['terminal-run', 'stats'])
    assert.ok(existsSync(join(root, 'docs', 'img', `${name}.png`)), name);
});

test('Getting started says in one sentence what setup and checks may reach', () => {
  const start = section('Getting started');
  assert.doesNotMatch(start, /score pad's target/);
  assert.match(start, /^   Setup has network, checks have none[^.\n]*--ignore-scripts[^.\n]*\.$/m);
});

test('Use keeps the target choice and the lock in one sentence', () => {
  const use = section('Use');
  const line = use.split('\n').find((l) => l.includes('factory.lock'));
  assert.ok(line, 'lock line');
  assert.match(line, /choose a target/);
  assert.match(line, /already running/);
  assert.equal((use.match(/^- /gm) ?? []).length, 3);
});

test('Testing the factory leaves the sandbox note to AGENTS.md', () => {
  assert.doesNotMatch(section('Testing the factory'), /inside an agent sandbox \(no nested bwrap/);
});

test('Use says the target choice and the lock in one short sentence', () => {
  const line = section('Use').split('\n').find((l) => l.includes('factory.lock'));
  assert.ok(line, 'lock line');
  for (const part of ['choose a target', 'already running (pid <n>)', 'runs/<target>/factory.lock', 'died'])
    assert.ok(line.includes(part), part);
  assert.equal((line.match(/[.!?](\s|$)/g) ?? []).length, 1, line);
  assert.ok(line.length <= 200, `${line.length} characters`);
});

test('the Polling, Conflicts, Worktree, Setup and Port bullets are one line each', () => {
  const run = section('How a run works').split('\n');
  for (const name of ['Polling:', 'Conflicts:', 'Worktree:', 'Setup**', 'Port:']) {
    const at = run.findIndex((l) => l.startsWith(`- **${name}`));
    assert.ok(at >= 0, name);
    assert.match(run[at + 1], /^- \*\*/, `${name} is followed by the next bullet`);
  }
  const polling = run.find((l) => l.startsWith('- **Polling:'));
  assert.match(polling, /`pollSec`/);
  assert.match(polling, /`maxParallel`/);
});

test('the Git itself bullet has two sentences and keeps what it guards', () => {
  const line = section('Confinement and brakes').split('\n').find((l) => l.includes('**Git itself:**'));
  assert.ok(line, 'Git itself line');
  assert.equal((line.match(/[.!?](\s|$)/g) ?? []).length, 2, line);
  for (const part of ['.git/config', '`origin`', 'replace refs and grafts'])
    assert.ok(line.includes(part), part);
});
