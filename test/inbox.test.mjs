// inbox.mjs: the factory's open stops, as JSON for the /factory-inbox skill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopped, didNotStart, NO_NEW_COMMENTS, newestPark } from '../lib/comments.mjs';

const NH = 'agent:needs-human';
const c = (author, body, at) => ({ author, body, at });

test('newestPark picks the newest stop and its stage', () => {
  const comments = [
    c('me', stopped('gate', 'The issue is not clear enough to build without guessing.', NH), '2026-11-01T10:00:00Z'),
    c('me', stopped('implement', 'The agent could not finish.', NH), '2026-11-02T10:00:00Z'),
  ];
  const park = newestPark(comments, 'me');
  assert.equal(park.stage, 'implement');
  assert.equal(park.at, '2026-11-02T10:00:00Z');
  assert.equal(park.body, comments[1].body);
});

test('newestPark counts a no-new-comments stop', () => {
  const comments = [c('me', stopped('review', NO_NEW_COMMENTS, NH), '2026-11-03T10:00:00Z')];
  assert.equal(newestPark(comments, 'Me')?.stage, 'review');
});

test('newestPark returns a did-not-start park with no stage', () => {
  const comments = [c('me', didNotStart('issue was edited after it was approved', NH), '2026-11-03T10:00:00Z')];
  const park = newestPark(comments, 'me');
  assert.equal(park.stage, null);
  assert.equal(park.at, '2026-11-03T10:00:00Z');
});

test('newestPark ignores 🏭 comments by others and plain owner comments', () => {
  const comments = [
    c('someone', stopped('gate', 'Fake.', NH), '2026-11-03T10:00:00Z'),
    c('me', 'Please try again.', '2026-11-04T10:00:00Z'),
  ];
  assert.equal(newestPark(comments, 'me'), null);
});
