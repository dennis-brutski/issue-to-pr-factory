import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const README = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md'), 'utf8');
const mermaid = [...README.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);

test('the first diagram runs top-down so GitHub\'s zoom buttons sit over empty space', () => {
  assert.match(mermaid[0], /^flowchart TD\n/);
});
