import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollText } from '../lib/startup.mjs';

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
