// The existing tests a session changed: in the work answer, the prompts and the pull request body.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPrompt, schemas, withTestChanges } from '../lib/stages.mjs';

const vars = { number: 7, branch: 'factory/issue-7', base: 'main', title: 'T', body: 'B', comments: 'C', findings: 'F', since: null };
const one = { file: 'test/a.test.js', test: 'a', reason: 'renamed' };
const two = { file: 'test/b.test.js', test: 'b', reason: 'removed with the old flag' };

test('the work answer asks for the changed tests', () => {
  assert.ok(schemas.work.required.includes('test_changes'));
  assert.deepEqual(schemas.work.properties.test_changes.items.required, ['file', 'test', 'reason']);
});

for (const name of ['implement', 'fix', 'rework']) {
  test(`the ${name} prompt asks for each changed or deleted test`, () => {
    assert.match(renderPrompt(name, vars, {}), /`test_changes`: one entry per existing test you changed or deleted/);
  });
}

test('more test changes join the section already in the body', () => {
  const body = 'Closes #7\n\n## Tests changed\n\n- `test/a.test.js` · a — renamed\n\n## Checks\n\nok';
  assert.equal(withTestChanges(body, [two]),
    'Closes #7\n\n## Tests changed\n\n- `test/a.test.js` · a — renamed\n- `test/b.test.js` · b — removed with the old flag\n\n## Checks\n\nok');
});

test('the first test changes get a section before the checks', () => {
  assert.equal(withTestChanges('Closes #7\n\n## Checks\n\nok', [one]), 'Closes #7\n\n## Tests changed\n\n- `test/a.test.js` · a — renamed\n\n## Checks\n\nok');
});

test('no test changes leave the body as it is', () => {
  assert.equal(withTestChanges('Closes #7', []), 'Closes #7');
});
