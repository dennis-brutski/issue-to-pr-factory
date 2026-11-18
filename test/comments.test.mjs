// The factory's own GitHub comments: what one module writes, the same module reads back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopped, didNotStart, explore, rework, pullRequest, isFactory, lastStop, NO_NEW_COMMENTS } from '../lib/comments.mjs';

const OWNER = 'dennis-brutski', T = '2026-11-01T10:00:00Z', T2 = '2026-11-01T11:00:00Z';
const LABEL = 'agent:needs-human';
const c = (body, at = T2, author = OWNER) => ({ author, body, at });

test('the wording of each comment stays word for word', () => {
  assert.equal(stopped('implement', '`npm test` failed', LABEL),
    '🏭 **Factory stopped (implement).**\n\n`npm test` failed\n\nRemove the `agent:needs-human` label to try again.');
  assert.equal(stopped('review', 'RED', LABEL, 'factory/issue-3'),
    "🏭 **Factory stopped (review).**\n\nRED\n\nRemove the `agent:needs-human` label to try again. Work so far is kept on the factory's local branch `factory/issue-3`.");
  assert.equal(didNotStart('issue text was edited after it was approved', LABEL),
    '🏭 **Factory did not start.**\n\nThe issue text was edited after it was approved. Check it, then remove the `agent:needs-human` label to approve it again.');
  assert.equal(explore('Notes', true, false), '🏭 **Factory explore write-up**\n\nNotes\n\nEasy to undo: yes · Small reach: no');
  assert.equal(rework('Renamed a'), '🏭 **Rework**\n\nRenamed a');
  assert.equal(pullRequest('https://github.com/x/y/pull/5'), '🏭 Pull request: https://github.com/x/y/pull/5');
});

test('every comment the factory writes is recognised as its own; others are not', () => {
  for (const body of [stopped('implement', 'x', LABEL), didNotStart('y', LABEL), explore('w', false, true), rework('s'), pullRequest('u')])
    assert.ok(isFactory(body), body);
  assert.equal(isFactory('rename it'), false);
  assert.equal(isFactory('Factory stopped: do X'), false);
});

test('what stopped() writes, lastStop() finds: the newest one since the push', () => {
  const comments = [
    c(stopped('implement', 'old reason', LABEL), '2026-11-01T10:30:00Z'),
    c(stopped('implement', 'RED', LABEL), T2),
    c(pullRequest('https://github.com/x/y/pull/50'), '2026-11-01T12:00:00Z'),
    c(didNotStart('issue text was edited', LABEL), '2026-11-01T12:30:00Z'),
  ];
  assert.equal(lastStop(comments, T, OWNER), stopped('implement', 'RED', LABEL));
  assert.equal(lastStop(comments, '2026-11-01T11:30:00Z', OWNER), '');
  assert.equal(lastStop(comments.slice(0, 1), null, OWNER), stopped('implement', 'old reason', LABEL));
});

test('a "no new comments" stop is skipped', () => {
  const comments = [c(stopped('review', 'could not finish the rework', LABEL), '2026-11-01T10:30:00Z'), c(stopped('review', NO_NEW_COMMENTS, LABEL), T2)];
  assert.equal(lastStop(comments, T, OWNER), stopped('review', 'could not finish the rework', LABEL));
});

test('stop comments by others are ignored; the owner matches in any case', () => {
  assert.equal(lastStop([c(stopped('implement', 'RED', LABEL), T2, 'someone')], T, OWNER), '');
  assert.equal(lastStop([c(stopped('implement', 'RED', LABEL), T2, 'Dennis-Brutski')], T, OWNER), stopped('implement', 'RED', LABEL));
});
