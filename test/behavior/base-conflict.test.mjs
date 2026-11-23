// A retried issue whose branch conflicts with the latest base branch gets a merge session, not a park.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { world } from './world.mjs';
import { ok, gate, clean, implement, settled, factoryComments } from './steps.mjs';

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid'];

test('an issue whose branch conflicts with the base gets a merge session and a pull request', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), { ...implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), output: { status: 'incomplete', summary: 'x', detail: 'not yet' } }]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:needs-human'), 20000, 'the park');
    const parks = factoryComments(w, n).length;

    // Someone else changes the same line on master meanwhile.
    const seed = join(w.dir, 'seed'), git = (...a) => execFileSync('git', ['-C', seed, ...ID, ...a], { encoding: 'utf8' }).trim();
    writeFileSync(join(seed, 'src/a.js'), 'export const a = 3;\n');
    git('add', '-A'); git('commit', '-q', '-m', 'Change a on master'); git('push', '-q', 'origin', 'master');
    const landed = git('rev-parse', 'HEAD');

    w.script(n, [
      { session: 'merge', write: { 'src/a.js': 'export const a = 2;\n' }, commit: 'Merge master', output: ok('Kept the branch') },
      gate(90), { session: 'implement', output: ok('Change a') }, clean,
    ]);
    w.unlabel(n, 'agent:needs-human');
    await w.until(settled(w, n, 'agent:done'), 20000, 'a pull request');
    assert.equal(w.claudeCalls().filter((c) => c.issue === n && c.session === 'merge').length, 1);
    assert.ok(!w.item(n).labels.includes('agent:needs-human'));
    assert.ok(!factoryComments(w, n).slice(parks).some((c) => /needs-human|Merge it by hand|still unresolved/.test(c.body)));
    const branch = `factory/issue-${n}`;
    execFileSync('git', ['--git-dir', w.origin, 'merge-base', '--is-ancestor', landed, branch]); // throws if missing
    assert.ok(w.branch(branch).subjects.includes('Merge master'));
    assert.ok(w.pr());
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
