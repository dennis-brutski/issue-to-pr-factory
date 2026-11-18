// Setup has network: it must not run on a branch that already changes protected files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { world } from './world.mjs';
import { gate, factoryComments, settled } from './steps.mjs';

test('a branch that changed a protected file in an earlier run parks before setup', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    const lock = JSON.stringify({ name: 'demo', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'demo', version: '1.0.1' } } }, null, 2) + '\n';
    // Run 1 commits a lockfile change, then stops for another reason.
    w.script(n, [gate(90), { session: 'implement', write: { 'package-lock.json': lock }, commit: 'Bump the lockfile', output: { status: 'incomplete', summary: 'Stuck', detail: 'Ran out of ideas' } }]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:needs-human'), 20000, 'the first park');
    assert.match(factoryComments(w, n).at(-1).body, /Ran out of ideas/);

    // npm ci's prepare script makes node_modules: gone now, it shows whether setup runs again.
    const dir = join(w.runDir, 'worktrees', `issue-${n}`);
    assert.ok(existsSync(join(dir, 'node_modules')), 'setup ran in run 1');
    rmSync(join(dir, 'node_modules'), { recursive: true, force: true });
    const calls = w.claudeCalls().length;

    w.unlabel(n, 'agent:needs-human');
    await w.until(() => factoryComments(w, n).length === 2 && settled(w, n, 'agent:needs-human')(), 20000, 'the second park');
    const park = factoryComments(w, n).at(-1).body;
    assert.match(park, /The branch changes protected files, so the factory did not run setup with network on it:\n- protected file changed: package-lock\.json\n/);
    assert.ok(park.includes(`Review them in \`${dir}\`; to go ahead, merge or revert them, then remove the label.`));
    assert.ok(!existsSync(join(dir, 'node_modules')), 'setup did not run in run 2');
    assert.equal(w.claudeCalls().length, calls, 'no agent session in run 2');
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
