// A target with autoMerge on: a simple, cleanly reviewed issue ends handed to GitHub's auto-merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { world } from './world.mjs';
import { clean, implement, factoryComments, settled } from './steps.mjs';
import { tempDir } from '../fakes/tmp.mjs';

const simpleGate = { session: 'gate', output: { confidence: 90, questions: [], difficulty: 'simple', files: ['src/a.js'] } };

// Auto-merge needs held-out checks; these pass, kept outside the world's run folder.
function heldOut() {
  const dir = tempDir('factory-held-out-');
  writeFileSync(join(dir, 'ok.test.mjs'), "import { test } from 'node:test';\ntest('held out', () => {});\n");
  return { dir, settings: { heldOutDir: dir, heldOutChecks: [['node', ['--test', '{heldOut}/ok.test.mjs']]] } };
}

test('a simple issue on an autoMerge target is handed to auto-merge', async () => {
  const held = heldOut();
  const w = await world({ settings: { autoMerge: true, ...held.settings } });
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [simpleGate, implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:done'), 20000, 'agent:done without agent:in-progress');
    const pr = w.pr();
    const merges = w.state().calls.filter((c) => c[0] === 'pr' && c[1] === 'merge');
    assert.deepEqual(merges, [['pr', 'merge', String(pr.number), '--repo', 'dennis-brutski/demo', '--squash', '--auto']]);
    assert.equal(pr.autoMerge, 'squash');
    assert.ok(factoryComments(w, n).some((c) => c.body.startsWith('🏭 **Auto-merge**\n')));
    await w.until(() => /handed to auto-merge/.test(f.output()), 5000, 'the log line');
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); rmSync(held.dir, { recursive: true, force: true }); }
});

test('without autoMerge the same issue is not merged', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [simpleGate, implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:done'), 20000, 'agent:done without agent:in-progress');
    assert.ok(!w.state().calls.some((c) => c[0] === 'pr' && (c[1] === 'merge' || c[1] === 'view')));
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
