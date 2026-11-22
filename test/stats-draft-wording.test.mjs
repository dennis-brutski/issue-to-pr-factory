// Stats counts draft stops by their new wording as well as the old.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopLabel } from '../stats.mjs';
import { stopped, reasons } from '../lib/comments.mjs';

const list = '- existing test changed (M): test/readme.test.mjs';

test('a stop comment with the new draft wording counts as protected files (draft)', () => {
  const bodies = [
    stopped('implement', reasons.draft('https://github.com/x/y/pull/90', list), 'agent:needs-human', 'factory/issue-88'),
    stopped('review', reasons.reworkDraft(list), 'agent:needs-human'),
    stopped('merge', reasons.mergeDraft(list), 'agent:needs-human'),
  ];
  for (const body of bodies) {
    assert.doesNotMatch(body, /touches protected files/);
    assert.equal(stopLabel(body), 'protected files (draft)');
  }
});
