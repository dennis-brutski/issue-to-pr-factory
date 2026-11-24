import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driftWarnings, pollText } from '../lib/startup.mjs';

const cfg = { target: 'demo', baseBranch: 'main', testDirs: ['test/', 'spec/'], protectedFiles: ['package.json', 'Makefile'], protectedDirs: ['gradle/'] };

test('driftWarnings names each configured path missing on the base branch', () => {
  const on = new Set(['test/', 'package.json']);
  assert.deepEqual(driftWarnings(cfg, (p) => on.has(p)), [
    '`spec/` is in targets/demo.mjs but not on main — update the target file',
    '`Makefile` is in targets/demo.mjs but not on main — update the target file',
    '`gradle/` is in targets/demo.mjs but not on main — update the target file',
  ]);
});
test('driftWarnings never warns about the built-in protected paths', () => {
  assert.deepEqual(driftWarnings({ target: 'demo', baseBranch: 'main' }, () => false), []);
});

test('whole minutes are shown in minutes', () => {
  assert.equal(pollText(300), '5 min');
  assert.equal(pollText(60), '1 min');
  assert.equal(pollText(3600), '60 min');
});

test('under a minute is shown in seconds', () => {
  assert.equal(pollText(30), '30s');
  assert.equal(pollText(1), '1s');
});

test('minutes and seconds are written like the session lines', () => {
  assert.equal(pollText(90), '1m 30s');
});
