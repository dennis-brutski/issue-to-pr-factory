import { test } from 'node:test';
import assert from 'node:assert/strict';
import { look } from '../lib/look.mjs';

// Park reasons and done summaries are free text; words like "could not" in them must not turn the line red.
const cases = [
  ['#12 implement parked: The agent could not finish:\n\nno tests', '⏸', 'yellow'],
  ['#12 implement parked: The agent could not fix the review findings:\n\nx', '⏸', 'yellow'],
  ['#12 rework parked: The agent could not finish the rework:\n\nx', '⏸', 'yellow'],
  ['#12 implement parked: The implement step failed: the agent session failed: x', '⏸', 'yellow'],
  ['#12 implement parked: A held-out check failed: `npm test`. Its output is in the factory\'s terminal', '⏸', 'yellow'],
  ['#12 rework done: could not reproduce the crashed: case', '✔', 'green'],
  ['#12 re-queued after the run failed: boom', '↻', 'yellow'],
];

for (const [msg, icon, tone] of cases) {
  test(`look keeps the tone of the status, not the reason: ${msg.split('\n')[0]}`, () => {
    assert.deepEqual(look(msg), { icon, tone });
  });
}

test('look keeps a park yellow when its reason says the session ended', () => {
  const msg = '#12 implement parked: The implement step failed: the agent session ended without the required status report';
  assert.deepEqual(look(msg), { icon: '⏸', tone: 'yellow' });
});
