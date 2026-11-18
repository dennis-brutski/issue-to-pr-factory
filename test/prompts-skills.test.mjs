import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('each code prompt names its skills', () => {
  const want = {
    implement: ['test-driven-development', 'verification-before-completion'],
    fix: ['systematic-debugging', 'verification-before-completion'],
    rework: ['receiving-code-review', 'systematic-debugging', 'verification-before-completion'],
  };
  for (const [p, names] of Object.entries(want))
    for (const n of names) assert.match(read(`prompts/${p}.md`), new RegExp(`factory:${n}\\b`), `${p}.md names ${n}`);
});

test('every skill a prompt names is vendored', () => {
  for (const f of readdirSync(join(root, 'prompts')))
    for (const [, name] of read(`prompts/${f}`).matchAll(/factory:([a-z-]+)/g))
      assert.ok(existsSync(join(root, 'skills', 'skills', name, 'SKILL.md')), `${f} names factory:${name}, which is not in skills/`);
});

test('code prompts say what to do when a skill says to ask', () => {
  for (const p of ['implement', 'fix', 'rework']) assert.match(read(`prompts/${p}.md`), /cannot ask/);
});

test('review prompt stays without skills', () => assert.ok(!read('prompts/review.md').includes('factory:')));

test('code prompts let the agent decide where a skill asks for permission', () => {
  for (const p of ['implement', 'fix', 'rework'])
    assert.match(read(`prompts/${p}.md`), /permission.*use your judgement.*`summary`/s, `${p}.md`);
});
