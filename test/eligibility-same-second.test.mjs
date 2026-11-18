// GitHub times have whole seconds: an edit in the same second as the approval may
// have come after it, so it counts as after. On doubt, park.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../lib/eligibility.mjs';
import { config } from '../config.mjs';

const T = '2026-11-01T10:00:00Z';
const issue = (o) => ({ number: 1, kind: 'issue', title: 't', body: 'b', author: 'someone', bodyEditedAt: null, labels: ['agent:implement'],
  labelEvents: [{ label: 'agent:implement', actor: config.owner, at: T }], comments: [], renames: [], headRef: null, headRepo: null, ...o });

test('a rename by someone else in the same second as the approval parks', () =>
  assert.equal(classify(issue({ renames: [{ actor: 'mallory', at: T }] }), config).action, 'park'));

test('a body edit in the same second as the approval parks', () =>
  assert.equal(classify(issue({ bodyEditedAt: T }), config).action, 'park'));

test('edits before the approval still run', () =>
  assert.equal(classify(issue({ bodyEditedAt: '2026-11-01T09:59:59Z', renames: [{ actor: 'mallory', at: '2026-11-01T09:59:59Z' }] }), config).action, 'run'));
