// The auto-merge comments: written and read back by lib/comments.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoMerged, autoMergeFailed, autoMergedPull, isFactory } from '../lib/comments.mjs';

const URL = 'https://github.com/x/y/pull/50';

test('the wording of the auto-merge comments stays word for word', () => {
  assert.equal(autoMerged(URL, { reviewed: 'clean', lines: 40 }),
    `🏭 **Auto-merge**\n\n${URL} was handed to auto-merge: simple · review clean · 40 lines changed · not a draft. GitHub merges it once it can; revert it if you do not like it.`);
  assert.equal(autoMerged(URL, { reviewed: 'clean after fix', lines: 1 }),
    `🏭 **Auto-merge**\n\n${URL} was handed to auto-merge: simple · review clean after fix · 1 line changed · not a draft. GitHub merges it once it can; revert it if you do not like it.`);
  assert.equal(autoMergeFailed(URL, 'gh pr merge failed: not allowed'),
    `🏭 **Auto-merge did not start**\n\nGitHub refused auto-merge for ${URL}:\n\n\`\`\`\ngh pr merge failed: not allowed\n\`\`\`\n\nMerge it by hand.`);
});

test('the auto-merge comments are recognised as the factory\'s own', () => {
  for (const body of [autoMerged(URL, { reviewed: 'clean', lines: 3 }), autoMergeFailed(URL, 'x')]) assert.ok(isFactory(body), body);
});

test('autoMergedPull reads the pull request number back, only from an Auto-merge comment', () => {
  assert.equal(autoMergedPull(autoMerged(URL, { reviewed: 'clean', lines: 3 })), 50);
  assert.equal(autoMergedPull(autoMergeFailed(URL, 'x')), null);
  assert.equal(autoMergedPull(`🏭 Pull request: ${URL}`), null);
  assert.equal(autoMergedPull(`please do 🏭 **Auto-merge**\n\n${URL}`), null);
});
