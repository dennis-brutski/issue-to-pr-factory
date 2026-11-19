import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('explore, merge and fix name the skills that fit them', () => {
  const want = {
    explore: ['systematic-debugging'],
    merge: ['verification-before-completion'],
    fix: ['receiving-code-review'],
  };
  for (const [p, names] of Object.entries(want))
    for (const n of names) assert.match(read(`prompts/${p}.md`), new RegExp(`factory:${n}\\b`), `${p}.md names ${n}`);
});

test('explore and merge say what to do when a skill says to ask', () => {
  for (const p of ['explore', 'merge']) assert.match(read(`prompts/${p}.md`), /cannot ask/, `${p}.md`);
});

test('explore answers skill questions and permissions in writeup', () => {
  const t = read('prompts/explore.md');
  assert.match(t, /cannot ask.*`writeup`/);
  assert.match(t, /permission.*use your judgement.*`writeup`/s);
  assert.match(t, /write a test or change code, describe it in `writeup` instead/);
});

test('merge lets the agent decide where a skill asks for permission', () => {
  assert.match(read('prompts/merge.md'), /permission.*use your judgement.*`summary`/s);
});

test('explore and merge keep their session marker as the first line', () => {
  for (const p of ['explore', 'merge'])
    assert.equal(read(`prompts/${p}.md`).split('\n')[0], `<!-- session: ${p} -->`);
});
