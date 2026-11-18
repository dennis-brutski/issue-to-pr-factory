// Which model writes the first draft: a cheaper one only for simple issues away from protected files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import factory from '../targets/issue-to-pr-factory.mjs';
import { implementModel } from '../lib/stages.mjs';

const cfg = { ...factory, model: 'opus', simpleModel: 'sonnet' };
const simple = { confidence: 90, questions: [], difficulty: 'simple', files: ['lib/look.mjs', 'prompts/look.md'] };

test('a simple issue away from protected files gets simpleModel', () => {
  assert.equal(implementModel(simple, cfg, { lastStop: '' }), 'sonnet');
  assert.equal(implementModel(simple, cfg), 'sonnet');
});

test('a simple issue that touches a protected file gets model', () => {
  assert.equal(implementModel({ ...simple, files: ['lib/look.mjs', 'lib/agent.mjs'] }, cfg, { lastStop: '' }), 'opus');
});

test('a re-run after a stop gets model', () => {
  assert.equal(implementModel(simple, cfg, { lastStop: 'The implement step failed: timeout' }), 'opus');
});

test('normal and hard issues get model', () => {
  for (const difficulty of ['normal', 'hard'])
    assert.equal(implementModel({ ...simple, difficulty }, cfg, { lastStop: '' }), 'opus');
});

test('a missing or unknown difficulty gets model', () => {
  const { difficulty, ...old } = simple;
  assert.equal(implementModel(old, cfg, { lastStop: '' }), 'opus');
  assert.equal(implementModel({ confidence: 90, questions: [] }, cfg, { lastStop: '' }), 'opus');
  assert.equal(implementModel({ ...simple, difficulty: 'easy' }, cfg, { lastStop: '' }), 'opus');
});

test('without simpleModel every issue gets model', () => {
  for (const simpleModel of [undefined, null, ''])
    assert.equal(implementModel(simple, { ...cfg, simpleModel }, { lastStop: '' }), 'opus');
});
