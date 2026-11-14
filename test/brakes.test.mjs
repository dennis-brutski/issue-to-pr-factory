import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protectedPathViolations, attributionViolations } from '../lib/brakes.mjs';

test('adding a test file is clean', () =>
  assert.deepEqual(protectedPathViolations([{ status: 'A', path: 'test/unit/new.test.js' }]), []));
test('adding an e2e spec is clean', () =>
  assert.deepEqual(protectedPathViolations([{ status: 'A', path: 'e2e/new.spec.js' }]), []));
test('modifying an existing test is a violation', () =>
  assert.equal(protectedPathViolations([{ status: 'M', path: 'test/unit/scoring.test.js' }]).length, 1));
test('deleting an e2e spec is a violation', () =>
  assert.equal(protectedPathViolations([{ status: 'D', path: 'e2e/game.spec.js' }]).length, 1));
test('rename of an existing test is a violation', () =>
  assert.equal(protectedPathViolations([{ status: 'R', oldPath: 'test/unit/stats.test.js', path: 'src/x.js' }]).length, 1));
test('renaming a source file into the test folder is clean', () =>
  assert.deepEqual(protectedPathViolations([{ status: 'R', oldPath: 'src/a.js', path: 'test/unit/a.test.js' }]), []));
test('workflow, config and manifest changes are violations', () => {
  for (const path of ['.github/workflows/ci.yml', 'playwright.config.js', 'package.json', 'package-lock.json', 'AGENTS.md', 'CLAUDE.md', '.claude/settings.json'])
    for (const status of ['A', 'M', 'D'])
      assert.equal(protectedPathViolations([{ status, path }]).length, 1, `${status} ${path}`);
});
test('renaming a protected file away is a violation', () =>
  assert.equal(protectedPathViolations([{ status: 'R', oldPath: 'playwright.config.js', path: 'pw.js' }]).length, 1));
test('ordinary source changes are clean', () =>
  assert.deepEqual(protectedPathViolations([{ status: 'M', path: 'src/state.js' }, { status: 'A', path: 'src/new.js' }]), []));
test('a file merely named like a protected one elsewhere is clean', () =>
  assert.deepEqual(protectedPathViolations([{ status: 'A', path: 'src/package.json.js' }, { status: 'M', path: 'src/test/helper.js' }]), []));
test('each violation names the file', () =>
  assert.match(protectedPathViolations([{ status: 'M', path: 'test/unit/scoring.test.js' }])[0], /test\/unit\/scoring\.test\.js/));
test('attribution lines are flagged', () => {
  assert.equal(attributionViolations(['Fix x\n\nCo-Authored-By: Claude <noreply@anthropic.com>']).length, 1);
  assert.equal(attributionViolations(['Fix x\n\n🤖 Generated with Claude Code']).length, 1);
  assert.equal(attributionViolations(['Fix x\n\nClaude-Session: https://claude.ai/code/session_1']).length, 1);
  assert.deepEqual(attributionViolations(['Fix undo on empty ledger']), []);
});
