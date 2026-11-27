import { test } from 'node:test';
import assert from 'node:assert/strict';
import { same, fence, list } from '../lib/text.mjs';

test('same ignores case', () => assert.equal(same('Dennis', 'dennis'), true));

test('same treats null as empty', () => assert.equal(same(null, ''), true));

test('same tells different logins apart', () => assert.equal(same('dennis', 'denis'), false));

test('fence turns a fence inside the text into quotes', () =>
  assert.equal(fence('a\n```\nb'), "```\na\n'''\nb\n```"));

test('list of nothing is empty', () => assert.equal(list([]), ''));

test('list puts each item on a bullet line', () => assert.equal(list(['a', 'b']), '- a\n- b'));
