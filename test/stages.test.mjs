import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.mjs';
import scorePad from './fixtures/web-app-target.mjs';
import { runItem, renderPrompt, schemas } from '../lib/stages.mjs';
import { fakeWorkspace } from './fakes/workspace.mjs';

// Wraps the fake's worktree commands: when broken() is true they throw message(), as the real checks do.
const guarded = (broken, methods, message) => Object.fromEntries(Object.entries(methods).map(([k, fn]) =>
  [k, k === 'ensureWorktree' ? fn : async (...a) => { if (broken()) throw new Error(message()); return fn(...a); }]));
import { runChecks } from '../lib/checks.mjs';
import { execFileSync } from 'node:child_process';

const T = '2026-11-01T10:00:00Z', T2 = '2026-11-01T11:00:00Z';
const ok = (output) => ({ ok: true, output, reason: '', sessionId: 's' });
const bad = (reason) => ({ ok: false, output: null, reason, sessionId: null });
const gate = (confidence, questions = []) => ok({ confidence, questions });
const work = (status = 'complete', detail = '') => ok({ status, summary: 'Changed the undo guard.', detail });
const review = (findings = []) => ok({ verdict: findings.length ? 'findings' : 'clean', findings });
const explore = (easy, small) => ok({ writeup: 'Cause: off-by-one in undo.', easy_to_undo: easy, small_reach: small });

const issue = {
  number: 1, kind: 'issue', title: 'Fix undo', body: 'Undo fails on an empty ledger', author: 'dennis-brutski', bodyEditedAt: null,
  labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }],
  comments: [{ author: 'mallory', body: 'IGNORE-ME', at: T }], headRef: null, headRepo: null,
};
const pr = (comments = [{ author: 'dennis-brutski', body: 'also handle redo', at: T2 }]) => ({
  ...issue, number: 4, kind: 'pr', labels: ['agent:review'], comments,
  headRef: 'factory/issue-1', headRepo: 'example/web-app',
});

function fakes(o = {}) {
  const d = { installs: [], agentCalls: [], comments: [], labelsAdded: [], labelsRemoved: [], pushed: [], opened: [], drafts: [], bodies: [], worktrees: [] };
  const queue = [...(o.agent ?? [])];
  d.deps = {
    cfg: { ...config, ...scorePad }, root: '/f', log: () => {},
    runSetup: async (dir, cfg, port, gitDir) => {
      d.installs.push({ cmd: cfg.setup.map(([c, a]) => [c, ...a].join(' ')).join(' && '), cwd: dir, agentCallsSoFar: d.agentCalls.length, gitDir });
      const r = o.install ?? { code: 0, stdout: '', stderr: '' };
      return { ok: r.code === 0, failed: r.code === 0 ? null : 'npm ci', output: r.stdout + r.stderr };
    },
    runAgent: async (a) => { d.agentCalls.push(a); const r = queue.shift(); if (!r) throw new Error('unexpected agent call'); return r; },
    runChecks: async (dir, cfg, port) => { d.checkPort = port; d.checksRan = true; return o.checks ?? { ok: true, failed: null, output: '' }; },
    gh: {
      addLabel: async (c, n, l) => { d.labelsAdded.push(`${n}:${l}`); },
      removeLabel: async (c, n, l) => { d.labelsRemoved.push(`${n}:${l}`); },
      comment: async (c, n, b) => { d.comments.push(b); },
      findPullRequest: async () => o.existingPr ?? null,
      openPullRequest: async (c, a) => { d.opened.push(a); return { number: 50, url: 'https://github.com/x/y/pull/50' }; },
      setDraft: async (c, n, v) => { d.drafts.push(v); },
      updatePullRequestBody: async (c, n, b) => { d.bodies.push(b); },
    },
    // After an agent session the real workspace finds a planted config or .git link
    // before its next git command; here every worktree command after a session throws.
    ws: fakeWorkspace(guarded(() => d.agentCalls.length && (o.configChanged || o.gitLinkChanged), {
      ensureWorktree: async (n) => { d.worktrees.push(n); return { dir: `/f/worktrees/issue-${n}`, created: true }; },
      headInfo: async () => ({ sha: o.noNewCommits ? 'abc' : `abc${d.agentCalls.filter((a) => !a.readOnly).length}`, committedAt: T }),
      // Before setup: what the branch held when the run began (o.setupChanges); after it, what the sessions left.
      changesAgainstBase: async (dir, since) => (!d.installs.length ? o.setupChanges ?? []
        : (since && o.reworkChanges) || o.changes || [{ status: 'M', path: 'src/state.js' }]),
      commitMessagesAgainstBase: async () => o.messages ?? ['Fix undo on empty ledger'],
      isClean: async () => o.clean ?? true,
      diffAgainstBase: async () => o.diff ?? '',
      mergeBase: async () => o.merge ?? 'clean',
      mergeResolved: async () => o.resolved ?? true,
      push: async (dir, b, sha) => { if (o.pushFails) throw new Error('push rejected'); d.pushed.push(b); d.pushedSha = sha; },
      currentBranch: async () => (o.detached ? null : 'factory/issue-1'),
    }, () => (o.configChanged ? "the clone's git config at /f/repo was changed: credential.helper" : "the worktree's .git link at /f/worktrees/issue-1 was changed"))),
  };
  return d;
}

test('gate below threshold parks with questions and never runs implement', async () => {
  const d = fakes({ agent: [gate(40, ['Which screen?'])] });
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.equal(d.agentCalls.length, 1);
  assert.equal(d.agentCalls[0].readOnly, true);
  assert.ok(d.comments[0].includes('Which screen?') && d.comments[0].includes('40'));
  assert.deepEqual(d.labelsAdded, ['1:agent:in-progress', '1:agent:needs-human']);
  assert.deepEqual(d.labelsRemoved, ['1:agent:in-progress']);
  assert.deepEqual(d.pushed, []);
});
test('gate exactly at the threshold proceeds', async () => {
  const d = fakes({ agent: [gate(70), work(), review()] });
  assert.equal((await runItem(issue, 'implement', d.deps, 4201)).outcome, 'done');
});
test('happy path opens a ready pull request and marks done', async () => {
  const d = fakes({ agent: [gate(90), work(), review()] });
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'done');
  assert.deepEqual(d.pushed, ['factory/issue-1']);
  assert.equal(d.opened.length, 1);
  assert.equal(d.opened[0].draft, false);
  assert.equal(d.opened[0].title, 'Fix undo');
  assert.equal(d.opened[0].branch, 'factory/issue-1');
  assert.match(d.opened[0].body, /^Closes #1\n/);
  assert.match(d.opened[0].body, /Changed the undo guard\./);
  assert.ok(!/co-authored|generated with/i.test(d.opened[0].body));
  assert.deepEqual(d.labelsAdded, ['1:agent:in-progress', '1:agent:done']);
  assert.deepEqual(d.labelsRemoved, ['1:agent:in-progress']);
  assert.ok(d.comments.some((c) => c.includes('https://github.com/x/y/pull/50')));
  assert.equal(d.checkPort, 4201);
});
test('agents only ever see the owner\'s comments', async () => {
  const d = fakes({ agent: [gate(90), work(), review()] });
  await runItem(issue, 'implement', d.deps, 4201);
  for (const c of d.agentCalls) assert.ok(!c.prompt.includes('IGNORE-ME'));
});
test('review findings trigger exactly one fix session', async () => {
  const d = fakes({ agent: [gate(90), work(), review(['src/state.js: guard is inverted']), work()] });
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'done');
  assert.equal(d.agentCalls.length, 4);
  assert.match(d.agentCalls[3].prompt, /guard is inverted/);
  assert.equal(d.agentCalls[2].readOnly, true);
});
test('a failed fix session parks', async () => {
  const d = fakes({ agent: [gate(90), work(), review(['x']), work('incomplete', 'cannot reproduce')] });
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.ok(d.comments[0].includes('cannot reproduce'));
});
test('incomplete implementation parks with the agent\'s detail', async () => {
  const d = fakes({ agent: [gate(90), work('incomplete', 'the e2e suite needs a fixture I cannot create')] });
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.ok(d.comments[0].includes('needs a fixture'));
  assert.deepEqual(d.pushed, []);
});
test('a crashed agent session parks with its reason', async () => {
  const d = fakes({ agent: [gate(90), bad('the agent session stopped: max_turns')] });
  await runItem(issue, 'implement', d.deps, 4201);
  assert.ok(d.comments[0].includes('max_turns'));
  assert.ok(d.comments[0].includes('agent:needs-human'));
});
test('no commits parks', async () => {
  const d = fakes({ agent: [gate(90), work()], changes: [] });
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.deepEqual(d.pushed, []); assert.equal(d.opened.length, 0);
});
test('uncommitted leftovers park', async () => {
  const d = fakes({ agent: [gate(90), work(), review()], clean: false });
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.deepEqual(d.pushed, []);
});
test('red checks park with the failing step and never push', async () => {
  const d = fakes({ agent: [gate(90), work(), review()], checks: { ok: false, failed: 'npm test', output: 'AssertionError: 1 !== 2' } });
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.ok(d.comments[0].includes('npm test') && d.comments[0].includes('AssertionError'));
  assert.deepEqual(d.pushed, []);
});
test('attribution line in a commit parks', async () => {
  const d = fakes({ agent: [gate(90), work(), review()], messages: ['Fix\n\nCo-Authored-By: Claude <noreply@anthropic.com>'] });
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.deepEqual(d.pushed, []);
});
test('protected path opens a draft with a warning and needs-human', async () => {
  const d = fakes({ agent: [gate(90), work(), review()], changes: [{ status: 'M', path: 'test/unit/scoring.test.js' }] });
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.equal(d.opened[0].draft, true);
  assert.match(d.opened[0].body, /^> ⚠ This pull request changes files you should check:/);
  assert.match(d.opened[0].body, /test\/unit\/scoring\.test\.js/);
  assert.ok(d.labelsAdded.includes('1:agent:needs-human'));
  assert.ok(!d.labelsAdded.includes('1:agent:done'));
});
test('existing pull request is reused', async () => {
  const d = fakes({ agent: [gate(90), work(), review()], existingPr: { number: 9, url: 'https://github.com/x/y/pull/9', isDraft: false } });
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'done');
  assert.equal(d.opened.length, 0);
  assert.deepEqual(d.pushed, ['factory/issue-1']);
  assert.ok(d.comments.some((c) => c.includes('pull/9')));
});
test('explore: safe verdict swaps the label to implement', async () => {
  const d = fakes({ agent: [explore(true, true)] });
  const r = await runItem({ ...issue, labels: ['agent:explore'] }, 'explore', d.deps, 4201);
  assert.equal(r.outcome, 'promoted');
  assert.ok(d.comments[0].includes('off-by-one'));
  assert.ok(d.labelsRemoved.includes('1:agent:explore'));
  assert.ok(d.labelsAdded.includes('1:agent:implement'));
  assert.ok(!d.labelsAdded.includes('1:agent:needs-human'));
  assert.equal(d.agentCalls[0].readOnly, true);
});
test('explore: unsafe verdict parks with the write-up', async () => {
  const d = fakes({ agent: [explore(true, false)] });
  const r = await runItem({ ...issue, labels: ['agent:explore'] }, 'explore', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.ok(d.comments.some((c) => c.includes('off-by-one')));
  assert.ok(d.labelsAdded.includes('1:agent:needs-human'));
  assert.ok(!d.labelsAdded.includes('1:agent:implement'));
});
test('explore: a session that changed files parks', async () => {
  const d = fakes({ agent: [explore(true, true)], clean: false });
  const r = await runItem({ ...issue, labels: ['agent:explore'] }, 'explore', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.ok(!d.labelsAdded.includes('1:agent:implement'));
});
test('rework uses the issue\'s worktree, pushes and removes the review label', async () => {
  const d = fakes({ agent: [work()] });
  const r = await runItem(pr(), 'review', d.deps, 4201);
  assert.equal(r.outcome, 'done');
  assert.deepEqual(d.worktrees, [1]);
  assert.match(d.agentCalls[0].prompt, /also handle redo/);
  assert.deepEqual(d.pushed, ['factory/issue-1']);
  assert.deepEqual(d.labelsAdded, ['4:agent:in-progress']);
  assert.deepEqual(d.labelsRemoved.sort(), ['4:agent:in-progress', '4:agent:review']);
});
test('rework without new owner comments parks', async () => {
  const d = fakes({ agent: [] });
  const r = await runItem(pr([{ author: 'dennis-brutski', body: 'old comment', at: '2026-11-01T09:00:00Z' }]), 'review', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.equal(d.agentCalls.length, 0);
  assert.ok(d.labelsAdded.includes('4:agent:needs-human'));
});
test('rework that touches protected files turns the pull request into a draft', async () => {
  const d = fakes({ agent: [work()], changes: [{ status: 'M', path: 'package.json' }] });
  const r = await runItem(pr(), 'review', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.deepEqual(d.drafts, [true]);
  assert.deepEqual(d.pushed, ['factory/issue-1']);
});
test('merge: clean merge runs no agent', async () => {
  const d = fakes({ agent: [], merge: 'clean' });
  const r = await runItem({ ...pr(), labels: ['agent:merge'] }, 'merge', d.deps, 4201);
  assert.equal(r.outcome, 'done');
  assert.equal(d.agentCalls.length, 0);
  assert.deepEqual(d.pushed, ['factory/issue-1']);
  assert.ok(d.labelsRemoved.includes('4:agent:merge'));
});
test('merge: session says complete but merge is unresolved → parked', async () => {
  const d = fakes({ agent: [work()], merge: 'conflict', resolved: false });
  const r = await runItem({ ...pr(), labels: ['agent:merge'] }, 'merge', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.deepEqual(d.pushed, []);
});
test('merge: conflict resolved by one session is pushed', async () => {
  const d = fakes({ agent: [work()], merge: 'conflict', resolved: true });
  const r = await runItem({ ...pr(), labels: ['agent:merge'] }, 'merge', d.deps, 4201);
  assert.equal(r.outcome, 'done');
  assert.equal(d.agentCalls.length, 1);
});
test('in-progress label is removed even when a step throws', async () => {
  const d = fakes({ agent: [gate(90), work(), review()], pushFails: true });
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.ok(d.comments[0].includes('push rejected'));
  assert.deepEqual(d.labelsRemoved, ['1:agent:in-progress']);
});
test('renderPrompt throws on a missing variable', () =>
  assert.throws(() => renderPrompt('gate', { number: 1 }), /missing/i));
test('renderPrompt fills variables and the shared rules', () => {
  const p = renderPrompt('gate', { number: 7, branch: 'factory/issue-7', title: 'T', body: 'B', comments: 'C' });
  assert.match(p, /issue #7/); assert.match(p, /factory\/issue-7/); assert.ok(!p.includes('{{'));
});
test('text from the issue cannot inject template variables', () => {
  const p = renderPrompt('gate', { number: 7, branch: 'b', title: 'T', body: 'see {{rules}} and {{nope}}', comments: '' });
  assert.ok(p.includes('see {{rules}} and {{nope}}'));
});
test('schemas require every field', () => {
  for (const s of Object.values(schemas)) assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
});
// Real bwrap, as in confine.test.mjs: skipped inside an agent's own sandbox, never in the factory's check run.
const bwrapWorks = (() => { try { execFileSync('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-net', 'true'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const real = { skip: bwrapWorks ? false : 'bwrap probe failed on this machine' };
test('runChecks reports the first failing step with its output', real, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-checks-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'c', version: '1.0.0', scripts: { test: 'echo BOOM-OUTPUT && exit 1', e2e: 'exit 0' } }));
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ name: 'c', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'c', version: '1.0.0' } } }));
  const r = await runChecks(dir, { ...config, ...scorePad }, 4321);
  assert.equal(r.ok, false); assert.equal(r.failed, 'npm test'); assert.match(r.output, /BOOM-OUTPUT/);
});
test('runChecks passes the port to the e2e run', real, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-checks-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'c', version: '1.0.0', scripts: { test: 'exit 0', e2e: 'test "$E2E_PORT" = 4321' } }));
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ name: 'c', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'c', version: '1.0.0' } } }));
  assert.deepEqual(await runChecks(dir, { ...config, ...scorePad }, 4321), { ok: true, failed: null, output: '' });
});
test('a park without commits does not point to a branch', async () => {
  const d = fakes({ agent: [gate(5, ['What?'])], messages: [] });
  await runItem(issue, 'implement', d.deps, 4201);
  assert.ok(!d.comments[0].includes('factory/issue-1'));
});
test('a park with commits names the local branch', async () => {
  const d = fakes({ agent: [gate(90), work()], checks: { ok: false, failed: 'npm test', output: 'x' } });
  await runItem(issue, 'implement', d.deps, 4201);
  assert.ok(d.comments[0].includes("factory's local branch `factory/issue-1`"));
});
test('dependencies are installed in the worktree before the first agent session', async () => {
  const d = fakes({ agent: [gate(5, ['What?'])] });
  await runItem(issue, 'implement', d.deps, 4201);
  assert.deepEqual(d.installs, [{ cmd: 'npm ci', cwd: '/f/worktrees/issue-1', agentCallsSoFar: 0, gitDir: '/f/repo/.git' }]);
});
test('a failed npm ci parks before any agent session', async () => {
  const d = fakes({ install: { code: 1, stdout: '', stderr: 'npm ERR! lockfile out of sync' } });
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.equal(d.agentCalls.length, 0);
  assert.ok(d.comments[0].includes('lockfile out of sync'));
});
test('runItem leaves park logging to the loop', async () => {
  const d = fakes({ agent: [gate(5, ['What?'])] });
  const logs = []; d.deps.log = (m) => logs.push(m);
  await runItem(issue, 'implement', d.deps, 4201);
  assert.ok(!logs.some((l) => l.includes('parked')), logs.join('\n'));
});
test('rework with no new commits posts the agent\'s answer and finishes without pushing', async () => {
  const d = fakes({ agent: [work('complete')], noNewCommits: true });
  const r = await runItem(pr(), 'review', d.deps, 4201);
  assert.equal(r.outcome, 'done');
  assert.deepEqual(d.pushed, []);
  assert.ok(d.comments.some((c) => c.includes('Changed the undo guard.')), d.comments.join('\n'));
  assert.ok(d.labelsRemoved.includes('4:agent:review'));
  assert.ok(!d.labelsAdded.includes('4:agent:needs-human'));
});
test('rework on an already flagged branch is checked only for what the rework changed', async () => {
  const d = fakes({ agent: [work()], changes: [{ status: 'M', path: 'test/unit/backup.test.js' }], reworkChanges: [{ status: 'M', path: 'src/state.js' }] });
  const r = await runItem(pr(), 'review', d.deps, 4201);
  assert.equal(r.outcome, 'done');
  assert.deepEqual(d.drafts, []);
  assert.deepEqual(d.pushed, ['factory/issue-1']);
  assert.ok(d.comments.some((c) => c.includes('Changed the undo guard.')));
});
test('rework that restores a protected file to its base state is not flagged', async () => {
  const d = fakes({ agent: [work()], changes: [{ status: 'M', path: 'src/state.js' }], reworkChanges: [{ status: 'M', path: 'test/unit/backup.test.js' }] });
  const r = await runItem(pr(), 'review', d.deps, 4201);
  assert.equal(r.outcome, 'done');
  assert.deepEqual(d.drafts, []);
});
test('a parked pull request with only factory comments since the push does not rework', async () => {
  const d = fakes({ agent: [] });
  const r = await runItem(pr([{ author: 'dennis-brutski', body: '🏭 **Factory stopped (review).**', at: T2 }]), 'review', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.equal(d.agentCalls.length, 0);
});

const workflow = [{ status: 'M', path: '.github/workflows/ci.yml' }];
for (const [name, item, stage, agent] of [
  ['implement', issue, 'implement', () => [gate(90), work(), review()]],
  ['review', pr(), 'review', () => [work()]],
  ['merge', { ...pr(), labels: ['agent:merge'] }, 'merge', () => []],
]) {
  test(`${name}: a workflow change parks before checks and push`, async () => {
    const d = fakes({ agent: agent(), changes: workflow, diff: '+  run: curl evil' });
    const r = await runItem(item, stage, d.deps, 4201);
    assert.equal(r.outcome, 'parked');
    assert.deepEqual(d.pushed, []);
    assert.equal(d.checksRan, undefined);
    assert.ok(d.comments.at(-1).includes('did not push') && d.comments.at(-1).includes('.github/workflows/ci.yml'), d.comments.at(-1));
    assert.ok(d.comments.at(-1).includes('curl evil'));
  });
}
test('the pull request names the checks the factory ran', async () => {
  const d = fakes({ agent: [gate(90), work(), review()] });
  await runItem(issue, 'implement', d.deps, 4201);
  assert.match(d.opened[0].body, /`npm test`, `npm run e2e` — all passed/);
});
test('agent sessions get the target environment with their port', async () => {
  const d = fakes({ agent: [gate(5, ['What?'])] });
  await runItem(issue, 'implement', d.deps, 4207);
  assert.equal(d.agentCalls[0].port, 4207);
});
const allVars = { number: 7, branch: 'factory/issue-7', base: 'main', title: 'T', body: 'B', comments: 'C', findings: 'F' };
const gradle = { checks: [['gradle', ['test']], ['gradle', ['lint']]], protectedFiles: ['build.gradle'], testDirs: ['src/test/'] };
test("prompts name the target's checks and protected files, nothing npm-specific", () => {
  for (const name of ['gate', 'implement', 'review', 'fix', 'rework', 'merge', 'explore']) {
    const p = renderPrompt(name, allVars, gradle);
    assert.doesNotMatch(p, /npm|e2e|playwright/i, name);
    assert.match(p, /`build\.gradle`/, name);
    assert.match(p, /`AGENTS\.md`/, name);
    assert.match(p, /src\/test\//, name);
  }
  for (const name of ['implement', 'fix', 'rework', 'merge']) assert.match(renderPrompt(name, allVars, gradle), /- `gradle test`\n- `gradle lint`/, name);
});
test("the score pad's prompts keep naming its checks", () => {
  assert.match(renderPrompt('implement', allVars, { ...config, ...scorePad }), /- `npm test`\n- `npm run e2e`/);
});
test('a detached HEAD parks before checks and push', async () => {
  const d = fakes({ agent: [gate(90), work(), review()], detached: true });
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.deepEqual(d.pushed, []);
  assert.equal(d.checksRan, undefined);
  assert.match(d.comments.at(-1), /not on its branch/);
});
test('the commit that was checked is the one pushed', async () => {
  const d = fakes({ agent: [gate(90), work(), review()] });
  await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(d.pushedSha, 'abc1');
});
test('a changed .git link after an agent session parks and never pushes', async () => {
  const d = fakes({ agent: [gate(90), work(), review()], gitLinkChanged: true });
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.deepEqual(d.pushed, []);
  assert.match(d.comments.at(-1), /\.git link/);
});
test('a changed clone config after an agent session parks and never pushes', async () => {
  const d = fakes({ agent: [gate(90), work(), review()], configChanged: true });
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.deepEqual(d.pushed, []);
  assert.match(d.comments.at(-1), /credential\.helper/);
});
// That the real workspace checks before every git command: test/workspace-guard.test.mjs.
test('a worktree left dirty by a killed run parks before the first session, saying so', async () => {
  const d = fakes({ agent: [gate(90)], clean: false });
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.equal(d.agentCalls.length, 0);
  assert.match(d.comments[0], /uncommitted changes/);
  assert.match(d.comments[0], /worktrees\/issue-1/);
});
test('a branch that already changes a protected file parks before setup, in every stage', async () => {
  for (const [item, stage] of [[issue, 'explore'], [issue, 'implement'], [pr(), 'review'], [pr(), 'merge']]) {
    const d = fakes({ setupChanges: [{ status: 'M', path: 'package-lock.json' }, { status: 'M', path: 'src/state.js' }] });
    const r = await runItem(item, stage, d.deps, 4201);
    assert.equal(r.outcome, 'parked', stage);
    assert.equal(d.installs.length, 0, stage);
    assert.equal(d.agentCalls.length, 0, stage);
    assert.match(d.comments[0], /The branch changes protected files, so the factory did not run setup with network on it:\n- protected file changed: package-lock\.json\nReview them in `.*worktrees\/issue-1`; to go ahead, merge or revert them, then remove the label\./, stage);
  }
});
test('a changed existing test does not stop setup: tests do not run there', async () => {
  const d = fakes({ agent: [gate(90), work(), review()], setupChanges: [{ status: 'M', path: 'test/unit/scoring.test.js' }] });
  await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(d.installs.length, 1);
});
test('a branch without protected changes runs setup as before', async () => {
  const d = fakes({ agent: [gate(90), work(), review()], setupChanges: [{ status: 'M', path: 'src/state.js' }] });
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'done');
  assert.equal(d.installs.length, 1);
  assert.equal(d.installs[0].agentCallsSoFar, 0);
});
