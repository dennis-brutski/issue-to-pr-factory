// Git honours replace refs and grafts when it reads objects, and both live in the
// git data agents write to. They must not make a workflow change invisible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { gate, clean, implement, factoryComments, settled } from './steps.mjs';

test('a session that plants a replace ref for the base commit still cannot push a workflow change', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    // The base commit is swapped for a child of the branch head with the same files,
    // so base...HEAD looks empty to a git that honours the replace ref.
    const hide = [['commit', '-q', '--allow-empty', '-m', 'x'], ['replace', '-f', 'origin/master', 'HEAD'], ['reset', '-q', '--hard', 'HEAD~1']];
    w.script(n, [gate(90), { ...implement({ '.github/workflows/ci.yml': 'on: push\n' }, 'Add CI'), git: hide }, clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:needs-human'), 20000, 'agent:needs-human');
    assert.equal(w.branch(`factory/issue-${n}`), null);
    assert.equal(w.pr(), undefined);
    assert.match(factoryComments(w, n).at(-1).body, /\.github\/workflows\/ci\.yml/);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
