// A factory pull request that conflicts with the base branch gets merged without a label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, renameSync, openSync, closeSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { world } from './world.mjs';
import { ok, factoryComments, polls, toPullRequest } from './steps.mjs';

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid'];

// What GitHub says about the pull request; written under the fake gh's lock, as world.mjs does.
function setMergeable(w, n, mergeable) {
  const file = join(w.dir, 'gh.json'), lock = `${file}.lock`, end = Date.now() + 5000;
  for (;;) {
    try { closeSync(openSync(lock, 'wx')); break; } catch (e) {
      if (e.code !== 'EEXIST' || Date.now() > end) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    const s = JSON.parse(readFileSync(file, 'utf8'));
    s.items.find((i) => i.number === n).mergeable = mergeable;
    writeFileSync(`${file}.tmp`, JSON.stringify(s)); renameSync(`${file}.tmp`, file);
  } finally { rmSync(lock, { force: true }); }
}

// Lands a commit on master that conflicts with the pull request's change to src/a.js.
function conflictOnMaster(w) {
  const seed = join(w.dir, 'seed'), git = (...a) => execFileSync('git', ['-C', seed, ...ID, ...a], { encoding: 'utf8' }).trim();
  writeFileSync(join(seed, 'src/a.js'), 'export const a = 3;\n');
  git('add', '-A'); git('commit', '-q', '-m', 'Change a on master'); git('push', '-q', 'origin', 'master');
  return git('rev-parse', 'HEAD');
}
const isAncestor = (w, sha, branch) => {
  try { execFileSync('git', ['--git-dir', w.origin, 'merge-base', '--is-ancestor', sha, branch], { stdio: 'ignore' }); return true; } catch { return false; }
};
const merges = (w, n) => w.claudeCalls().filter((c) => c.issue === n && c.session === 'merge').length;

test('a conflicting factory pull request without labels is merged and pushed', async () => {
  const w = await world();
  try {
    const [n, p, f] = await toPullRequest(w);
    assert.deepEqual(w.item(p).labels, []);
    const issueLabels = w.item(n).labels;
    const landed = conflictOnMaster(w);
    w.script(n, [{ session: 'merge', write: { 'src/a.js': 'export const a = 3;\n' }, commit: 'Merge master', output: ok('Kept master') }]);
    setMergeable(w, p, 'CONFLICTING');
    const branch = `factory/issue-${n}`;
    await w.until(() => isAncestor(w, landed, branch) && !w.item(p).labels.includes('agent:in-progress'), 20000, 'the merge push');
    setMergeable(w, p, 'MERGEABLE'); // GitHub works it out after the push
    assert.equal(merges(w, n), 1);
    assert.ok(w.branch(branch).subjects.includes('Merge master'));
    assert.deepEqual(w.item(p).labels, []);
    assert.deepEqual(w.item(n).labels, issueLabels);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});

test('a merge that stays unresolved parks and is not picked up again', async () => {
  const w = await world();
  try {
    const [n, p, f] = await toPullRequest(w);
    conflictOnMaster(w);
    w.script(n, [{ session: 'merge', output: ok('Could not decide') }]); // resolves nothing
    setMergeable(w, p, 'CONFLICTING');
    await w.until(() => w.item(p).labels.includes('agent:needs-human') && !w.item(p).labels.includes('agent:in-progress'), 20000, 'the park');
    assert.match(factoryComments(w, p).at(-1).body, /still unresolved/);
    const seen = polls(f);
    await w.until(() => polls(f) >= seen + 2, 20000, 'two more polls');
    assert.equal(merges(w, n), 1);
    f.signal('SIGINT'); await f.exited;
  } finally { w.close(); }
});
