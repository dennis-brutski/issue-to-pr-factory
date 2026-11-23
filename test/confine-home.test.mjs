// A worktree lives under the home folder, which bwrap hides. Nothing from the home folder
// may be bound at or under the worktree, or `git status` there would show home dotfiles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { bwrapArgs } from '../lib/confine.mjs';
import scorePad from './fixtures/web-app-target.mjs';

const binds = (args) => args.flatMap((a, i) => (a === '--bind' || a === '--ro-bind' ? [[args[i + 1], args[i + 2]]] : []));
const under = (p, dir) => p === dir || p.startsWith(dir + sep);

test('no home path is bound at or under a worktree that lives in the home folder', () => {
  const home = mkdtempSync(join(tmpdir(), 'home-'));
  for (const f of ['.bashrc', '.profile']) writeFileSync(join(home, f), '');
  for (const d of ['.claude', '.idea', '.cache/ms-playwright']) mkdirSync(join(home, d), { recursive: true });
  const runDir = join(home, 'git', 'factory', 'runs', 'demo');
  const dir = join(runDir, 'worktrees', 'issue-1'), gitDir = join(runDir, 'repo', '.git');
  mkdirSync(dir, { recursive: true }); mkdirSync(gitDir, { recursive: true });
  writeFileSync(join(dir, '.git'), `gitdir: ${gitDir}/worktrees/issue-1\n`);
  const fill = (w) => w.replaceAll('{runDir}', runDir);
  const a = bwrapArgs({
    dir, gitDir, home, network: true,
    read: [...scorePad.sandboxRead, '~/.claude'], write: [...scorePad.setupWrite.map(fill), '~/.npm'], env: {},
  });
  const own = new Set([dir, join(dir, '.git')]); // the worktree itself and its .git link
  const inside = binds(a).filter(([, dest]) => under(dest, dir) && !own.has(dest));
  assert.deepEqual(inside, []);
  for (const [src, dest] of binds(a).filter(([, d]) => own.has(d))) assert.equal(src, dest);
  assert.ok(a.indexOf('--tmpfs') < a.indexOf(dir), 'home is hidden before the worktree is bound');
  assert.deepEqual(a.slice(-2), ['--chdir', dir]);
});
