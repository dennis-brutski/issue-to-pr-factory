// Held-out checks run in a throwaway copy of the worktree (ADR 0009): what they write, the held-out
// tests themselves included, never stays where the next session can read it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { world } from './world.mjs';
import { gate, clean, implement, settled, polls } from './steps.mjs';
import { tempDir } from '../fakes/tmp.mjs';

// The fake bwrap ignores binds, so this needs the real one.
const bwrapWorks = (() => { try { execFileSync('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-net', 'true'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const real = { skip: bwrapWorks ? false : 'bwrap probe failed on this machine' };

test('held-out checks that copy their tests into an ignored folder and edit a tracked file leave the worktree as it was', real, async () => {
  const held = tempDir('factory-held-out-');
  writeFileSync(join(held, 'ok.test.mjs'), "import { test } from 'node:test';\ntest('held out', () => {});\n");
  const leak = 'mkdir -p node_modules/.cache/x && cp {heldOut}/ok.test.mjs node_modules/.cache/x/ && echo leaked > src/a.js && echo n > new.txt';
  const w = await world({ settings: { heldOutDir: held, heldOutChecks: [['sh', ['-c', leak]], ['node', ['--test', '{heldOut}/ok.test.mjs']]] } });
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:done'), 20000, 'agent:done without agent:in-progress');
    const dir = join(w.runDir, 'worktrees', `issue-${n}`);
    assert.ok(!existsSync(join(dir, 'node_modules', '.cache', 'x')), 'the held-out tests stayed in an ignored folder');
    assert.ok(!existsSync(join(dir, 'new.txt')));
    assert.equal(readFileSync(join(dir, 'src', 'a.js'), 'utf8'), 'export const a = 2;\n');
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('at startup the factory deletes the copies a killed run left next to the run folder', async () => {
  const w = await world();
  try {
    const leftover = join(dirname(w.runDir), `.${basename(w.runDir)}-copies`, 'factory-copy-old');
    mkdirSync(join(leftover, 'node_modules', '.cache', 'x'), { recursive: true });
    writeFileSync(join(leftover, 'node_modules', '.cache', 'x', 'held.test.mjs'), 'secret\n');
    const f = w.start();
    await w.until(() => polls(f) >= 1, 10000, 'a poll');
    assert.ok(!existsSync(leftover), 'the leftover copy is still there');
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
