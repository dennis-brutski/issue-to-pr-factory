// The pull request says how it was built.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { world } from './world.mjs';
import { gate, clean, implement, settled } from './steps.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const commit = () => { try { return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } };

test('the pull request ends with the factory commit, model, gate score and log folder', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(91), implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:done'), 20000, 'agent:done without agent:in-progress');
    const last = w.pr().body.trimEnd().split('\n').at(-1);
    assert.match(last, new RegExp(`^🏭 Built by issue-to-pr-factory ${commit()} · model \\S+ · gate confidence 91 · checks: .+ · session logs: runs/[^/]+/logs/issue-${n}/$`));
    assert.match(w.pr().body, /\n---\n🏭 Built by/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
