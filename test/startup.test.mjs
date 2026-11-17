import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { driftWarnings, oldLayoutWarning } from '../lib/startup.mjs';

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
test('oldLayoutWarning spots a single-target clone at the factory root', () => {
  const root = mkdtempSync(join(tmpdir(), 'old-'));
  assert.equal(oldLayoutWarning(root), null);
  mkdirSync(join(root, 'repo', '.git'), { recursive: true });
  assert.match(oldLayoutWarning(root), /old single-target clone is at .*\/repo — see "Moving to runs\/" in the README/);
});
