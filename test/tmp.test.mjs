import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const TEST = dirname(fileURLToPath(import.meta.url));
const HELPER = join(TEST, 'fakes', 'tmp.mjs');

test('a temp folder is gone once the test process exits', () => {
  const code = `import { tempDir } from ${JSON.stringify(HELPER)}; console.log(tempDir('tmp-test-'));`;
  const dir = execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }).trim();
  assert.match(dir, /tmp-test-/);
  assert.equal(existsSync(dir), false);
});

test('a temp folder holding git objects and read-only files is gone too', () => {
  const code = `import { tempDir } from ${JSON.stringify(HELPER)};
    import { execFileSync } from 'node:child_process'; import { writeFileSync, chmodSync } from 'node:fs';
    const d = tempDir('tmp-test-'); execFileSync('git', ['init', '-q', d]);
    writeFileSync(d + '/locked', ''); chmodSync(d + '/locked', 0o444); console.log(d);`;
  const dir = execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }).trim();
  assert.equal(existsSync(dir), false);
});

// Each test folder must come from tempDir, or it stays in /tmp until the next boot.
test('no test makes a temp folder without tempDir', () => {
  const files = readdirSync(TEST, { recursive: true }).map((f) => join(TEST, String(f)))
    .filter((f) => f.endsWith('.mjs') && f !== HELPER && f !== fileURLToPath(import.meta.url));
  const offenders = files.filter((f) => /\bmkdtemp(Sync)?\b/.test(readFileSync(f, 'utf8'))).map((f) => relative(TEST, f));
  assert.deepEqual(offenders, []);
});
