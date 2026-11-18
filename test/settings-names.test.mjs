import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { targetNames } from '../lib/settings.mjs';

test('targetNames lists targets/*.mjs by name, in name order', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'factory-names-')), 'targets');
  mkdirSync(dir);
  for (const f of ['two.mjs', 'one.mjs', 'notes.txt']) writeFileSync(join(dir, f), '');
  assert.deepEqual(targetNames(dir), ['one', 'two']);
});
test('targetNames of a missing folder is empty', () => {
  assert.deepEqual(targetNames(join(mkdtempSync(join(tmpdir(), 'factory-names-')), 'targets')), []);
});
