// The prompts name whoever runs the factory, from cfg.ownerName, not a fixed person.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPrompt } from '../lib/stages.mjs';

const vars = { number: 7, branch: 'factory/issue-7', base: 'main', title: 'T', body: 'B', comments: 'C', findings: 'F' };

test('every prompt uses the configured owner name and no other', () => {
  for (const name of ['gate', 'implement', 'review', 'fix', 'rework', 'merge', 'explore']) {
    assert.doesNotMatch(renderPrompt(name, vars, { ownerName: 'Alex' }), /Dennis/, name);
  }
  const implement = renderPrompt('implement', vars, { ownerName: 'Alex' });
  assert.match(implement, /### Comments from Alex\n/);
  assert.match(implement, /Alex has authorised commits/);
  assert.match(renderPrompt('rework', vars, { ownerName: 'Alex' }), /^Alex reviewed this branch/m);
});
test('without an owner name the prompts say "the owner"', () =>
  assert.match(renderPrompt('implement', vars), /### Comments from the owner/));
