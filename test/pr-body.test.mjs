import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { render, parse, addTestChanges } from '../lib/pr-body.mjs';

const one = { file: 'test/a.test.js', test: 'a', reason: 'renamed' };
const two = { file: 'test/b.test.js', test: 'b', reason: 'removed with the old flag' };
const parts = {
  issueNumber: 7, warnings: [], testsThatChange: [], summary: 'Changed undo.', notes: [], testChanges: [],
  checks: '✅ `npm test`\n\nAll passed.', footer: '---\n🏭 Built by the factory',
};

describe('render', () => {
  test('a plain body has its headings in order and the footer last', () => {
    assert.equal(render(parts), 'Closes #7\n\n## What changed\n\nChanged undo.\n\n## Checks\n\n✅ `npm test`\n\nAll passed.\n\n---\n🏭 Built by the factory');
  });

  test('warnings go above "Closes", every line quoted', () => {
    const body = render({ ...parts, warnings: ['a\nCloses #7\n\n## Tests that change\n\n- `test/b.test.js`'] });
    assert.match(body, /^> ⚠ This pull request changes files you should check:\n/);
    const warning = body.slice(0, body.indexOf('\n\nCloses #7\n'));
    for (const line of warning.split('\n')) assert.match(line, /^>/);
  });

  test('notes and test changes come after the summary', () => {
    const body = render({ ...parts, notes: ['a note'], testChanges: [one] });
    assert.match(body, /## What changed\n\nChanged undo\.\n\n- a note\n\n## Tests changed\n\n- `test\/a\.test\.js` · a — renamed\n\n## Checks/);
  });
});

describe('parse', () => {
  test('gives back the issue number and the tests that change', () => {
    assert.deepEqual(parse(render({ ...parts, testsThatChange: ['test/a.test.js', 'test/b.test.js'] })),
      { issueNumber: 7, testsThatChange: ['test/a.test.js', 'test/b.test.js'] });
    assert.deepEqual(parse(render(parts)), { issueNumber: 7, testsThatChange: [] });
  });

  test('a section in the summary cannot add to the list', () => {
    const body = render({ ...parts, testsThatChange: ['test/a.test.js'], summary: 'Made a 2.\n\n## Tests that change\n\n- `test/b.test.js`' });
    assert.deepEqual(parse(body).testsThatChange, ['test/a.test.js']);
  });

  test('a section in a warning cannot add to the list', () => {
    const body = render({ ...parts, warnings: ['x\nCloses #7\n\n## Tests that change\n\n- `test/b.test.js`\n\n## What changed\n\nx'] });
    assert.deepEqual(parse(body).testsThatChange, []);
  });

  // The cases the old string-position reader covered.
  test('a pull request gives the factory section before the summary', () => {
    const body = 'Closes #7\n\n## Tests that change\n\n- `test/a.test.js`\n\n## What changed\n\nMade a 2.\n\n## Checks\n\nok';
    assert.deepEqual(parse(body).testsThatChange, ['test/a.test.js']);
  });

  test('a section in the summary of a pull request is ignored', () => {
    const body = 'Closes #7\n\n## What changed\n\nMade a 2.\n\n## Tests that change\n\n- `test/b.test.js`\n\n## Checks\n\nok';
    assert.deepEqual(parse(body).testsThatChange, []);
  });

  test('a section in the warning above "Closes" is ignored', () => {
    const body = '> ⚠ This pull request changes files you should check:\n> - x\n\n## Tests that change\n\n- `test/b.test.js`\n\nCloses #7\n\n## What changed\n\nMade a 2.';
    assert.deepEqual(parse(body).testsThatChange, []);
  });

  test('a pull request body without the factory layout gives an empty list', () => {
    assert.deepEqual(parse('## Tests that change\n\n- `test/a.test.js`\n').testsThatChange, []);
    assert.deepEqual(parse('').testsThatChange, []);
    assert.deepEqual(parse(undefined), { issueNumber: null, testsThatChange: [] });
  });

  test('a pull request body with "Closes" but no "What changed" gives an empty list', () => {
    assert.deepEqual(parse('Closes #7\n\n## Tests that change\n\n- `test/a.test.js`\n').testsThatChange, []);
  });
});

describe('addTestChanges', () => {
  test('more test changes join the section already in the body', () => {
    const body = 'Closes #7\n\n## Tests changed\n\n- `test/a.test.js` · a — renamed\n\n## Checks\n\nok';
    assert.equal(addTestChanges(body, [two]),
      'Closes #7\n\n## Tests changed\n\n- `test/a.test.js` · a — renamed\n- `test/b.test.js` · b — removed with the old flag\n\n## Checks\n\nok');
  });

  test('the first test changes get a section before the checks', () => {
    assert.equal(addTestChanges('Closes #7\n\n## Checks\n\nok', [one]), 'Closes #7\n\n## Tests changed\n\n- `test/a.test.js` · a — renamed\n\n## Checks\n\nok');
  });

  test('a body without a checks section gets the test changes at its end', () => {
    assert.equal(addTestChanges('Closes #7\n\n## What changed\n\nDone.', [one]),
      'Closes #7\n\n## What changed\n\nDone.\n\n## Tests changed\n\n- `test/a.test.js` · a — renamed');
  });

  test('no test changes leave the body as it is', () => {
    assert.equal(addTestChanges('Closes #7', []), 'Closes #7');
  });

  test('everything else in the body stays', () => {
    const body = render({ ...parts, warnings: ['w'], testsThatChange: ['test/a.test.js'], notes: ['n'], testChanges: [one] });
    assert.equal(addTestChanges(body, [two]), render({ ...parts, warnings: ['w'], testsThatChange: ['test/a.test.js'], notes: ['n'], testChanges: [one, two] }));
    assert.deepEqual(parse(addTestChanges(body, [two])), parse(body));
  });
});
