import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protectedPathViolations as check, attributionViolations, workflowChanges, additionsOnly, skippedTests, strayDotfiles } from '../lib/brakes.mjs';
import scorePad from './fixtures/web-app-target.mjs';

// The web app target: its protections must stay exactly what they were.
const protectedPathViolations = (changes) => check(changes, scorePad);

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

test('built-in protected paths cannot be removed by a target', () => {
  const cfg = { protectedFiles: [], protectedDirs: [], testDirs: [] };
  assert.equal(check([{ status: 'M', path: 'AGENTS.md' }, { status: 'M', path: '.claude/x' }, { status: 'A', path: '.github/x.yml' }, { status: 'M', path: 'CLAUDE.md' }], cfg).length, 4);
});
test('target lists add to the built-ins', () => {
  assert.equal(check([{ status: 'M', path: 'Makefile' }], { protectedFiles: ['Makefile'] }).length, 1);
  assert.equal(check([{ status: 'M', path: 'gradle/x' }], { protectedDirs: ['gradle/'] }).length, 1);
  assert.equal(check([{ status: 'M', path: 'Makefile' }], {}).length, 0);
});
test('test folders come from the target', () => {
  assert.equal(check([{ status: 'M', path: 'spec/a.js' }], { testDirs: ['spec/'] }).length, 1);
  assert.equal(check([{ status: 'M', path: 'spec/a.js' }], { testDirs: ['test/'] }).length, 0);
});
test('workflowChanges finds added, changed, deleted and renamed workflows', () => {
  assert.deepEqual(workflowChanges([
    { status: 'A', path: '.github/workflows/a.yml' }, { status: 'M', path: '.github/workflows/b.yml' },
    { status: 'D', path: '.github/workflows/c.yml' }, { status: 'R', oldPath: '.github/x.yml', path: '.github/workflows/d.yml' },
    { status: 'R', oldPath: '.github/workflows/e.yml', path: 'old/e.yml' }, { status: 'M', path: '.github/CODEOWNERS' },
  ]), ['.github/workflows/a.yml', '.github/workflows/b.yml', '.github/workflows/c.yml', '.github/workflows/d.yml', '.github/workflows/e.yml']);
});

const head = 'diff --git a/f.mjs b/f.mjs\nindex 1..2 100644\n--- a/f.mjs\n+++ b/f.mjs\n';

test('a diff that only adds lines is additions only', () => {
  assert.equal(additionsOnly(`${head}@@ -1,2 +1,3 @@\n a\n+b\n c\n`), true);
});
test('a removed line is not additions only', () => {
  assert.equal(additionsOnly(`${head}@@ -1,2 +1,2 @@\n a\n-b\n+c\n`), false);
});
test('a removed line that starts with "--" is still a removed line', () => {
  assert.equal(additionsOnly(`${head}@@ -1,2 +1,1 @@\n a\n---i;\n`), false);
});
test('a change with no text hunk (binary, mode only, or empty) is not additions only', () => {
  assert.equal(additionsOnly(`${head.replace(/--- .*\n\+\+\+ .*\n/, '')}Binary files a/f.mjs and b/f.mjs differ\n`), false);
  assert.equal(additionsOnly(''), false);
});

const diff = (...added) => ['diff --git a/test/x.test.mjs b/test/x.test.mjs', '+++ b/test/x.test.mjs', ...added.map((l) => `+${l}`)].join('\n');

test('added skip, only and todo calls are flagged', () => {
  for (const line of ["test.skip('x', () => {})", "it.only('x', () => {})", "describe.todo('x')", "xit('x', () => {})", "test('x', { skip: true }, () => {})", '@pytest.mark.skip'])
    assert.equal(skippedTests(diff(line)).length, 1, line);
});

test('removed or unchanged lines and plain tests are clean', () => {
  assert.deepEqual(skippedTests("-test.skip('x', () => {})\n test.only('y')"), []);
  assert.deepEqual(skippedTests(diff("test('skips nothing', () => {})", 'const only = 1;')), []);
});

test('each finding quotes the line', () =>
  assert.match(skippedTests(diff("it.only('focus', () => {})"))[0], /test skipped or singled out: it\.only\('focus'/));

test('skips inside string literals are test data, not skips', () => {
  assert.deepEqual(skippedTests(diff(
    `await commit(dir, { 'test/b.test.mjs': "test.skip('b', () => {})\\n" });`,
    "const fixture = 'it.only(\"x\")';",
    'const t = `describe.todo(\'y\')`;',
  )), []);
});

test('a real skip next to a string is still flagged', () => {
  assert.equal(skippedTests(diff("test.skip('has a \"quoted\" name', () => {})", "test('x', { skip: 'needs bwrap' }, () => {})")).length, 2);
});

test('a commit adding a home dotfile at the root is refused', () => {
  assert.deepEqual(strayDotfiles([{ status: 'A', path: '.bashrc' }]), ['.bashrc']);
  assert.deepEqual(strayDotfiles([{ status: 'A', path: '.profile' }]), ['.profile']);
});
test('a commit adding a file in an editor or agent folder at the root is refused', () => {
  const changes = ['.claude/settings.json', '.idea/workspace.xml', '.vscode/settings.json', '.config/gh/hosts.yml'].map((path) => ({ status: 'A', path }));
  assert.deepEqual(strayDotfiles(changes), ['.claude/settings.json', '.idea/workspace.xml', '.vscode/settings.json', '.config/gh/hosts.yml']);
});
test('a rename onto a dotfile counts as adding it', () => {
  assert.deepEqual(strayDotfiles([{ status: 'R', oldPath: 'notes.txt', path: '.zshrc' }]), ['.zshrc']);
});
test('changing an already-tracked dotfile is allowed', () => {
  assert.deepEqual(strayDotfiles([{ status: 'M', path: '.gitignore' }, { status: 'M', path: '.vscode/settings.json' }, { status: 'D', path: '.bashrc' }]), []);
});
test('dotfiles below the root and ordinary project dotfiles are allowed', () => {
  const changes = ['src/.bashrc', 'docs/.idea/x', '.gitignore', '.editorconfig', '.nvmrc'].map((path) => ({ status: 'A', path }));
  assert.deepEqual(strayDotfiles(changes), []);
});
