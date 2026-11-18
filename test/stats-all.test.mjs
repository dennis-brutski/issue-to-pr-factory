// stats.mjs with no target: every target in targets/, one after another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStats } from '../stats.mjs';

function root(targets) {
  const r = mkdtempSync(join(tmpdir(), 'factory-stats-all-'));
  mkdirSync(join(r, 'targets'));
  for (const [name, repo] of Object.entries(targets)) {
    writeFileSync(join(r, 'targets', `${name}.mjs`), `export default ${JSON.stringify({ repo, owner: 'me', baseBranch: 'main' })};\n`);
  }
  return r;
}
const fakeGh = (failing = []) => {
  const calls = [];
  const answer = (list) => async (cfg) => {
    calls.push(cfg.repo);
    if (failing.includes(cfg.repo)) throw new Error('gh cannot reach the repo');
    return list;
  };
  return { calls, listAllPullRequests: answer([]), listAllIssueComments: answer([]) };
};
async function stats(r, args, gh) {
  const lines = [];
  const ok = await runStats(args, { factoryRoot: r, gh, log: (s) => lines.push(s) });
  return { ok, out: lines.join('\n') };
}

test('no target prints every target under its own heading, in name order, one blank line apart', async () => {
  const r = root({ zeta: 'me/zeta-repo', alpha: 'me/alpha-repo' });
  const { ok, out } = await stats(r, [], fakeGh());
  assert.equal(ok, true);
  const a = out.indexOf('me/alpha-repo\n'), z = out.indexOf('me/zeta-repo\n');
  assert.ok(a === 0 && z > a, out);
  assert.match(out, /none\n\nme\/zeta-repo\n/);
  assert.equal(out.match(/opened/g).length, 2);
});

test('--since applies to every target', async () => {
  const r = root({ one: 'me/one', two: 'me/two' });
  const { out } = await stats(r, ['--since', '2026-11-01'], fakeGh());
  assert.match(out, /^me\/one since 2026-11-01\n/m);
  assert.match(out, /^me\/two since 2026-11-01\n/m);
});

test('one target failing still prints the others and reports failure', async () => {
  const r = root({ one: 'me/one', two: 'me/two' });
  const { ok, out } = await stats(r, [], fakeGh(['me/one']));
  assert.equal(ok, false);
  assert.match(out, /^one: could not read stats: gh cannot reach the repo$/m);
  assert.match(out, /^me\/two\n/m);
  assert.match(out, /opened/);
});

test('a target whose settings do not load is reported, the others still print', async () => {
  const r = root({ one: 'me/one' });
  writeFileSync(join(r, 'targets', 'broken.mjs'), 'export default { repo: "x/y" };\n');
  const { ok, out } = await stats(r, [], fakeGh());
  assert.equal(ok, false);
  assert.match(out, /^broken: could not read stats: target broken: repo and baseBranch are required$/m);
  assert.match(out, /^me\/one\n/m);
});

test('with a target only that target prints', async () => {
  const r = root({ one: 'me/one', two: 'me/two' });
  const gh = fakeGh();
  const { ok, out } = await stats(r, ['two'], gh);
  assert.equal(ok, true);
  assert.match(out, /^me\/two\n/);
  assert.deepEqual([...new Set(gh.calls)], ['me/two']);
});

test('no targets at all is an error', async () => {
  await assert.rejects(runStats([], { factoryRoot: root({}), gh: fakeGh(), log: () => {} }), /no targets/);
});
