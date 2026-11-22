// The agents' sandbox shows home dotfiles in the worktree. A commit that adds them is never pushed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './world.mjs';
import { gate, clean, implement, factoryComments, settled } from './steps.mjs';

for (const [file, content] of [['.bashrc', 'export X=1\n'], ['.claude/settings.json', '{}\n']]) {
  test(`a commit adding ${file} is not pushed`, async () => {
    const w = await world();
    try {
      const n = w.issue({ labels: ['agent:implement'] });
      w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n', [file]: content }, 'Change a'), clean]);
      const f = w.start();
      await w.until(settled(w, n, 'agent:needs-human'), 20000, 'agent:needs-human');
      assert.equal(w.branch(`factory/issue-${n}`), null);
      assert.equal(w.pr(), undefined);
      assert.match(factoryComments(w, n).at(-1).body, new RegExp(file.replace('.', '\\.')));
      f.signal('SIGINT'); await f.exited;
    } finally { w.close(); }
  });
}

test('a commit changing the tracked .gitignore is pushed', async () => {
  const w = await world();
  try {
    const n = w.issue({ labels: ['agent:implement'] });
    w.script(n, [gate(90), implement({ '.gitignore': 'node_modules/\ndist/\n' }, 'Ignore dist'), clean]);
    const f = w.start();
    await w.until(settled(w, n, 'agent:done'), 20000, 'a pull request');
    assert.equal(w.pr().isDraft, false);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
