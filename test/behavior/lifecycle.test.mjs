// Stopping, restarting, cleaning up, and one factory at a time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { world } from './world.mjs';
import { ok, gate, clean, implement, polls, settled, toPullRequest } from './steps.mjs';

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

test('Ctrl-C twice kills the agent; a restart resumes in the same worktree', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), { session: 'implement', placeholders: true, hang: true, output: ok('x') }]);
    let f = w.start();
    await w.until(() => w.claudeCalls().some((c) => c.session === 'implement'), 20000, 'the implement session');
    f.signal('SIGINT');
    await w.until(() => f.output().includes('Ctrl-C again'), 5000, 'the first Ctrl-C');
    f.signal('SIGINT');
    assert.equal(await f.exited, 130);
    const hung = w.claudeCalls().find((c) => c.session === 'implement');
    await w.until(() => !alive(hung.pid), 5000, 'the agent to die');
    assert.ok(w.item(n).labels.includes('agent:in-progress'));

    w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 9;\n' }, 'Change a'), clean]);
    f = w.start();
    await w.until(settled(w, n, 'agent:done'), 20000, 'a pull request after restart');
    assert.match(f.output(), /re-queued after an interrupted run/);
    const cwds = w.claudeCalls().filter((c) => c.session === 'implement').map((c) => c.cwd);
    assert.equal(cwds.length, 2);
    assert.equal(cwds[0], cwds[1]);
    const files = w.branch(`factory/issue-${n}`).files;
    assert.ok(!files.includes('.bashrc') && !files.includes('.claude/settings.json'), files.join(', '));
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test("a merged pull request's worktree is removed", async () => {
  const w = await world();
  try {
    const [n, p, f] = await toPullRequest(w);
    const dir = join(w.runDir, 'worktrees', `issue-${n}`);
    assert.ok(existsSync(dir));
    w.merge(p);
    await w.until(() => new RegExp(`#${n} +(?:│ ✔ )?finished; worktree removed`).test(f.output()), 10000, 'the cleanup');
    assert.ok(!existsSync(dir));
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('a second start is refused', async () => {
  const w = await world();
  try {
    const f = w.start();
    await w.until(() => polls(f) >= 1, 10000, 'a poll');
    const second = w.start();
    assert.equal(await second.exited, 1);
    assert.match(second.output(), /already running/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('two targets run side by side', async () => {
  const a = await world({ name: 'demo-a' }), b = await world({ name: 'demo-b' });
  try {
    const fa = a.start(), fb = b.start();
    await a.until(() => polls(fa) >= 1 && polls(fb) >= 1, 10000, 'both to poll');
    assert.match(fa.output(), /\(demo-a\)/);
    assert.match(fb.output(), /\(demo-b\)/);
    assert.ok(existsSync(join(a.runDir, 'factory.lock')) && existsSync(join(b.runDir, 'factory.lock')));
    fa.signal('SIGINT'); await fa.exited;
    const seen = polls(fb);
    await b.until(() => polls(fb) >= seen + 1, 10000, 'b to keep polling');
    fb.signal('SIGINT'); await fb.exited;
  } finally { a.close(); b.close(); }
});
