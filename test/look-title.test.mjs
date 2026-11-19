import { test } from 'node:test';
import assert from 'node:assert/strict';
import { look } from '../lib/look.mjs';

test('a start line with a title is ▶ cyan', () => {
  assert.deepEqual(look('#12 implement started (Fix the bug)'), { icon: '▶', tone: 'cyan' });
});

test('a start line without a title still looks the same', () => {
  assert.deepEqual(look('#12 implement started'), { icon: '▶', tone: 'cyan' });
});

test('a title cannot change the look', () => {
  assert.deepEqual(look('#12 implement started (Make it started)'), { icon: '▶', tone: 'cyan' });
  assert.deepEqual(look('#12 implement started (parked: oops)'), { icon: '▶', tone: 'cyan' });
  assert.deepEqual(look('#12 implement started (done)'), { icon: '▶', tone: 'cyan' });
});

test('text after started that is not a title is not a start line', () => {
  assert.deepEqual(look('#12 implement started later'), { icon: '', tone: 'plain' });
});
