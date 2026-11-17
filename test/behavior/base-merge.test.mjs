// A retried run works on the latest base branch, not the one it first started from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { world } from './world.mjs';
import { ok, gate, clean, implement, settled } from './steps.mjs';

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid'];

test('a retried run brings the latest base branch into its pushed branch', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), { ...implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), output: { status: 'incomplete', summary: 'x', detail: 'not yet' } }]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:needs-human'), 20000, 'the park');

    // Someone else lands a commit on master meanwhile.
    const seed = join(w.dir, 'seed'), git = (...a) => execFileSync('git', ['-C', seed, ...ID, ...a], { encoding: 'utf8' }).trim();
    writeFileSync(join(seed, 'src/b.js'), 'export const b = 1;\n');
    git('add', '-A'); git('commit', '-q', '-m', 'Add b on master'); git('push', '-q', 'origin', 'master');
    const landed = git('rev-parse', 'HEAD');

    w.script(n, [gate(90), { session: 'implement', output: ok('Change a') }, clean]);
    w.unlabel(n, 'agent:needs-human');
    await w.until(settled(w, n, 'agent:done'), 20000, 'a pull request');
    const branch = `factory/issue-${n}`;
    execFileSync('git', ['--git-dir', w.origin, 'merge-base', '--is-ancestor', landed, branch]); // throws if missing
    assert.ok(w.branch(branch).subjects.includes('Change a'));
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
