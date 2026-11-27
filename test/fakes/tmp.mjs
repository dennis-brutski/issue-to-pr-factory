// Temp folders for tests. Each one is deleted when the test file's process exits
// (node --test runs every file in its own process), so /tmp does not fill up.
// shortcut: a process killed with SIGKILL skips the cleanup; its folders stay until the next boot.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const made = [];
process.once('exit', () => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

/**
 * Make a new folder in the system temp dir, deleted when this process exits.
 * @param {string} prefix
 * @returns {string} the folder's path
 */
export function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}
