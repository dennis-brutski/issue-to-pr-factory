import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from './fixtures/config.mjs';
import scorePad from './fixtures/web-app-target.mjs';
import { runItem, renderPrompt, schemas, lastStopReason, testsThatChange, protectedThatChangeOf, implementModel } from '../lib/stages.mjs';
import { fakeWorkspace, fakeView } from './fakes/workspace.mjs';
import { runChecks, runTestFiles } from '../lib/checks.mjs';
import { execFileSync } from 'node:child_process';
import { config as factoryConfig } from '../config.mjs';
import { stopped } from '../lib/comments.mjs';
import { stopLabel } from '../stats.mjs';
import factory from './fixtures/factory-target.mjs';
import { agentSettings } from '../lib/agent.mjs';
import { parse } from '../lib/pr-body.mjs';

// Wraps the fake's worktree commands: when broken() is true they throw message(), as the real checks do.
const guarded = (broken, methods, message) => Object.fromEntries(Object.entries(methods).map(([k, fn]) =>
  [k, k === 'ensureWorktree' ? fn : async (...a) => { if (broken()) throw new Error(message()); return fn(...a); }]));

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
  const head = () => (o.noNewCommits ? 'abc' : `abc${d.agentCalls.filter((a) => !a.readOnly).length}`);
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
      headInfo: async () => ({ sha: head() }),
      // Before setup: what the branch held when the run began (o.setupChanges); after it, what the sessions left.
      againstBase: async () => fakeView({
        changes: async (since) => (!d.installs.length ? o.setupChanges ?? []
          : (since && o.reworkChanges) || o.changes || [{ status: 'M', path: 'src/state.js' }]),
        messages: async () => o.messages ?? ['Fix undo on empty ledger'],
        diff: async () => o.diff ?? '',
      }),
      isClean: async () => o.clean ?? true,
      mergeBase: async () => o.merge ?? 'clean',
      mergeResolved: async () => o.resolved ?? true,
      push: async (dir, b, sha) => { if (o.pushFails) throw new Error('push rejected'); d.pushed.push(b); d.pushedSha = sha; },
      preparePush: async () => (o.detached ? { refused: 'not-on-branch', branch: null }
        : !(o.clean ?? true) ? { refused: 'uncommitted', branch: 'factory/issue-1' } : { sha: head(), reattached: false }),
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
  const d = fakes({ agent: [gate(90), work(), review(['src/state.js: guard is inverted']), work(), review()] });
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'done');
  assert.equal(d.agentCalls.length, 5);
  assert.match(d.agentCalls[3].prompt, /guard is inverted/);
  assert.equal(d.agentCalls[2].readOnly, true);
});
test('each session is started with its session type', async () => {
  const d = fakes({ agent: [gate(90), work(), review(['x']), work(), review()] });
  await runItem(issue, 'implement', d.deps, 4201);
  assert.deepEqual(d.agentCalls.map((a) => a.session), ['gate', 'implement', 'review', 'fix', 'review']);
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
  const r = await runItem(pr([{ author: 'dennis-brutski', body: 'old comment', at: '2026-11-01T09:00:00Z' }, { author: 'dennis-brutski', body: '🏭 **Rework**\n\nDone', at: T }]), 'review', d.deps, 4201);
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
test('explore: a session that commits on a clean tree parks as read-only', async () => {
  const d = fakes({ agent: [explore(true, true)] });
  d.deps.ws.headInfo = async () => ({ sha: d.agentCalls.length ? 'def' : 'abc' });
  const r = await runItem({ ...issue, labels: ['agent:explore'] }, 'explore', d.deps, 4201);
  assert.deepEqual(r, { outcome: 'parked', detail: 'The explore step is read-only but changed files in the worktree.' });
  assert.ok(!d.labelsAdded.includes('1:agent:implement'));
});
test('a failing park comment still ends parked and is logged', async () => {
  const d = fakes({ agent: [gate(40)] }), logs = [];
  d.deps.log = (m) => logs.push(m);
  d.deps.gh.comment = async () => { throw new Error('HTTP 502'); };
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.deepEqual(logs.filter((m) => m.includes('could not')), ['#1 could not record the park on GitHub: HTTP 502']);
});
test('a failing needs-human label still ends parked and is logged', async () => {
  const d = fakes({ agent: [gate(40)] }), logs = [];
  d.deps.log = (m) => logs.push(m);
  const addLabel = d.deps.gh.addLabel;
  d.deps.gh.addLabel = async (c, n, l) => { if (l === 'agent:needs-human') throw new Error('HTTP 502'); return addLabel(c, n, l); };
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(r.outcome, 'parked');
  assert.equal(d.comments.length, 1);
  assert.deepEqual(logs.filter((m) => m.includes('could not')), ['#1 could not record the park on GitHub: HTTP 502']);
});
test('a failing in-progress removal keeps the outcome and is logged', async () => {
  const d = fakes({ agent: [gate(90), work(), review()] }), logs = [];
  d.deps.log = (m) => logs.push(m);
  d.deps.gh.removeLabel = async () => { throw new Error('HTTP 502'); };
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.deepEqual(r, { outcome: 'done', detail: 'https://github.com/x/y/pull/50' });
  assert.deepEqual(logs.filter((m) => m.includes('could not')), ['#1 could not remove in-progress: HTTP 502']);
});
test('files still uncommitted after the leftovers are removed park', async () => {
  const d = fakes({ agent: [gate(90), work(), review()] });
  d.deps.ws.preparePush = async () => ({ refused: 'uncommitted', branch: 'factory/issue-1' }); // clean before the push, not after the leftovers went
  const r = await runItem(issue, 'implement', d.deps, 4201);
  assert.deepEqual(r, { outcome: 'parked', detail: 'The agent left uncommitted changes in the worktree.' });
  assert.equal(d.checksRan, undefined);
  assert.deepEqual(d.pushed, []);
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
test('runTestFiles runs the command once per file and names the files whose run passed', real, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-testfiles-'));
  writeFileSync(join(dir, 'pass.test.mjs'), "import { test } from 'node:test';\ntest('p', () => {});\n");
  writeFileSync(join(dir, 'fail.test.mjs'), "import { test } from 'node:test';\ntest('f', () => { throw new Error('no'); });\n");
  const cfg = { ...config, ...scorePad, testFiles: [['node', ['--test', '{files}']]] };
  assert.deepEqual(await runTestFiles(dir, cfg, 4321, undefined, ['pass.test.mjs', 'fail.test.mjs']), { passed: ['pass.test.mjs'], timedOut: null });
});
test('runTestFiles runs without network', real, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-testfiles-'));
  // Only the loopback device is there without network.
  writeFileSync(join(dir, 'net.test.mjs'), "import { test } from 'node:test';\nimport { networkInterfaces } from 'node:os';\ntest('n', () => { if (Object.keys(networkInterfaces()).some((k) => k !== 'lo')) throw new Error('network'); });\n");
  const cfg = { ...config, ...scorePad, testFiles: [['node', ['--test', '{files}']]] };
  assert.deepEqual((await runTestFiles(dir, cfg, 4321, undefined, ['net.test.mjs'])).passed, ['net.test.mjs']);
});
test('runTestFiles stops on a timeout and names the command', real, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-testfiles-'));
  const cfg = { ...config, ...scorePad, checkTimeoutMin: 0.01, testFiles: [['sleep', ['{files}']]] };
  const r = await runTestFiles(dir, cfg, 4321, undefined, ['5', '0']);
  assert.deepEqual(r.passed, []);
  assert.equal(r.timedOut.failed, 'sleep 5');
  assert.match(r.timedOut.output, /timed out/);
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
test('a park with commits reads the clone\'s base, without network', async () => {
  const d = fakes({ agent: [gate(90), work()], checks: { ok: false, failed: 'npm test', output: 'x' } });
  const view = d.deps.ws.againstBase, asked = [];
  d.deps.ws.againstBase = async (dir, opts) => { asked.push(opts?.local ?? false); return view(dir, opts); };
  await runItem(issue, 'implement', d.deps, 4201);
  assert.equal(asked.at(-1), true);
  assert.ok(d.comments[0].includes("factory's local branch `factory/issue-1`"));
});
test('each check asks for the base once and reads only against that base', async () => {
  const d = fakes({ agent: [gate(90), work(), review()] });
  const view = d.deps.ws.againstBase, events = [];
  let n = 0;
  d.deps.ws.againstBase = async (dir, opts) => {
    const sha = String(++n).repeat(40), v = await view(dir, opts);
    events.push(['ask', sha, opts?.local ?? false]);
    const read = (k) => async (...a) => { events.push(['read', sha]); return v[k](...a); };
    return { sha, changes: read('changes'), diff: read('diff'), messages: read('messages') };
  };
  assert.equal((await runItem(issue, 'implement', d.deps, 4201)).outcome, 'done');
  // Before setup, the "no changes" check after implement, before the push: never the clone's ref.
  assert.deepEqual(events.filter(([e]) => e === 'ask').map(([, , local]) => local), [false, false, false]);
  let current = null;
  for (const [e, sha] of events) if (e === 'ask') current = sha; else assert.equal(sha, current, 'a read used an earlier base');
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
/** @type {[string, typeof issue, string, () => object[]][]} */
const workflowStages = [
  ['implement', issue, 'implement', () => [gate(90), work(), review()]],
  ['review', pr(), 'review', () => [work()]],
  ['merge', { ...pr(), labels: ['agent:merge'] }, 'merge', () => []],
];
for (const [name, item, stage, agent] of workflowStages) {
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
const allVars = { number: 7, branch: 'factory/issue-7', base: 'main', title: 'T', body: 'B', comments: 'C', findings: 'F', baseSha: 'b'.repeat(40) };
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
  /** @type {[typeof issue, string][]} */
  const runs = [[issue, 'explore'], [issue, 'implement'], [pr(), 'review'], [pr(), 'merge']];
  for (const [item, stage] of runs) {
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

// With autoMerge on, a small, simple, cleanly reviewed implement run hands its pull request to GitHub's auto-merge.
describe('automerge', () => {
  const T = '2026-11-01T10:00:00Z';
  const issue = {
    number: 7, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
    labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }],
    comments: [], headRef: null, headRepo: null,
  };
  const pullRequestItem = { ...issue, number: 50, kind: 'pr', labels: ['agent:review'], labelEvents: [{ label: 'agent:review', actor: 'dennis-brutski', at: T }],
    comments: [{ author: 'dennis-brutski', body: 'Rename it.', at: '2026-11-01T11:00:00Z' }], headRef: 'factory/issue-7', headRepo: 'x/y' };
  const gate = (difficulty = 'simple') => ({ confidence: 90, questions: [], difficulty, files: ['src/a.js'] });
  const work = ok({ status: 'complete', summary: 'Changed undo.', detail: '' });
  const clean = ok({ verdict: 'clean', findings: [] });
  const findings = ok({ verdict: 'findings', findings: ['Missing test for redo'] });

  /** @param {{ sessions?: object[], autoMerge?: boolean, size?: { additions: number, deletions: number }, mergeFails?: string | null, protectedChange?: boolean, existing?: object | null, heldOut?: boolean }} [opts] */
  function deps({ sessions, autoMerge = true, size = { additions: 30, deletions: 10 }, mergeFails = null, protectedChange = false, existing = null, heldOut = true } = {}) {
    const calls = [], comments = [], labels = [], seen = [];
    const held = heldOut ? { heldOutDir: '/held-out/web-app', heldOutChecks: [['node', ['--test', '{heldOut}/']]] } : {};
    const queue = [...sessions];
    let commits = 0;
    const d = {
      cfg: { ...config, ...scorePad, ...held, target: 'web-app', autoMerge }, root: '/f', log: () => {},
      runSetup: async () => ({ ok: true, failed: null, output: '' }),
      runAgent: async (a) => {
        seen.push(a.prompt.match(/<!-- session: (\w+) -->/)[1]);
        if (!a.readOnly) commits++;
        return queue.shift() ?? { ok: false, reason: 'no more scripted sessions' };
      },
      runChecks: async () => ({ ok: true, failed: null, output: '' }),
      gh: {
        addLabel: async (c, n, l) => { labels.push(l); }, removeLabel: async () => {},
        comment: async (c, n, body) => { comments.push(body); },
        findPullRequest: async () => existing,
        openPullRequest: async (c, a) => { calls.push(['open', a.draft]); return { number: 50, url: 'https://github.com/x/y/pull/50' }; },
        setDraft: async () => {}, updatePullRequestBody: async () => {},
        pullRequestSize: async (c, n) => { calls.push(['size', n]); return size; },
        autoMerge: async (c, n) => { calls.push(['merge', n]); if (mergeFails) throw new Error(mergeFails); },
      },
      ws: fakeWorkspace({
        headInfo: async () => ({ sha: `abc${commits}` }),
        againstBase: async () => fakeView({ changes: async () => [{ status: 'M', path: protectedChange ? 'package.json' : 'src/state.js' }] }),
      }),
    };
    return { d, calls, comments, labels, seen };
  }

  const merges = (x) => x.calls.filter((c) => c[0] === 'merge');

  test('all five hold: the pull request is handed to auto-merge and a comment says why', async () => {
    const x = deps({ sessions: [ok(gate()), work, clean] });
    const r = await runItem(issue, 'implement', x.d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.deepEqual(merges(x), [['merge', 50]]);
    const note = x.comments.find((b) => b.startsWith('🏭 **Auto-merge**'));
    assert.ok(note, x.comments.join('\n---\n'));
    assert.match(note, /simple/);
    assert.match(note, /review clean/);
    assert.match(note, /40 lines/);
    assert.match(note, /not a draft/);
    assert.match(note, /https:\/\/github\.com\/x\/y\/pull\/50/);
    assert.match(r.detail, /^https:\/\/github\.com\/x\/y\/pull\/50 \(handed to auto-merge\)$/);
  });

  test('a target without held-out checks is not auto-merged, and the log line says why', async () => {
    const x = deps({ sessions: [ok(gate()), work, clean], heldOut: false });
    const r = await runItem(issue, 'implement', x.d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.deepEqual(merges(x), []);
    assert.match(r.detail, /^https:\/\/github\.com\/x\/y\/pull\/50 \(not auto-merged: no held-out checks\)$/);
    assert.ok(!x.comments.some((b) => b.includes('Auto-merge')));
  });

  test('an empty heldOutChecks list counts as none', async () => {
    const x = deps({ sessions: [ok(gate()), work, clean] });
    x.d.cfg.heldOutChecks = [];
    const r = await runItem(issue, 'implement', x.d, 4201);
    assert.deepEqual(merges(x), []);
    assert.match(r.detail, /\(not auto-merged: no held-out checks\)$/);
  });

  test('a pull request with tests that pass without the change is not auto-merged, and the log line says why', async () => {
    const x = deps({ sessions: [ok(gate()), work, clean] });
    x.d.cfg = { ...x.d.cfg, testFiles: [['node', ['--test', '{files}']]] };
    x.d.ws.testsOnBase = async (dir, sha, testDirs, run) => run(['test/undo.test.js']);
    x.d.runTestFiles = async () => ({ passed: ['test/undo.test.js'], timedOut: null });
    const r = await runItem(issue, 'implement', x.d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.deepEqual(merges(x), []);
    assert.match(r.detail, /^https:\/\/github\.com\/x\/y\/pull\/50 \(not auto-merged: tests pass without the change\)$/);
  });

  test('a normal issue is not auto-merged, and the log line says why', async () => {
    const x = deps({ sessions: [ok(gate('normal')), work, clean] });
    const r = await runItem(issue, 'implement', x.d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.deepEqual(merges(x), []);
    assert.match(r.detail, /^https:\/\/github\.com\/x\/y\/pull\/50 \(not auto-merged: not simple \(normal\)\)$/);
    assert.ok(!x.comments.some((b) => b.includes('Auto-merge')));
  });

  test('100 lines or more is not auto-merged', async () => {
    const x = deps({ sessions: [ok(gate()), work, clean], size: { additions: 60, deletions: 40 } });
    const r = await runItem(issue, 'implement', x.d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.deepEqual(merges(x), []);
    assert.match(r.detail, /\(not auto-merged: 100 lines changed, needs fewer than 100\)$/);
    assert.ok(!x.comments.some((b) => b.includes('Auto-merge')));
  });

  test('a draft is not auto-merged', async () => {
    const x = deps({ sessions: [ok(gate()), work, clean], protectedChange: true });
    const r = await runItem(issue, 'implement', x.d, 4201);
    assert.equal(r.outcome, 'parked'); // as today: a draft parks
    assert.deepEqual(x.calls.filter((c) => c[0] !== 'open'), []);
  });

  test('a pull request left a draft by an earlier run is not auto-merged, and the log line says so', async () => {
    const x = deps({ sessions: [ok(gate()), work, clean], existing: { number: 50, url: 'https://github.com/x/y/pull/50', isDraft: true } });
    const r = await runItem(issue, 'implement', x.d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.deepEqual(merges(x), []);
    assert.match(r.detail, /\(not auto-merged: draft\)$/);
    assert.ok(!x.comments.some((b) => b.includes('Auto-merge')));
  });

  test('a review whose findings come back after the fix is not auto-merged; the pull request still opens', async () => {
    const x = deps({ sessions: [ok(gate()), work, findings, ok({ status: 'complete', summary: 'Fixed.', detail: '' }), findings] });
    const r = await runItem(issue, 'implement', x.d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.deepEqual(x.seen, ['gate', 'implement', 'review', 'fix', 'review']);
    assert.deepEqual(x.calls.filter((c) => c[0] === 'open'), [['open', false]]);
    assert.deepEqual(merges(x), []);
    assert.match(r.detail, /\(not auto-merged: review not clean after the fix\)$/);
    assert.ok(!x.labels.includes('agent:needs-human'));
  });

  test('findings, a fix, then a clean second review: auto-merged', async () => {
    const x = deps({ sessions: [ok(gate()), work, findings, ok({ status: 'complete', summary: 'Fixed.', detail: '' }), clean] });
    const r = await runItem(issue, 'implement', x.d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.deepEqual(x.seen, ['gate', 'implement', 'review', 'fix', 'review']);
    assert.deepEqual(merges(x), [['merge', 50]]);
    assert.match(x.comments.find((b) => b.startsWith('🏭 **Auto-merge**')), /review clean after fix/);
  });

  test('a findings verdict with no findings is not a clean review', async () => {
    const x = deps({ sessions: [ok(gate()), work, ok({ verdict: 'findings', findings: [] })] });
    const r = await runItem(issue, 'implement', x.d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.deepEqual(merges(x), []);
    assert.match(r.detail, /\(not auto-merged: review not clean\)$/);
  });

  test('autoMerge off: a second review, no size or merge call, the log line as before', async () => {
    const x = deps({ autoMerge: false, sessions: [ok(gate()), work, findings, ok({ status: 'complete', summary: 'Fixed.', detail: '' }), clean] });
    const r = await runItem(issue, 'implement', x.d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.deepEqual(x.seen, ['gate', 'implement', 'review', 'fix', 'review']);
    assert.deepEqual(x.calls, [['open', false]]);
    assert.equal(r.detail, 'https://github.com/x/y/pull/50');
  });

  test('autoMerge off: findings after the fix go into a ready pull request body as a note, with no second fix', async () => {
    const x = deps({ autoMerge: false, sessions: [ok(gate()), work, findings, ok({ status: 'complete', summary: 'Fixed.', detail: '' }),
      ok({ verdict: 'findings', findings: ['src/state.js: redo still breaks'] })] });
    let body = null;
    x.d.gh.openPullRequest = async (c, a) => { x.calls.push(['open', a.draft]); body = a.body; return { number: 50, url: 'https://github.com/x/y/pull/50' }; };
    const r = await runItem(issue, 'implement', x.d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.deepEqual(x.seen, ['gate', 'implement', 'review', 'fix', 'review']);
    assert.deepEqual(x.calls, [['open', false]]);
    assert.match(body, /## Review findings after the fix\n\n- src\/state\.js: redo still breaks\n/);
    assert.ok(!x.labels.includes('agent:needs-human'));
  });

  test('autoMerge unset counts as off', async () => {
    const x = deps({ sessions: [ok(gate()), work, clean] });
    delete x.d.cfg.autoMerge;
    const r = await runItem(issue, 'implement', x.d, 4201);
    assert.deepEqual(x.calls, [['open', false]]);
    assert.equal(r.detail, 'https://github.com/x/y/pull/50');
  });

  test('a failed merge call is reported in a comment, and the run still ends done', async () => {
    const x = deps({ sessions: [ok(gate()), work, clean], mergeFails: 'gh pr merge failed: Auto merge is not allowed for this repository' });
    const r = await runItem(issue, 'implement', x.d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.ok(!x.labels.includes('agent:needs-human'));
    assert.ok(x.labels.includes('agent:done'));
    const note = x.comments.find((b) => b.includes('Auto merge is not allowed'));
    assert.ok(note, x.comments.join('\n---\n'));
    assert.ok(note.startsWith('🏭'));
    assert.ok(!note.startsWith('🏭 **Auto-merge**'), 'stats must not count a failed hand-over');
    assert.match(note, /merge it by hand/i);
    assert.match(r.detail, /\(not auto-merged: the merge call failed\)$/);
  });

  test('if the size cannot be read, it is not auto-merged and the run still ends done', async () => {
    const x = deps({ sessions: [ok(gate()), work, clean] });
    x.d.gh.pullRequestSize = async () => { throw new Error('gh pr view failed: boom'); };
    const r = await runItem(issue, 'implement', x.d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.deepEqual(merges(x), []);
    assert.match(r.detail, /\(not auto-merged: could not read its size: gh pr view failed: boom\)$/);
  });

  test('a rework run never auto-merges', async () => {
    const x = deps({ sessions: [work] });
    const r = await runItem(pullRequestItem, 'review', x.d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.deepEqual(x.calls, []);
  });

  test('a merge run never auto-merges', async () => {
    const x = deps({ sessions: [] });
    const r = await runItem({ ...pullRequestItem, labels: ['agent:merge'] }, 'merge', x.d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.deepEqual(x.calls, []);
  });
});

// explore and implement resolve a conflict with the base with a merge session, as the merge stage does.
describe('merge session', () => {
  const config = factoryConfig;

  const T = '2026-11-01T10:00:00Z';
  const issue = {
    number: 1, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
    labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }],
    comments: [], headRef: null, headRepo: null,
  };

  function fakes({ merge = 'conflict', resolved = true, before = { park: null, flags: [] } } = {}) {
    const d = { events: [], comments: [], sessions: [] };
    d.deps = {
      cfg: { ...config, ...scorePad }, root: '/f', log: () => {},
      runSetup: async () => { d.events.push('setup'); return { ok: true, failed: null, output: '' }; },
      runAgent: async (a) => {
        const name = a.prompt.split('\n')[0].replace(/<!-- session: (\w+) -->/, '$1');
        d.sessions.push(name); d.events.push(`session ${name}`);
        return ok({ status: 'complete', summary: 'Merged.', detail: 'Could not decide.' });
      },
      runChecks: async () => ({ ok: true, failed: null, output: '' }),
      gh: {
        addLabel: async () => {}, removeLabel: async () => {},
        comment: async (c, n, b) => { d.comments.push(b); },
        findPullRequest: async () => null,
        openPullRequest: async () => ({ number: 50, url: 'https://github.com/x/y/pull/50' }),
        setDraft: async () => {}, updatePullRequestBody: async () => {},
      },
      ws: fakeWorkspace({
        ensureWorktree: async (n) => ({ dir: `/f/worktrees/issue-${n}`, created: false }),
        mergeBase: async () => { d.events.push('mergeBase'); return merge; },
        abortMerge: async () => { d.events.push('abortMerge'); },
        mergeResolved: async () => { d.events.push('mergeResolved'); return resolved; },
      }),
    };
    return d;
  }

  for (const stage of ['implement', 'explore']) {
    test(`${stage}: a merge session that leaves the merge unresolved parks and runs no other session`, async () => {
      const d = fakes({ resolved: false });
      const r = await runItem({ ...issue, labels: [`agent:${stage}`] }, stage, d.deps, 4201);
      assert.equal(r.outcome, 'parked');
      assert.deepEqual(d.sessions, ['merge']);
      assert.match(d.comments.at(-1), /The merge is still unresolved\. The worktree is left mid-merge\.\n\nCould not decide\./);
    });

    test(`${stage}: the merge session runs after setup, on a fresh merge`, async () => {
      const d = fakes();
      await runItem({ ...issue, labels: [`agent:${stage}`] }, stage, d.deps, 4201);
      const setup = d.events.indexOf('setup');
      assert.ok(setup >= 0, d.events.join(', '));
      assert.equal(d.events[setup + 1], 'mergeBase', d.events.join(', '));
      assert.equal(d.events[setup + 2], 'session merge', d.events.join(', '));
      assert.equal(d.events[setup + 3], 'mergeResolved', d.events.join(', '));
    });

    test(`${stage}: setup does not run on a half-merged tree`, async () => {
      const d = fakes();
      await runItem({ ...issue, labels: [`agent:${stage}`] }, stage, d.deps, 4201);
      const setup = d.events.indexOf('setup');
      assert.ok(d.events.slice(0, setup).lastIndexOf('abortMerge') > d.events.slice(0, setup).lastIndexOf('mergeBase'), d.events.join(', '));
    });

    test(`${stage}: a clean merge with the base runs no merge session`, async () => {
      const d = fakes({ merge: 'clean' });
      await runItem({ ...issue, labels: [`agent:${stage}`] }, stage, d.deps, 4201);
      assert.ok(!d.sessions.includes('merge'), d.sessions.join(', '));
    });
  }

  test('review runs no merge session', async () => {
    const d = fakes();
    const pr = { ...issue, number: 4, kind: 'pr', labels: ['agent:review'], headRef: 'factory/issue-1', headRepo: 'example/web-app' };
    await runItem(pr, 'review', d.deps, 4201);
    assert.ok(!d.sessions.includes('merge'), d.sessions.join(', '));
    assert.ok(!d.events.includes('mergeBase'));
  });
});

// The latest base branch is merged into a reused worktree before explore and implement.
describe('base branch merge', () => {
  const config = factoryConfig;

  const T = '2026-11-01T10:00:00Z';
  const issue = {
    number: 1, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
    labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }],
    comments: [], headRef: null, headRepo: null,
  };

  function fakes(merge) {
    const d = { events: [], comments: [] };
    const queue = [
      ok({ confidence: 90, questions: [] }),
      ok({ status: 'complete', summary: 'Changed it.', detail: '' }),
      ok({ verdict: 'clean', findings: [] }),
    ];
    d.deps = {
      cfg: { ...config, ...scorePad }, root: '/f', log: () => {},
      runSetup: async () => { d.events.push('setup'); return { ok: true, failed: null, output: '' }; },
      runAgent: async (a) => { d.events.push('agent'); return queue.shift(); },
      runChecks: async () => ({ ok: true, failed: null, output: '' }),
      gh: {
        addLabel: async () => {}, removeLabel: async () => {},
        comment: async (c, n, b) => { d.comments.push(b); },
        findPullRequest: async () => null,
        openPullRequest: async () => ({ number: 50, url: 'https://github.com/x/y/pull/50' }),
        setDraft: async () => {}, updatePullRequestBody: async () => {},
      },
      ws: fakeWorkspace({
        ensureWorktree: async (n) => ({ dir: `/f/worktrees/issue-${n}`, created: false }),
        mergeBase: async (dir) => { d.events.push(`mergeBase ${dir}`); return merge; },
        abortMerge: async (dir) => { d.events.push(`abortMerge ${dir}`); },
        push: async () => { d.events.push('push'); },
      }),
    };
    return d;
  }

  for (const stage of ['implement', 'explore']) {
    test(`${stage}: the base branch is merged in before the first session`, async () => {
      const d = fakes('clean');
      await runItem({ ...issue, labels: [`agent:${stage}`] }, stage, d.deps, 4201);
      const merged = d.events.indexOf('mergeBase /f/worktrees/issue-1');
      assert.ok(merged >= 0, d.events.join(', '));
      assert.ok(merged < d.events.indexOf('agent'), d.events.join(', '));
    });

    test(`${stage}: a conflict with the base runs a merge session after setup and does not park`, async () => {
      const d = fakes('conflict');
      const queue = stage === 'explore'
        ? [ok({ status: 'complete', summary: 'Merged.', detail: '' }), ok({ writeup: 'Fine.', easy_to_undo: true, small_reach: true })]
        : [ok({ status: 'complete', summary: 'Merged.', detail: '' }), ok({ confidence: 90, questions: [] }),
          ok({ status: 'complete', summary: 'Changed it.', detail: '' }), ok({ verdict: 'clean', findings: [] })];
      const sessions = [];
      d.deps.runAgent = async (a) => { sessions.push(a.prompt.split('\n')[0]); d.events.push('agent'); return queue.shift(); };
      const r = await runItem({ ...issue, labels: [`agent:${stage}`] }, stage, d.deps, 4201);
      assert.notEqual(r.outcome, 'parked', r.detail);
      assert.equal(sessions[0], '<!-- session: merge -->');
      assert.equal(sessions.filter((s) => s === '<!-- session: merge -->').length, 1);
      assert.ok(sessions.length > 1, sessions.join(', '));
      assert.ok(d.events.indexOf('setup') < d.events.indexOf('agent'), d.events.join(', '));
      assert.ok(!d.comments.some((c) => /Merge it by hand/.test(c)));
    });
  }

  test('review does not merge the base branch', async () => {
    const d = fakes('clean');
    const pr = { ...issue, number: 4, kind: 'pr', labels: ['agent:review'], headRef: 'factory/issue-1', headRepo: 'example/web-app' };
    await runItem(pr, 'review', d.deps, 4201);
    assert.ok(!d.events.some((e) => e.startsWith('mergeBase')));
  });
});

describe('owner comments in prompts', () => {
  const T = '2026-11-01T10:00:00Z';
  const issue = {
    number: 1, kind: 'issue', title: 'Fix undo', body: 'Undo fails on an empty ledger', author: 'dennis-brutski', bodyEditedAt: null,
    labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }],
    comments: [{ author: 'dennis-brutski', body: 'Keep the empty ledger read-only', at: T }], headRef: null, headRepo: null,
  };

  function deps(agent) {
    const calls = [];
    const queue = [...agent];
    const d = {
      cfg: { ...config, ...scorePad }, root: '/f', log: () => {},
      runSetup: async () => ({ ok: true, failed: null, output: '' }),
      runAgent: async (a) => { calls.push(a); const r = queue.shift(); if (!r) throw new Error('unexpected agent call'); return r; },
      runChecks: async () => ({ ok: true, failed: null, output: '' }),
      gh: {
        addLabel: async () => {}, removeLabel: async () => {}, comment: async () => {},
        findPullRequest: async () => null,
        openPullRequest: async () => ({ number: 50, url: 'https://github.com/x/y/pull/50' }),
        setDraft: async () => {}, updatePullRequestBody: async () => {},
      },
      ws: fakeWorkspace({
        headInfo: async () => ({ sha: `abc${calls.filter((a) => !a.readOnly).length}` }),
        againstBase: async () => fakeView({ messages: async () => ['Fix undo on empty ledger'] }),
      }),
    };
    return { d, calls };
  }

  test("review and fix prompts include the owner's comments", async () => {
    const work = ok({ status: 'complete', summary: 'Changed the undo guard.', detail: '' });
    const { d, calls } = deps([ok({ confidence: 90, questions: [] }), work, ok({ verdict: 'findings', findings: ['x'] }), work, ok({ verdict: 'clean', findings: [] })]);
    const r = await runItem(issue, 'implement', d, 4201);
    assert.equal(r.outcome, 'done');
    assert.equal(calls.length, 5);
    const [, , reviewCall, fixCall] = calls;
    assert.match(reviewCall.prompt, /### Comments from Dennis\n\n- .*Keep the empty ledger read-only/);
    assert.match(fixCall.prompt, /### Comments from Dennis\n\n- .*Keep the empty ledger read-only/);
  });
});

// An agent that left HEAD detached on top of its branch does not cost the run.
describe('detached HEAD', () => {
  const config = factoryConfig;

  const T = '2026-11-01T10:00:00Z';
  const issue = {
    number: 1, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
    labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }],
    comments: [], headRef: null, headRepo: null,
  };

  function deps(branchAfter, attaches) {
    const pushed = [], logs = [], attached = [];
    let onBranch = true;
    const queue = [ok({ confidence: 90, questions: [] }), ok({ status: 'complete', summary: 'Done.', detail: '' }), ok({ verdict: 'clean', findings: [] })];
    const d = {
      cfg: { ...config, ...scorePad }, root: '/f', log: (m) => logs.push(m),
      runSetup: async () => ({ ok: true, failed: null, output: '' }),
      runAgent: async () => { const r = queue.shift(); if (!queue.length) onBranch = false; return r; },
      runChecks: async () => ({ ok: true, failed: null, output: '' }),
      gh: {
        addLabel: async () => {}, removeLabel: async () => {}, comment: async () => {}, findPullRequest: async () => null,
        openPullRequest: async () => ({ number: 50, url: 'https://github.com/x/y/pull/50' }),
        setDraft: async () => {}, updatePullRequestBody: async () => {},
      },
      ws: fakeWorkspace({
        // As the real one: only a detached HEAD on top of the branch is moved.
        preparePush: async (dir, branch) => {
          if (onBranch) return { sha: 'abc', reattached: false };
          if (branchAfter === null && attaches) { attached.push(branch); return { sha: 'abc', reattached: true }; }
          return { refused: 'not-on-branch', branch: branchAfter };
        },
        push: async (dir, branch, sha) => { pushed.push([branch, sha]); },
      }),
    };
    return { d, pushed, logs, attached };
  }

  test('detached on top of the branch: the branch is moved, then pushed', async () => {
    const { d, pushed, logs, attached } = deps(null, true);
    const r = await runItem(issue, 'implement', d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.deepEqual(attached, ['factory/issue-1']);
    assert.deepEqual(pushed, [['factory/issue-1', 'abc']]);
    assert.ok(logs.some((m) => /#1 HEAD was detached; moved factory\/issue-1 to abc/.test(m)), logs.join('\n'));
  });

  test('detached somewhere else: parks as before, no push', async () => {
    const { d, pushed } = deps(null, false);
    const r = await runItem(issue, 'implement', d, 4201);
    assert.equal(r.outcome, 'parked');
    assert.match(r.detail, /HEAD is detached/);
    assert.deepEqual(pushed, []);
  });

  test('on another branch: parks as before and does not try to move anything', async () => {
    const { d, pushed, attached } = deps('main', true);
    const r = await runItem(issue, 'implement', d, 4201);
    assert.equal(r.outcome, 'parked');
    assert.match(r.detail, /HEAD is on `main`/);
    assert.deepEqual([pushed, attached], [[], []]);
  });
});

// A stop for a draft tells the owner to read the flagged changes, not to try again.
describe('draft stops', () => {
  const issue = {
    number: 7, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
    labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: '2026-11-01T10:00:00Z' }],
    comments: [], headRef: null, headRepo: null,
  };
  const pr = { ...issue, kind: 'pr', headRef: 'factory/issue-7', labels: ['agent:merge'] };

  function deps() {
    const opened = [], comments = [];
    const queue = [ok({ confidence: 87, questions: [] }), ok({ status: 'complete', summary: 'Changed undo.', detail: '' }), ok({ verdict: 'clean', findings: [] })];
    let sessions = 0;
    const d = {
      cfg: { ...config, ...scorePad, target: 'web-app', model: 'opus-test', gateModel: 'opus-test' }, root: '/f', log: () => {},
      runSetup: async () => ({ ok: true, failed: null, output: '' }),
      runAgent: async (a) => { if (!a.readOnly) sessions++; return queue.shift(); },
      runChecks: async () => ({ ok: true, failed: null, output: '' }),
      gh: {
        addLabel: async () => {}, removeLabel: async () => {}, comment: async (c, n, body) => { comments.push(body); },
        findPullRequest: async () => null,
        openPullRequest: async (c, a) => { opened.push(a); return { number: 50, url: 'https://github.com/x/y/pull/50' }; },
        setDraft: async () => {}, updatePullRequestBody: async () => {},
      },
      ws: fakeWorkspace({
        ensureWorktree: async (n) => ({ dir: `/f/worktrees/issue-${n}`, created: true }),
        headInfo: async () => ({ sha: `abc${sessions}` }),
        againstBase: async () => fakeView({ changes: async () => [{ status: 'M', path: 'test/unit/scoring.test.js' }], messages: async () => ['Fix undo'] }),
        isClean: async () => true, mergeBase: async () => 'clean',
        push: async () => {},
      }),
    };
    return { d, opened, comments };
  }

  function assertDraftStop(body) {
    assert.match(body, /^🏭 \*\*Factory stopped \(/);
    assert.doesNotMatch(body, /touches protected files/);
    assert.doesNotMatch(body, /try again/);
    assert.doesNotMatch(body, /local branch/);
    assert.match(body, /mark it ready/);
    assert.match(body, /`agent:review`/);
    assert.match(body, /test\/unit\/scoring\.test\.js/);
  }

  test('an implement draft stop says to read the changes, not to try again', async () => {
    const { d, comments, opened } = deps();
    const r = await runItem(issue, 'implement', d, 4201);
    assert.equal(r.outcome, 'parked');
    assertDraftStop(comments.at(-1));
    assert.doesNotMatch(opened[0].body, /touches protected files/);
    assert.match(opened[0].body, /^> ⚠ This pull request changes files you should check:/);
  });

  test('a rework draft stop says to read the changes, not to try again', async () => {
    const asked = { ...pr, labels: ['agent:review'], comments: [{ author: 'dennis-brutski', body: 'Rename it.', at: '2026-11-05T10:00:00Z' }] };
    const { d, comments } = deps();
    d.runAgent = async () => ok({ status: 'complete', summary: 'Renamed.', detail: '' });
    let n = 0;
    d.ws.headInfo = async () => ({ sha: `abc${n++}` });
    const r = await runItem(asked, 'review', d, 4201);
    assert.equal(r.outcome, 'parked');
    assertDraftStop(comments.at(-1));
  });

  test('a merge draft stop says to read the changes, not to try again', async () => {
    const { d, comments } = deps();
    const r = await runItem(pr, 'merge', d, 4201);
    assert.equal(r.outcome, 'parked');
    assertDraftStop(comments.at(-1));
  });
});

// The gate can run on its own, cheaper model; every other session keeps cfg.model.
describe('gate model', () => {
  const config = factoryConfig;

  const issue = {
    number: 7, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
    labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: '2026-11-01T10:00:00Z' }],
    comments: [], headRef: null, headRepo: null,
  };

  function deps(models) {
    const opened = [], seen = [];
    const queue = [ok({ confidence: 87, questions: [] }), ok({ status: 'complete', summary: 'Changed undo.', detail: '' }), ok({ verdict: 'clean', findings: [] })];
    let sessions = 0;
    const d = {
      cfg: { ...config, ...scorePad, target: 'web-app', ...models }, root: '/f', log: () => {},
      runSetup: async () => ({ ok: true, failed: null, output: '' }),
      runAgent: async (a) => { seen.push(a.cfg.model); if (!a.readOnly) sessions++; return queue.shift(); },
      runChecks: async () => ({ ok: true, failed: null, output: '' }),
      gh: {
        addLabel: async () => {}, removeLabel: async () => {}, comment: async () => {},
        findPullRequest: async () => null,
        openPullRequest: async (c, a) => { opened.push(a); return { number: 50, url: 'https://github.com/x/y/pull/50' }; },
        setDraft: async () => {}, updatePullRequestBody: async () => {},
      },
      ws: fakeWorkspace({
        ensureWorktree: async (n) => ({ dir: `/f/worktrees/issue-${n}`, created: true }),
        headInfo: async () => ({ sha: `abc${sessions}` }),
        againstBase: async () => fakeView({ changes: async () => [{ status: 'M', path: 'src/state.js' }], messages: async () => ['Fix undo'] }),
        isClean: async () => true, mergeBase: async () => 'clean',
        push: async () => {},
      }),
    };
    return { d, opened, seen };
  }

  const run = async (models) => {
    const x = deps(models);
    const r = await runItem(issue, 'implement', x.d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    return { ...x, last: x.opened[0].body.trimEnd().split('\n').at(-1) };
  };

  test('the gate runs on gateModel, implement and review on model', async () => {
    const { seen, d } = await run({ model: 'opus', gateModel: 'sonnet' });
    assert.deepEqual(seen, ['sonnet', 'opus', 'opus']); // gate, implement, review
    assert.equal(d.cfg.model, 'opus'); // the shared settings are not changed
  });

  test('without gateModel the gate runs on model', async () => {
    for (const gateModel of [undefined, null]) {
      const { seen } = await run({ model: 'opus', gateModel });
      assert.deepEqual(seen, ['opus', 'opus', 'opus']);
    }
  });

  test('the provenance line names the gate model only when it differs', async () => {
    assert.match((await run({ model: 'opus', gateModel: 'sonnet' })).last, / · model opus \(gate sonnet\) · gate confidence 87 · /);
    for (const gateModel of ['opus', undefined, null])
      assert.match((await run({ model: 'opus', gateModel })).last, / · model opus · gate confidence 87 · /);
  });
});

// A cheaper model may write the first draft of a simple issue; review and fix stay on cfg.model.
describe('implement model', () => {
  const issue = {
    number: 7, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
    labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: '2026-11-01T10:00:00Z' }],
    comments: [], headRef: null, headRepo: null,
  };
  const simpleGate = { confidence: 90, questions: [], difficulty: 'simple', files: ['src/a.js'] };

  function deps(gate, models, review = { verdict: 'clean', findings: [] }) {
    const opened = [], seen = [];
    const queue = [ok(gate), ok({ status: 'complete', summary: 'Changed undo.', detail: '' }), ok(review),
      ok({ status: 'complete', summary: 'Fixed.', detail: '' }), ok({ verdict: 'clean', findings: [] })];
    let sessions = 0;
    const d = {
      cfg: { ...config, ...scorePad, target: 'web-app', ...models }, root: '/f', log: () => {},
      runSetup: async () => ({ ok: true, failed: null, output: '' }),
      runAgent: async (a) => {
        seen.push({ session: a.prompt.match(/<!-- session: (\w+) -->/)[1], model: a.cfg.model });
        if (!a.readOnly) sessions++;
        return queue.shift();
      },
      runChecks: async () => ({ ok: true, failed: null, output: '' }),
      gh: {
        addLabel: async () => {}, removeLabel: async () => {}, comment: async () => {},
        findPullRequest: async () => null,
        openPullRequest: async (c, a) => { opened.push(a); return { number: 50, url: 'https://github.com/x/y/pull/50' }; },
        setDraft: async () => {}, updatePullRequestBody: async () => {},
      },
      ws: fakeWorkspace({
        ensureWorktree: async (n) => ({ dir: `/f/worktrees/issue-${n}`, created: true }),
        headInfo: async () => ({ sha: `abc${sessions}` }),
        againstBase: async () => fakeView({ changes: async () => [{ status: 'M', path: 'src/state.js' }], messages: async () => ['Fix undo'] }),
        isClean: async () => true, mergeBase: async () => 'clean',
        push: async () => {},
      }),
    };
    return { d, opened, seen };
  }

  const run = async (gate, models, review) => {
    const x = deps(gate, models, review);
    const r = await runItem(issue, 'implement', x.d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    return { ...x, last: x.opened[0].body.trimEnd().split('\n').at(-1) };
  };

  test('the gate reports difficulty and the likely files', () => {
    const { properties, required } = schemas.gate;
    assert.deepEqual(properties.difficulty.enum, ['simple', 'normal', 'hard']);
    assert.equal(properties.files.type, 'array');
    assert.ok(required.includes('difficulty') && required.includes('files'));
    assert.ok(required.includes('confidence') && required.includes('questions'));
  });

  test('the gate reports contradictions and missing files as lists', () => {
    const { properties, required } = schemas.gate;
    assert.deepEqual(properties.contradictions, { type: 'array', items: { type: 'string' } });
    assert.deepEqual(properties.missing, { type: 'array', items: { type: 'string' } });
    assert.ok(required.includes('contradictions') && required.includes('missing'));
  });

  test('a simple issue is drafted on simpleModel, reviewed and fixed on model', async () => {
    const { seen } = await run(simpleGate, { model: 'opus', gateModel: 'sonnet', simpleModel: 'sonnet' },
      { verdict: 'findings', findings: ['Missing test for redo'] });
    assert.deepEqual(seen, [
      { session: 'gate', model: 'sonnet' }, { session: 'implement', model: 'sonnet' },
      { session: 'review', model: 'opus' }, { session: 'fix', model: 'opus' }, { session: 'review', model: 'opus' },
    ]);
  });

  test('a normal issue is drafted on model', async () => {
    const { seen } = await run({ ...simpleGate, difficulty: 'normal' }, { model: 'opus', gateModel: 'sonnet', simpleModel: 'sonnet' });
    assert.deepEqual(seen.map((s) => s.model), ['sonnet', 'opus', 'opus']);
  });

  test('a re-run after a stop is drafted on model', async () => {
    const x = deps(simpleGate, { model: 'opus', gateModel: 'sonnet', simpleModel: 'sonnet' });
    const again = { ...issue, comments: [{ author: 'dennis-brutski', at: '2026-11-01T11:00:00Z',
      body: stopped('implement', 'The implement step failed: timeout', 'agent:needs-human') }] };
    const r = await runItem(again, 'implement', x.d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.deepEqual(x.seen.map((s) => s.model), ['sonnet', 'opus', 'opus']);
  });

  test('the provenance line names the implement model only when it differs', async () => {
    assert.match((await run(simpleGate, { model: 'opus', gateModel: 'sonnet', simpleModel: 'sonnet' })).last,
      / · model opus \(gate sonnet\) · implement sonnet \(simple\) · gate confidence 90 · /);
    assert.match((await run({ ...simpleGate, difficulty: 'hard' }, { model: 'opus', gateModel: 'sonnet', simpleModel: 'sonnet' })).last,
      / · model opus \(gate sonnet\) · gate confidence 90 · /);
    assert.match((await run(simpleGate, { model: 'opus', gateModel: 'opus', simpleModel: null })).last,
      / · model opus · gate confidence 90 · /);
  });
});

// Sandbox leftovers from this run's sessions are cleared before the factory looks at the worktree and runs the checks.
describe('leftovers', () => {
  const config = factoryConfig;

  const T = '2026-11-01T10:00:00Z';
  const issue = {
    number: 1, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
    labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }],
    comments: [], headRef: null, headRepo: null,
  };

  test('leftovers are removed before the clean check and the checks', async () => {
    const order = [];
    const queue = [ok({ confidence: 90, questions: [] }), ok({ status: 'complete', summary: 'Done.', detail: '' }), ok({ verdict: 'clean', findings: [] })];
    let sessionsDone = false;
    const d = {
      cfg: { ...config, ...scorePad }, root: '/f', log: () => {},
      runSetup: async () => ({ ok: true, failed: null, output: '' }),
      runAgent: async () => { const r = queue.shift(); if (!queue.length) sessionsDone = true; return r; },
      runChecks: async () => { order.push('checks'); return { ok: true, failed: null, output: '' }; },
      gh: {
        addLabel: async () => {}, removeLabel: async () => {}, comment: async () => {}, findPullRequest: async () => null,
        openPullRequest: async () => ({ number: 50, url: 'https://github.com/x/y/pull/50' }),
        setDraft: async () => {}, updatePullRequestBody: async () => {},
      },
      ws: fakeWorkspace({
        isClean: async () => { if (sessionsDone) order.push('clean?'); return true; }, // the review's read-only check
        preparePush: async () => { if (sessionsDone) order.push('leftovers, clean?'); return { sha: 'abc', reattached: false }; },
      }),
    };
    const r = await runItem(issue, 'implement', d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.deepEqual(order.slice(-2), ['leftovers, clean?', 'checks']); // leftovers before the clean check: test/workspace.test.mjs
  });
});

describe('provenance', () => {
  const config = factoryConfig;

  const issue = {
    number: 7, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
    labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: '2026-11-01T10:00:00Z' }],
    comments: [], headRef: null, headRepo: null,
  };

  function deps(extra = {}) {
    const opened = [];
    const queue = [ok({ confidence: 87, questions: [] }), ok({ status: 'complete', summary: 'Changed undo.', detail: '' }), ok({ verdict: 'clean', findings: [] })];
    let sessions = 0;
    const d = {
      cfg: { ...config, ...scorePad, target: 'web-app', model: 'opus-test', gateModel: 'opus-test' }, root: '/f', log: () => {},
      runSetup: async () => ({ ok: true, failed: null, output: '' }),
      runAgent: async (a) => { if (!a.readOnly) sessions++; return queue.shift(); },
      runChecks: async () => ({ ok: true, failed: null, output: '' }),
      gh: {
        addLabel: async () => {}, removeLabel: async () => {}, comment: async () => {},
        findPullRequest: async () => null,
        openPullRequest: async (c, a) => { opened.push(a); return { number: 50, url: 'https://github.com/x/y/pull/50' }; },
        setDraft: async () => {}, updatePullRequestBody: async () => {},
      },
      ws: fakeWorkspace({
        ensureWorktree: async (n) => ({ dir: `/f/worktrees/issue-${n}`, created: true }),
        headInfo: async () => ({ sha: `abc${sessions}` }),
        againstBase: async () => fakeView({ changes: async () => [{ status: 'M', path: 'src/state.js' }], messages: async () => ['Fix undo'] }),
        isClean: async () => true, mergeBase: async () => 'clean',
        push: async () => {},
      }),
      ...extra,
    };
    return { d, opened };
  }

  test('the pull request body ends with how it was built', async () => {
    const { d, opened } = deps({ factoryCommit: 'f00ba12' });
    const r = await runItem(issue, 'implement', d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    const body = opened[0].body;
    const checks = d.cfg.checks.map(([c, a]) => `\`${[c, ...a].join(' ')}\``).join(', ');
    const last = body.trimEnd().split('\n').at(-1);
    assert.equal(last, `🏭 Built by issue-to-pr-factory f00ba12 · model opus-test · gate confidence 87 · checks: ${checks} · session logs: runs/web-app/logs/issue-7/`);
    assert.match(body, /\n---\n🏭 Built by/);
    assert.match(body, /Closes #7/);
  });

  test('a target without checks says (none) in the footer', async () => {
    const { d, opened } = deps();
    d.cfg = { ...d.cfg, checks: [] };
    const r = await runItem(issue, 'implement', d, 4201);
    assert.equal(r.outcome, 'done', r.detail);
    assert.match(opened[0].body, / · checks: \(none\) · session logs: /);
  });

  test('an unknown factory commit says unknown', async () => {
    const { d, opened } = deps();
    await runItem(issue, 'implement', d, 4201);
    assert.match(opened[0].body, /🏭 Built by issue-to-pr-factory unknown · model opus-test · gate confidence 87 ·/);
  });
});

describe('park and pull request text', () => {
  const issue = {
    number: 7, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
    labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: '2026-11-01T10:00:00Z' }],
    comments: [], headRef: null, headRepo: null,
  };
  const OUTPUT = 'not ok 1 - undo\n  ```\n  expected 2\nnot ok 2 - redo';

  /** @param {{ gate?: { confidence: number, questions: string[], contradictions?: string[], missing?: string[] }, changes?: { status: string, path: string }[], runSetup?: () => Promise<object>, runChecks?: () => Promise<object>, factoryCommit?: string }} [opts] */
  function deps({ gate = { confidence: 87, questions: [] }, changes = [{ status: 'M', path: 'src/state.js' }], ...extra } = {}) {
    const opened = [], comments = [];
    const queue = [ok(gate), ok({ status: 'complete', summary: 'Changed undo.', detail: '' }), ok({ verdict: 'clean', findings: [] })];
    let sessions = 0;
    const d = {
      cfg: { ...config, ...scorePad, target: 'web-app', model: 'opus-test', gateModel: 'opus-test' }, root: '/f', log: () => {},
      runSetup: async () => ({ ok: true, failed: null, output: '' }),
      runAgent: async (a) => { if (!a.readOnly) sessions++; return queue.shift(); },
      runChecks: async () => ({ ok: true, failed: null, output: '' }),
      gh: {
        addLabel: async () => {}, removeLabel: async () => {}, comment: async (c, n, body) => { comments.push(body); },
        findPullRequest: async () => null,
        openPullRequest: async (c, a) => { opened.push(a); return { number: 50, url: 'https://github.com/x/y/pull/50' }; },
        setDraft: async () => {}, updatePullRequestBody: async () => {},
      },
      ws: fakeWorkspace({
        ensureWorktree: async (n) => ({ dir: `/f/worktrees/issue-${n}`, created: true }),
        headInfo: async () => ({ sha: `abc${sessions}` }),
        againstBase: async () => fakeView({ changes: async () => changes, messages: async () => ['Fix undo'] }),
        isClean: async () => true, mergeBase: async () => 'clean',
        push: async () => {},
      }),
      ...extra,
    };
    return { d, opened, comments };
  }
  const folded = (output, n) => `<details><summary>Output (${n})</summary>\n\n\`\`\`\n${output.replaceAll('```', "'''")}\n\`\`\`\n\n</details>`;
  const asComment = (body) => ({ author: 'dennis-brutski', body, at: '2026-11-02T10:00:00Z' });

  test('a failing check parks with its first sentence and the full output folded away', async () => {
    const { d, comments } = deps({ runChecks: async () => ({ ok: false, failed: 'npm test', output: OUTPUT }) });
    const r = await runItem(issue, 'implement', d, 4201);
    assert.equal(r.outcome, 'parked');
    assert.equal(r.detail, `\`npm test\` failed when the factory ran the checks:\n\n${folded(OUTPUT, '4 lines')}`);
    assert.equal(stopLabel(comments.at(-1)), 'a check failed');
    assert.ok(lastStopReason({ comments: [asComment(comments.at(-1))] }, d.cfg).includes(OUTPUT.replaceAll('```', "'''")));
  });

  test('a failing setup parks with its first sentence and one line of output folded away', async () => {
    const { d, comments } = deps({ runSetup: async () => ({ ok: false, failed: 'npm ci', output: 'npm ERR! missing lock' }) });
    const r = await runItem(issue, 'implement', d, 4201);
    assert.equal(r.detail, `\`npm ci\` failed in the worktree (setup):\n\n${folded('npm ERR! missing lock', '1 line')}`);
    assert.equal(stopLabel(comments.at(-1)), 'setup failed');
    assert.ok(lastStopReason({ comments: [asComment(comments.at(-1))] }, d.cfg).includes('npm ERR! missing lock'));
  });

  test('a trailing newline in the output does not count as another line', async () => {
    const { d } = deps({ runSetup: async () => ({ ok: false, failed: 'npm ci', output: 'npm ERR! missing lock\n' }) });
    const r = await runItem(issue, 'implement', d, 4201);
    assert.match(r.detail, /<summary>Output \(1 line\)<\/summary>/);
    assert.ok(r.detail.includes('npm ERR! missing lock'));
  });

  test('the pull request body has headings, one tick per check, and the footer last', async () => {
    const { d, opened } = deps({ factoryCommit: 'f00ba12' });
    await runItem(issue, 'implement', d, 4201);
    const body = opened[0].body;
    assert.match(body, /^Closes #7\n\n## What changed\n\nChanged undo\.\n\n## Checks\n\n✅ `npm test`\n✅ `npm run e2e`\n/);
    assert.match(body, /\n---\n🏭 Built by issue-to-pr-factory f00ba12 · [^\n]+$/);
  });

  test('park reasons leave an empty line before each list', async () => {
    const unclear = deps({ gate: { confidence: 20, questions: ['Which?'] } });
    const r1 = await runItem(issue, 'implement', unclear.d, 4201);
    assert.match(r1.detail, /Questions:\n\n- Which\?/);

    const touched = deps({ changes: [{ status: 'M', path: 'test/unit/scoring.test.js' }] });
    const r2 = await runItem(issue, 'implement', touched.d, 4201);
    assert.match(r2.detail, /is a draft because it changes files you should check:\n\n- /);
  });

  test('a contradiction stops the run whatever the confidence, and the stop lists it', async () => {
    const { d, comments, opened } = deps({ gate: { confidence: 90, questions: ['Which one?'], contradictions: ['Item 2 says A, item 4 says not A'], missing: [] } });
    const r = await runItem(issue, 'implement', d, 4201);
    assert.equal(r.outcome, 'parked');
    assert.equal(r.detail, [
      `This issue is not clear enough to build without guessing (confidence 90 of 100, needs ${d.cfg.confidenceThreshold}).`,
      'Contradictions:\n\n- Item 2 says A, item 4 says not A',
      'Questions:\n\n- Which one?',
      'Answer in a comment, then remove the label.',
    ].join('\n\n'));
    assert.equal(stopLabel(comments.at(-1)), 'not clear enough');
    assert.equal(opened.length, 0);
  });

  test('the gate\'s stop lists missing files after the questions', async () => {
    const { d } = deps({ gate: { confidence: 20, questions: ['Which?'], contradictions: [], missing: ['lib/undo.mjs'] } });
    const r = await runItem(issue, 'implement', d, 4201);
    assert.equal(r.detail, [
      `This issue is not clear enough to build without guessing (confidence 20 of 100, needs ${d.cfg.confidenceThreshold}).`,
      'Questions:\n\n- Which?',
      'Missing:\n\n- lib/undo.mjs',
      'Answer in a comment, then remove the label.',
    ].join('\n\n'));
  });

  test('missing entries alone do not stop a run, and later stops do not list them', async () => {
    const clear = deps({ gate: { confidence: 90, questions: [], contradictions: [], missing: ['lib/undo.mjs'] } });
    assert.equal((await runItem(issue, 'implement', clear.d, 4201)).outcome, 'done');
    const failing = deps({ gate: { confidence: 90, questions: [], contradictions: [], missing: ['lib/undo.mjs'] },
      runChecks: async () => ({ ok: false, failed: 'npm test', output: 'not ok' }) });
    const r = await runItem(issue, 'implement', failing.d, 4201);
    assert.equal(r.outcome, 'parked');
    assert.doesNotMatch(r.detail, /Missing|lib\/undo\.mjs/);
  });

  test('a gate answer without contradictions or missing stops only on low confidence', async () => {
    assert.equal((await runItem(issue, 'implement', deps({ gate: { confidence: 87, questions: [] } }).d, 4201)).outcome, 'done');
    const r = await runItem(issue, 'implement', deps({ gate: { confidence: 20, questions: ['Which?'] } }).d, 4201);
    assert.equal(r.detail, `This issue is not clear enough to build without guessing (confidence 20 of 100, needs ${deps().d.cfg.confidenceThreshold}).`
      + '\n\nQuestions:\n\n- Which?\n\nAnswer in a comment, then remove the label.');
  });

  test('rework and merge parks leave an empty line before the list of protected files', async () => {
    const pr = { ...issue, kind: 'pr', headRef: 'factory/issue-7', labels: ['agent:merge'] };
    const merged = deps({ changes: [{ status: 'M', path: 'test/unit/scoring.test.js' }] });
    const r1 = await runItem(pr, 'merge', merged.d, 4201);
    assert.match(r1.detail, /so the pull request is now a draft:\n\n- /);

    const asked = { ...pr, labels: ['agent:review'], comments: [{ author: 'dennis-brutski', body: 'Rename it.', at: '2026-11-05T10:00:00Z' }] };
    const reworked = deps({ changes: [{ status: 'M', path: 'test/unit/scoring.test.js' }] });
    reworked.d.runAgent = async () => ok({ status: 'complete', summary: 'Renamed.', detail: '' });
    let n = 0;
    reworked.d.ws.headInfo = async () => ({ sha: `abc${n++}` });
    const r2 = await runItem(asked, 'review', reworked.d, 4201);
    assert.match(r2.detail, /it changes files you should check, so the pull request is now a draft:\n\n- /);
  });
});

describe('skipped tests', () => {
  const config = factoryConfig;

  const T = '2026-11-01T10:00:00Z';
  const issue = {
    number: 1, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
    labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }],
    comments: [], headRef: null, headRepo: null,
  };

  function deps(testDiff) {
    const opened = [], diffs = [];
    const queue = [ok({ confidence: 90, questions: [] }), ok({ status: 'complete', summary: 'Done.', detail: '' }), ok({ verdict: 'clean', findings: [] })];
    const d = {
      cfg: { ...config, ...scorePad }, root: '/f', log: () => {},
      runSetup: async () => ({ ok: true, failed: null, output: '' }),
      runAgent: async () => queue.shift() ?? (() => { throw new Error('unexpected agent call'); })(),
      runChecks: async () => ({ ok: true, failed: null, output: '' }),
      gh: {
        addLabel: async () => {}, removeLabel: async () => {}, comment: async () => {}, findPullRequest: async () => null,
        openPullRequest: async (cfg, pr) => { opened.push(pr); return { number: 50, url: 'https://github.com/x/y/pull/50' }; },
        setDraft: async () => {}, updatePullRequestBody: async () => {},
      },
      ws: fakeWorkspace({
        againstBase: async () => fakeView({
          changes: async () => [{ status: 'A', path: 'test/undo.test.js' }],
          diff: async (pathspec) => { diffs.push(pathspec); return testDiff; },
        }),
      }),
    };
    return { d, opened, diffs };
  }

  test('a skipped test in the test folders makes the pull request a draft', async () => {
    const { d, opened, diffs } = deps("+++ b/test/undo.test.js\n+test.skip('undo', () => {})");
    const r = await runItem(issue, 'implement', d, 4201);
    assert.equal(opened[0].draft, true);
    assert.match(opened[0].body, /test skipped or singled out/);
    assert.match(r.detail, /test skipped or singled out/);
    assert.deepEqual(diffs.at(-1), scorePad.testDirs);
  });

  test('new tests without skips open a ready pull request', async () => {
    const { d, opened } = deps("+++ b/test/undo.test.js\n+test('undo', () => {})");
    const r = await runItem(issue, 'implement', d, 4201);
    assert.equal(r.outcome, 'done');
    assert.equal(opened[0].draft, false);
  });
});

// The existing tests a session changed: in the work answer, the prompts and the pull request body.
const vars = { number: 7, branch: 'factory/issue-7', base: 'main', title: 'T', body: 'B', comments: 'C', findings: 'F', since: null };

test('the work answer asks for the changed tests', () => {
  assert.ok(schemas.work.required.includes('test_changes'));
  assert.deepEqual(schemas.work.properties.test_changes.items.required, ['file', 'test', 'reason']);
});

for (const name of ['implement', 'fix', 'rework']) {
  test(`the ${name} prompt asks for each changed or deleted test`, () => {
    assert.match(renderPrompt(name, vars, {}), /`test_changes`: one entry per existing test you changed or deleted/);
  });
}

// How test changes are added to the pull request body, and how its "## Tests that change" list is read
// back from the factory's own part only: test/pr-body.test.mjs.
test('an issue is read in full', () => {
  assert.deepEqual(testsThatChange('x\n\n## Tests that change\n\n- `test/a.test.js`\n'), ['test/a.test.js']);
});

// The factory reads which test files an issue says will change, from its "## Tests that change" section.
test('a section with two bullets gives both paths', () => {
  const body = '## Tests that change\n\n- `test/a.test.js`: now expects 2\n- `test/b.test.js` goes, its logic is removed\n';
  assert.deepEqual(testsThatChange(body), ['test/a.test.js', 'test/b.test.js']);
});

test('text outside the section is ignored', () => {
  const body = [
    '## Problem', '', '- `src/x.js` is wrong', '',
    '## Tests that change', '', '- `test/a.test.js`: and `test/c.test.js` is mentioned here', '',
    '## Out of scope', '', '- `test/b.test.js`', '',
  ].join('\n');
  assert.deepEqual(testsThatChange(body), ['test/a.test.js']);
});

// The issue lists the protected files a run may change under "## Protected files that change". A pull request gives none:
// a branch with protected changes parks before setup on every later run, so only the first implement run reads the list.
test('the protected files an issue lists are read from their own section', () => {
  const body = '## Tests that change\n\n- `test/a.test.js`\n\n## Protected files that change\n\n- `config.mjs`: a turns key\n- `lib/agent.mjs`\n';
  assert.deepEqual(protectedThatChangeOf({ kind: 'issue', number: 7, body }), ['config.mjs', 'lib/agent.mjs']);
  assert.deepEqual(testsThatChange(body), ['test/a.test.js']);
  assert.deepEqual(protectedThatChangeOf({ kind: 'pr', number: 12, headRef: 'factory/issue-7', body: `Closes #7\n\n${body}\n## What changed\n` }), []);
  assert.deepEqual(protectedThatChangeOf({ kind: 'issue', number: 7, body: '## Problem\n\n- `config.mjs`\n' }), []);
});

test('no section gives an empty list', () => {
  assert.deepEqual(testsThatChange('## Problem\n\n- `test/a.test.js`\n'), []);
  assert.deepEqual(testsThatChange(''), []);
  assert.deepEqual(testsThatChange(undefined), []);
});

test('a section without bullets gives an empty list', () => {
  assert.deepEqual(testsThatChange('## Tests that change\n\nNone, `test/a.test.js` stays.\n'), []);
});

describe('session usage', () => {
  const config = factoryConfig;

  const issue = {
    number: 7, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
    labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: '2026-11-01T10:00:00Z' }],
    comments: [], headRef: null, headRepo: null,
  };
  const result = (output, turns, cost, extra = {}) => JSON.stringify({
    type: 'result', is_error: false, structured_output: output, num_turns: turns, duration_ms: 252_000, total_cost_usd: cost,
    usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 900, output_tokens: 18_000 },
    permission_denials: [], ...extra,
  });

  function setup(sessions) {
    const root = mkdtempSync(join(tmpdir(), 'stages-usage-'));
    const logs = [], opened = [];
    const d = {
      cfg: { ...config, ...scorePad, target: 'web-app', model: 'opus-test', localRun: false }, root, log: (m) => logs.push(m),
      factoryCommit: 'f00ba12',
      runSetup: async () => ({ ok: true, failed: null, output: '' }),
      runAgent: async (a) => {
        const s = sessions.shift();
        if (s.stdout !== undefined) { mkdirSync(join(a.logFile, '..'), { recursive: true }); writeFileSync(a.logFile, `${s.stdout}\n--- stderr ---\n\n`); }
        return s.r;
      },
      runChecks: async () => ({ ok: true, failed: null, output: '' }),
      gh: {
        addLabel: async () => {}, removeLabel: async () => {}, comment: async () => {},
        findPullRequest: async () => null,
        openPullRequest: async (c, a) => { opened.push(a); return { number: 50, url: 'https://github.com/x/y/pull/50' }; },
        setDraft: async () => {}, updatePullRequestBody: async () => {},
      },
      ws: fakeWorkspace({}, root),
    };
    return { d, logs, opened, root };
  }

  test('each session logs what it used, and the pull request has the totals of every run', async () => {
    const gate = { confidence: 87, questions: [] }, work = { status: 'complete', summary: 'Changed undo.', detail: '' }, review = { verdict: 'clean', findings: [] };
    const { d, logs, opened, root } = setup([
      { stdout: result(gate, 2, 0.1), r: ok(gate) },
      { stdout: result(work, 20, 0.7, { permission_denials: [{}, {}] }), r: ok(work) },
      { stdout: JSON.stringify({ type: 'result', structured_output: review }), r: ok(review) }, // no usage, as the fake claude
    ]);
    try {
      const logDir = d.ws.paths(7).logs;
      mkdirSync(logDir, { recursive: true });
      writeFileSync(join(logDir, '1-1-implement.json'), `${result(work, 10, 0.25)}\n--- stderr ---\n\n`); // an earlier run
      writeFileSync(join(logDir, '1-2-implement.json'), 'killed\n--- stderr ---\ntimed out\n'); // a crashed one
      const r = await runItem(issue, 'implement', d, 4201);
      assert.equal(r.outcome, 'done', r.detail);
      assert.ok(logs.includes('#7 gate session ended · 2 turns · 4m12s · 1k in (90% cached) · 18k out · ≈ $0.10'), logs.join('\n'));
      assert.ok(logs.includes('#7 implement session ended · 20 turns · 4m12s · 1k in (90% cached) · 18k out · ≈ $0.70 · 2 denied'), logs.join('\n'));
      assert.ok(logs.includes('#7 review session ended'), logs.join('\n'));
      const last = opened[0].body.trimEnd().split('\n').at(-1);
      assert.match(last, / · gate confidence 87 · checks: .+ · agent use so far: 5 sessions · 32 turns · ≈ \$1\.05 · session logs: runs\/web-app\/logs\/issue-7\/$/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('one session so far is named in the singular', async () => {
    const gate = { confidence: 87, questions: [] }, work = { status: 'complete', summary: 'Changed undo.', detail: '' }, review = { verdict: 'clean', findings: [] };
    const { d, opened, root } = setup([{ stdout: result(gate, 2, 0.1), r: ok(gate) }, { r: ok(work) }, { r: ok(review) }]);
    try {
      const r = await runItem(issue, 'implement', d, 4201);
      assert.equal(r.outcome, 'done', r.detail);
      const last = opened[0].body.trimEnd().split('\n').at(-1);
      assert.match(last, / · agent use so far: 1 session · 2 turns · ≈ \$0\.10 · session logs: /);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a failed session still logs what it used before parking', async () => {
    const { d, logs, root } = setup([{ stdout: result(null, 3, 0.05), r: { ok: false, output: null, reason: 'it hit the turn limit', sessionId: 's' } }]);
    try {
      const r = await runItem(issue, 'implement', d, 4201);
      assert.equal(r.outcome, 'parked');
      const i = logs.findIndex((m) => m.startsWith('#7 gate session ended · 3 turns'));
      assert.ok(i >= 0, logs.join('\n'));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a missing log file adds no line and does not park', async () => {
    const gate = { confidence: 87, questions: [] }, work = { status: 'complete', summary: 'Changed undo.', detail: '' }, review = { verdict: 'clean', findings: [] };
    const { d, logs, opened, root } = setup([{ r: ok(gate) }, { r: ok(work) }, { r: ok(review) }]);
    try {
      const r = await runItem(issue, 'implement', d, 4201);
      assert.equal(r.outcome, 'done', r.detail);
      assert.ok(!logs.some((m) => m.includes('session ended')), logs.join('\n'));
      assert.doesNotMatch(opened[0].body, /agent use so far/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a log folder with no readable log adds no agent use', async () => {
    const gate = { confidence: 87, questions: [] }, work = { status: 'complete', summary: 'Changed undo.', detail: '' }, review = { verdict: 'clean', findings: [] };
    const { d, opened, root } = setup([{ r: ok(gate) }, { r: ok(work) }, { r: ok(review) }]);
    try {
      mkdirSync(join(d.ws.paths(7).logs, 'odd.json'), { recursive: true }); // named like a log, but a folder
      const r = await runItem(issue, 'implement', d, 4201);
      assert.equal(r.outcome, 'done', r.detail);
      assert.doesNotMatch(opened[0].body, /agent use so far/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  const zero = { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };

  test('a local run logs no cost, and says when the server gave no token counts', async () => {
    const gate = { confidence: 87, questions: [] }, work = { status: 'complete', summary: 'Changed undo.', detail: '' }, review = { verdict: 'clean', findings: [] };
    const { d, logs, opened, root } = setup([
      { stdout: result(gate, 2, 0, { usage: zero }), r: ok(gate) },
      { stdout: result(work, 20, 0, { usage: zero }), r: ok(work) },
      { stdout: result(review, 3, 0, { usage: zero }), r: ok(review) },
    ]);
    d.cfg = { ...d.cfg, localRun: true };
    try {
      const r = await runItem(issue, 'implement', d, 4201);
      assert.equal(r.outcome, 'done', r.detail);
      assert.ok(logs.includes('#7 gate session ended · 2 turns · 4m12s · local, no token counts'), logs.join('\n'));
      assert.ok(!logs.some((m) => m.includes('≈ $')), logs.join('\n'));
      const last = opened[0].body.trimEnd().split('\n').at(-1);
      assert.match(last, / · agent use so far: 3 sessions · 25 turns · local, no token counts · session logs: /);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a local run whose server counts shows its tokens, not a cost', async () => {
    const gate = { confidence: 87, questions: [] }, work = { status: 'complete', summary: 'Changed undo.', detail: '' }, review = { verdict: 'clean', findings: [] };
    const { d, logs, opened, root } = setup([
      { stdout: result(gate, 2, 0.1), r: ok(gate) },
      { stdout: result(work, 20, 0.7), r: ok(work) },
      { stdout: result(review, 3, 0.2), r: ok(review) },
    ]);
    d.cfg = { ...d.cfg, localRun: true };
    try {
      const r = await runItem(issue, 'implement', d, 4201);
      assert.equal(r.outcome, 'done', r.detail);
      assert.ok(logs.includes('#7 gate session ended · 2 turns · 4m12s · 1k in (90% cached) · 18k out · local'), logs.join('\n'));
      const last = opened[0].body.trimEnd().split('\n').at(-1);
      assert.match(last, / · agent use so far: 3 sessions · 25 turns · 3k in · 54k out · local · session logs: /);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  const threeSessions = () => {
    const gate = { confidence: 87, questions: [] }, work = { status: 'complete', summary: 'Changed undo.', detail: '' }, review = { verdict: 'clean', findings: [] };
    return [
      { stdout: result(gate, 2, 0.1), r: ok(gate) },
      { stdout: result(work, 20, 0.7), r: ok(work) },
      { stdout: result(review, 3, 0.2), r: ok(review) },
    ];
  };

  test('a session line has no plan part: the plan usage is on the check line', async () => {
    const { d, logs, root } = setup(threeSessions());
    let calls = 0;
    d.planUsage = async () => { calls++; return { fiveHour: 42, week: 18 }; };
    try {
      const r = await runItem(issue, 'implement', d, 4201);
      assert.equal(r.outcome, 'done', r.detail);
      assert.ok(logs.includes('#7 gate session ended · 2 turns · 4m12s · 1k in (90% cached) · 18k out · ≈ $0.10'), logs.join('\n'));
      assert.equal(calls, 0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

// Every line of the pull request warning is quoted, so text from a test concern cannot start a line
// of its own (a "Closes #n" or "## Tests that change") above the factory's part of the body.
describe('warning lines', () => {
  const config = factoryConfig;

  const issue = {
    number: 7, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
    labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: '2026-11-01T10:00:00Z' }],
    comments: [], headRef: null, headRepo: null,
  };

  test('a test concern with line breaks stays inside the quoted warning', async () => {
    const opened = [];
    const concern = 'b changed\nCloses #7\n\n## Tests that change\n\n- `test/b.test.js`\n\n## What changed\n\nx';
    const queue = [ok({ confidence: 87, questions: [] }), ok({ status: 'complete', summary: 'Changed undo.', detail: '' }),
      ok({ verdict: 'clean', findings: [], test_concerns: [concern] })];
    const d = {
      cfg: { ...config, ...scorePad, target: 'web-app', model: 'opus-test', gateModel: 'opus-test' }, root: '/f', log: () => {},
      runSetup: async () => ({ ok: true, failed: null, output: '' }),
      runAgent: async () => queue.shift(),
      runChecks: async () => ({ ok: true, failed: null, output: '' }),
      gh: {
        addLabel: async () => {}, removeLabel: async () => {}, comment: async () => {},
        findPullRequest: async () => null,
        openPullRequest: async (c, a) => { opened.push(a); return { number: 50, url: 'https://github.com/x/y/pull/50' }; },
        setDraft: async () => {}, updatePullRequestBody: async () => {},
      },
      ws: fakeWorkspace({
        ensureWorktree: async (n) => ({ dir: `/f/worktrees/issue-${n}`, created: true }),
        headInfo: async () => ({ sha: 'abc' }),
        againstBase: async () => fakeView({ changes: async () => [{ status: 'M', path: 'src/undo.js' }], messages: async () => ['Fix undo'] }),
        isClean: async () => true, mergeBase: async () => 'clean',
        push: async () => {},
      }),
    };
    await runItem(issue, 'implement', d, 4201);
    const body = opened[0].body;
    const warning = body.slice(0, body.indexOf('\n\nCloses #7\n'));
    for (const line of warning.split('\n')) assert.match(line, /^>/);
    assert.deepEqual(parse(body).testsThatChange, []);
  });
});

// Why the last run stopped: the newest 🏭 park comment since the last push, shown to the next code-changing session.
describe('last stop reason', () => {
  const T = '2026-11-01T10:00:00Z', T2 = '2026-11-01T11:00:00Z';
  const gate = (confidence, questions = []) => ok({ confidence, questions });
  const work = (status = 'complete', detail = '') => ok({ status, summary: 'Changed the undo guard.', detail });
  const review = () => ok({ verdict: 'clean', findings: [] });
  const HEADING = '## Why the last run stopped';

  const issue = {
    number: 1, kind: 'issue', title: 'Fix undo', body: 'Undo fails on an empty ledger', author: 'dennis-brutski', bodyEditedAt: null,
    labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }],
    comments: [], headRef: null, headRepo: null,
  };
  const pr = (comments = []) => ({
    ...issue, number: 4, kind: 'pr', labels: ['agent:review'], comments,
    headRef: 'factory/issue-1', headRepo: 'example/web-app',
  });

  // A factory with a real run folder; o.agent and o.checks can be changed between runs.
  function factory(o = {}) {
    const root = mkdtempSync(join(tmpdir(), 'factory-stop-'));
    const d = { root, agentCalls: [], comments: [], posted: [], o };
    let commits = 0;
    d.deps = {
      cfg: { ...config, ...scorePad }, root, log: () => {},
      runSetup: async () => ({ ok: true, failed: null, output: '' }),
      runAgent: async (a) => {
        d.agentCalls.push(a);
        if (!a.readOnly) commits++;
        const r = d.o.agent.shift();
        if (!r) throw new Error('unexpected agent call');
        return r;
      },
      runChecks: async () => d.o.checks ?? { ok: true, failed: null, output: '' },
      gh: {
        addLabel: async () => {}, removeLabel: async () => {},
        comment: async (c, n, b) => { d.comments.push(b); d.posted.push({ author: 'dennis-brutski', body: b, at: T2 }); },
        findPullRequest: async () => null,
        openPullRequest: async () => ({ number: 50, url: 'https://github.com/x/y/pull/50' }),
        setDraft: async () => {}, updatePullRequestBody: async () => {},
      },
      ws: fakeWorkspace({
        ensureWorktree: async (n) => ({ dir: join(root, 'worktrees', `issue-${n}`), created: true }),
        headInfo: async () => { if (d.o.crash) { d.o.crash = false; throw new Error('disk on fire'); } return { sha: `abc${commits}` }; },
        againstBase: async () => fakeView({ messages: async () => ['Fix undo on empty ledger'] }),
        mergeBase: async () => d.o.merge ?? 'clean',
      }, root),
    };
    // The item as the next poll sees it: with the comments the factory posted.
    d.seen = (it) => ({ ...it, comments: [...it.comments, ...d.posted] });
    d.prompt = (name) => d.agentCalls.filter((a) => a.logFile.endsWith(`-${name}.json`)).at(-1)?.prompt;
    return d;
  }
  const red = { ok: false, failed: 'npm test', output: 'AssertionError: RED-OUTPUT 1 !== 2' };

  const cfg = { ...config, ...scorePad };
  const stopped = (body, at = T2, author = 'dennis-brutski') => ({ author, body, at });

  test('the newest 🏭 Factory stopped comment is the last stop reason; a 🏭 Pull request comment is not', () => {
    const item = { ...issue, comments: [
      stopped('🏭 Pull request: https://github.com/x/y/pull/50', T),
      stopped('🏭 **Factory stopped (implement).**\n\nold reason', '2026-11-01T10:30:00Z'),
      stopped('🏭 **Factory stopped (implement).**\n\n`npm test` failed: RED', T2),
    ] };
    assert.equal(lastStopReason(item, cfg), '🏭 **Factory stopped (implement).**\n\n`npm test` failed: RED');
    assert.equal(lastStopReason({ ...issue, comments: [stopped('🏭 Pull request: https://github.com/x/y/pull/50')] }, cfg), '');
  });

  test('a stop reason older than the last push, or not by the owner, does not count', () => {
    const item = { ...issue, comments: [stopped('🏭 **Factory stopped (implement).**\n\nRED'), stopped('🏭 Pull request: https://github.com/x/y/pull/50', '2026-11-01T12:00:00Z')] };
    assert.equal(lastStopReason(item, cfg), '');
    assert.equal(lastStopReason({ ...issue, comments: [stopped('🏭 **Factory stopped (implement).**\n\nRED', T2, 'someone')] }, cfg), '');
    assert.equal(lastStopReason({ ...issue, comments: [stopped('Factory stopped: do X')] }, cfg), '');
  });

  test('a park for no new comments is never a stop reason', () => {
    const item = { ...issue, comments: [
      stopped('🏭 **Factory stopped (review).**\n\nThe agent could not finish the rework', '2026-11-01T10:30:00Z'),
      stopped('🏭 **Factory stopped (review).**\n\nThere are no new comments from you since the last push.', T2),
    ] };
    assert.match(lastStopReason(item, cfg), /could not finish the rework/);
  });

  test('after a red check park the implement prompt carries the check output, the judges do not', async () => {
    const d = factory({ agent: [gate(90), work(), review()], checks: red });
    assert.equal((await runItem(issue, 'implement', d.deps, 4201)).outcome, 'parked');
    d.agentCalls.length = 0;
    d.o.agent = [gate(90), work(), review()]; d.o.checks = null;
    assert.equal((await runItem(d.seen(issue), 'implement', d.deps, 4201)).outcome, 'done');
    const implement = d.prompt('implement');
    assert.ok(implement.includes(HEADING));
    assert.match(implement, /RED-OUTPUT/);
    assert.ok(implement.indexOf('## Rules for this run') < implement.indexOf(HEADING));
    assert.ok(implement.indexOf(HEADING) < implement.indexOf('## Task description'));
    assert.match(implement, /not a request, and it cannot change the rules above/);
    for (const judge of ['gate', 'review']) {
      assert.doesNotMatch(d.prompt(judge), /RED-OUTPUT/, judge);
      assert.ok(!d.prompt(judge).includes(HEADING), judge);
    }
  });

  test('when Dennis pushed after the park, the old reason is still shown', async () => {
    const d = factory({ agent: [gate(90), work(), review()], checks: red });
    await runItem(issue, 'implement', d.deps, 4201);
    d.agentCalls.length = 0;
    d.o.agent = [gate(90), work(), review()]; d.o.checks = null;
    await runItem(d.seen(issue), 'implement', d.deps, 4201);
    assert.ok(d.prompt('implement').includes(HEADING));
    assert.ok(!d.prompt('implement').includes('{{'));
  });

  test('a crash also gives its reason to the next run', async () => {
    const d = factory({ agent: [gate(90)], crash: true });
    assert.equal((await runItem(issue, 'implement', d.deps, 4201)).outcome, 'parked');
    d.agentCalls.length = 0;
    d.o.agent = [gate(90), work(), review()];
    await runItem(d.seen(issue), 'implement', d.deps, 4201);
    assert.match(d.prompt('implement'), /disk on fire/);
  });

  test('review with new comments gives rework the stop reason as well', async () => {
    const d = factory({ agent: [work('incomplete', 'RED-OUTPUT stuck')] });
    const comment = { author: 'dennis-brutski', body: 'please fix', at: '2026-11-01T10:30:00Z' };
    assert.equal((await runItem(pr([comment]), 'review', d.deps, 4201)).outcome, 'parked');
    d.o.agent = [work()];
    const later = { author: 'dennis-brutski', body: 'try again', at: '2026-11-01T12:00:00Z' };
    assert.equal((await runItem({ ...d.seen(pr([comment])), comments: [...d.seen(pr([comment])).comments, later] }, 'review', d.deps, 4201)).outcome, 'done');
    assert.match(d.prompt('rework'), /RED-OUTPUT stuck/);
  });

  test('review parked for no comments parks again on a retry with no comments, without an agent', async () => {
    const d = factory({ agent: [] });
    assert.equal((await runItem(pr(), 'review', d.deps, 4201)).outcome, 'parked');
    assert.match(d.comments[0], /no new comments/);
    const r = await runItem(d.seen(pr()), 'review', d.deps, 4201);
    assert.equal(r.outcome, 'parked');
    assert.match(r.detail, /no new comments/);
    assert.equal(d.agentCalls.length, 0);
  });

  test('a stale stop reason alone does not start a rework', async () => {
    const d = factory({ agent: [] });
    const old = stopped('🏭 **Factory stopped (review).**\n\nThe agent could not finish the rework: RED-OUTPUT', T2);
    assert.equal((await runItem(pr([old]), 'review', d.deps, 4201)).outcome, 'parked');
    assert.equal(d.agentCalls.length, 0);
  });

  test('the merge session gets the stop reason when there is a conflict', async () => {
    const d = factory({ agent: [], checks: red });
    const item = { ...pr(), labels: ['agent:merge'] };
    assert.equal((await runItem(item, 'merge', d.deps, 4201)).outcome, 'parked');
    d.o.agent = [work()]; d.o.checks = null; d.o.merge = 'conflict';
    assert.equal((await runItem(d.seen(item), 'merge', d.deps, 4201)).outcome, 'done');
    assert.match(d.prompt('merge'), /RED-OUTPUT/);
  });

  test('the fix session gets the stop reason', async () => {
    const d = factory({ agent: [gate(90), work(), review()], checks: red });
    await runItem(issue, 'implement', d.deps, 4201);
    d.o.agent = [gate(90), work(), ok({ verdict: 'findings', findings: ['x'] }), work()]; d.o.checks = null;
    await runItem(d.seen(issue), 'implement', d.deps, 4201);
    assert.match(d.prompt('fix'), /RED-OUTPUT/);
  });

  test('a successful merge stage says so, and an older stop no longer counts', async () => {
    const d = factory({ agent: [] });
    const item = { ...pr([stopped('🏭 **Factory stopped (merge).**\n\nRED-OUTPUT', T)]), labels: ['agent:merge'] };
    assert.equal(lastStopReason(item, cfg), item.comments[0].body);
    assert.equal((await runItem(item, 'merge', d.deps, 4201)).outcome, 'done');
    assert.deepEqual(d.comments, ['🏭 Merged the base branch and pushed.']);
    assert.equal(lastStopReason(d.seen(item), cfg), '');
  });

  test('a commit date never moves the last push: a stop after the newest factory comment counts', async () => {
    const d = factory({ agent: [work()] });
    const item = pr([
      stopped('🏭 **Rework**\n\nDone', T),
      { author: 'dennis-brutski', body: 'please fix', at: '2026-11-01T10:15:00Z' },
      stopped('🏭 **Factory stopped (review).**\n\nThe agent could not finish the rework: RED-OUTPUT', '2026-11-01T10:30:00Z'),
    ]);
    d.deps.ws.headInfo = async () => ({ sha: `abc${d.agentCalls.length}`, committedAt: '2099-01-01T00:00:00Z' });
    assert.equal((await runItem(item, 'review', d.deps, 4201)).outcome, 'done');
    assert.match(d.prompt('rework'), /please fix/);
    assert.match(d.prompt('rework'), /RED-OUTPUT/);
  });

  test('the stop reason is fenced and the section shows only in code-changing prompts', () => {
    const vars = { number: 7, branch: 'b', base: 'main', title: 'T', body: 'B', comments: 'C', findings: 'F', lastStop: 'x ```y``` z', baseSha: 'b'.repeat(40) };
    for (const name of ['implement', 'fix', 'rework', 'merge']) {
      const p = renderPrompt(name, vars);
      assert.ok(p.includes(`${HEADING}\n\n`), name);
      assert.ok(p.includes("```\nx '''y''' z\n```"), name);
    }
    for (const name of ['gate', 'review', 'explore']) assert.ok(!renderPrompt(name, vars).includes(HEADING), name);
    for (const name of ['implement', 'fix', 'rework', 'merge']) assert.ok(!renderPrompt(name, { ...vars, lastStop: '' }).includes(HEADING), name);
  });
});

// The stop reason must survive the base merge at the start of a run: that merge moves HEAD to a newer commit.
describe('last stop after a base merge', () => {
  const T = '2026-11-01T10:00:00Z', T2 = '2026-11-01T11:00:00Z', T3 = '2026-11-01T12:00:00Z';
  const issue = {
    number: 1, kind: 'issue', title: 'Fix undo', body: 'Undo fails on an empty ledger', author: 'dennis-brutski', bodyEditedAt: null,
    labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }],
    comments: [], headRef: null, headRepo: null,
  };

  test('a base merge after the park does not hide the stop reason from implement', async () => {
    const root = mkdtempSync(join(tmpdir(), 'factory-stop-merge-'));
    const calls = [], posted = [];
    let agent = [ok({ confidence: 90, questions: [] }), ok({ status: 'complete', summary: 's', detail: '' }), ok({ verdict: 'clean', findings: [] })];
    let checks = { ok: false, failed: 'npm test', output: 'AssertionError: RED-OUTPUT 1 !== 2' };
    let head = T;
    const deps = {
      cfg: { ...config, ...scorePad }, root, log: () => {},
      runSetup: async () => ({ ok: true, failed: null, output: '' }),
      runAgent: async (a) => { calls.push(a); const r = agent.shift(); if (!r) throw new Error('unexpected agent call'); return r; },
      runChecks: async () => checks,
      gh: {
        addLabel: async () => {}, removeLabel: async () => {},
        comment: async (c, n, body) => { posted.push({ author: 'dennis-brutski', body, at: T2 }); },
        findPullRequest: async () => null,
        openPullRequest: async () => ({ number: 50, url: 'https://github.com/x/y/pull/50' }),
        setDraft: async () => {}, updatePullRequestBody: async () => {},
      },
      ws: fakeWorkspace({
        ensureWorktree: async (n) => ({ dir: join(root, 'worktrees', `issue-${n}`), created: false }),
        headInfo: async () => ({ sha: `abc-${head}` }),
        againstBase: async () => fakeView({ messages: async () => ['Fix undo on empty ledger'] }),
        // main moved while the item waited: merging it makes a merge commit newer than the park comment.
        mergeBase: async () => { if (posted.length) head = T3; return 'clean'; },
      }, root),
    };
    assert.equal((await runItem(issue, 'implement', deps, 4201)).outcome, 'parked');
    calls.length = 0;
    agent = [ok({ confidence: 90, questions: [] }), ok({ status: 'complete', summary: 's', detail: '' }), ok({ verdict: 'clean', findings: [] })];
    checks = { ok: true, failed: null, output: '' };
    assert.equal((await runItem({ ...issue, comments: posted }, 'implement', deps, 4201)).outcome, 'done');
    const implement = calls.find((a) => a.logFile.endsWith('-implement.json')).prompt;
    assert.ok(implement.includes('## Why the last run stopped'));
    assert.match(implement, /RED-OUTPUT/);
  });
});

// Which model writes the first draft: a cheaper one only for simple issues away from protected files.
const cfg = { ...factory, model: 'opus', simpleModel: 'sonnet' };
const simple = { confidence: 90, questions: [], difficulty: 'simple', files: ['lib/look.mjs', 'prompts/look.md'] };

test('a simple issue away from protected files gets simpleModel', () => {
  assert.equal(implementModel(simple, cfg, { lastStop: '' }), 'sonnet');
  assert.equal(implementModel(simple, cfg), 'sonnet');
});

test('a simple issue that touches a protected file gets model', () => {
  assert.equal(implementModel({ ...simple, files: ['lib/look.mjs', 'lib/agent.mjs'] }, cfg, { lastStop: '' }), 'opus');
});

test('a re-run after a stop gets model', () => {
  assert.equal(implementModel(simple, cfg, { lastStop: 'The implement step failed: timeout' }), 'opus');
});

test('normal and hard issues get model', () => {
  for (const difficulty of ['normal', 'hard'])
    assert.equal(implementModel({ ...simple, difficulty }, cfg, { lastStop: '' }), 'opus');
});

test('a missing or unknown difficulty gets model', () => {
  const { difficulty, ...old } = simple;
  assert.equal(implementModel(old, cfg, { lastStop: '' }), 'opus');
  assert.equal(implementModel({ confidence: 90, questions: [] }, cfg, { lastStop: '' }), 'opus');
  assert.equal(implementModel({ ...simple, difficulty: 'easy' }, cfg, { lastStop: '' }), 'opus');
});

test('without simpleModel every issue gets model', () => {
  for (const simpleModel of [undefined, null, ''])
    assert.equal(implementModel(simple, { ...cfg, simpleModel }, { lastStop: '' }), 'opus');
});

// Checks kept outside the agents' reach: the factory runs them, agents never read them.
describe('held-out checks', () => {
  const config = factoryConfig;

  function setupDirs(script) {
    const base = mkdtempSync(join(tmpdir(), 'factory-held-'));
    const runDir = join(base, 'run'), dir = join(runDir, 'worktrees', 'issue-1'), held = join(base, 'held');
    mkdirSync(dir, { recursive: true }); mkdirSync(held);
    writeFileSync(join(held, 'check.sh'), script);
    return { dir, held, cfg: { ...config, runDir, checks: [], heldOutDir: held, heldOutChecks: [['sh', ['{heldOut}/check.sh']]] } };
  }

  test('held-out checks run after the checks, with their folder readable', real, async () => {
    const { dir, cfg } = setupDirs('test -d "$PWD" && echo HELD-RAN && exit 1\n');
    const r = await runChecks(dir, cfg, 4321);
    assert.equal(r.ok, false); assert.equal(r.heldOut, true); assert.match(r.output, /HELD-RAN/);
  });

  test('passing held-out checks pass', real, async () => {
    const { dir, cfg } = setupDirs('exit 0\n');
    assert.equal((await runChecks(dir, cfg, 4321)).ok, true);
  });

  test('a held-out folder inside the run folder is refused: agents can read it there', async () => {
    const { dir, cfg } = setupDirs('exit 0\n');
    const r = await runChecks(dir, { ...cfg, heldOutDir: join(cfg.runDir, 'held') }, 4321);
    assert.equal(r.ok, false); assert.equal(r.heldOut, undefined); assert.match(r.output, /inside the run folder/);
  });

  test('held-out checks without a held-out folder are refused', async () => {
    const { dir, cfg } = setupDirs('exit 0\n');
    const { heldOutDir, ...noDir } = cfg;
    assert.deepEqual(await runChecks(dir, noDir, 4321), {
      ok: false, failed: 'held-out checks',
      output: 'heldOutDir must be set and lie outside the run folder, which agents can read (it is inside the run folder or missing).',
    });
  });

  test('agents cannot read the held-out folder', () => {
    const s = agentSettings('/r/worktrees/issue-1', { ...config, runDir: '/r', heldOutDir: '/h' });
    assert.ok(!JSON.stringify(s).includes('"/h'));
  });

  test('a failed held-out check parks without its output; the output goes to the terminal log', async () => {
    const T = '2026-11-01T10:00:00Z', lines = [], comments = [];
    const ok = (output) => ({ ok: true, output, reason: '', sessionId: 's' });
    const queue = [ok({ confidence: 90, questions: [] }), ok({ status: 'complete', summary: 'Done.', detail: '' }), ok({ verdict: 'clean', findings: [] })];
    const d = {
      cfg: { ...config, repo: 'x/y', baseBranch: 'main' }, root: '/f', log: (l) => lines.push(l),
      runSetup: async () => ({ ok: true, failed: null, output: '' }),
      runAgent: async () => queue.shift(),
      runChecks: async () => ({ ok: false, failed: 'sh /h/check.sh', output: 'SECRET-ASSERTION', heldOut: true }),
      gh: { addLabel: async () => {}, removeLabel: async () => {}, comment: async (c, n, b) => comments.push(b), findPullRequest: async () => null },
      ws: fakeWorkspace({ againstBase: async () => fakeView({ changes: async () => [{ status: 'M', path: 'src/a.js' }] }) }),
    };
    const issue = { number: 1, kind: 'issue', title: 'T', body: 'B', author: 'dennis-brutski', bodyEditedAt: null, labels: ['agent:implement'],
      labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }], comments: [], headRef: null, headRepo: null };
    const r = await runItem(issue, 'implement', d, 4201);
    assert.equal(r.outcome, 'parked');
    assert.match(r.detail, /held-out check failed/);
    assert.ok(!comments.join('\n').includes('SECRET-ASSERTION'));
    assert.ok(!r.detail.includes('SECRET-ASSERTION'));
    assert.ok(lines.join('\n').includes('SECRET-ASSERTION'));
  });
});

// With testFiles set, the branch's new and changed tests run on the base's code after the checks; those that pass are a note.
describe('tests that pass without the change', () => {
  const on = (d, { passed = [], timedOut = null, files = ['test/undo.test.js', 'test/fakes/ledger.js'] } = {}) => {
    d.deps.cfg = { ...d.deps.cfg, testFiles: [['node', ['--test', '{files}']]], testSupport: ['test/fakes/'] };
    d.onBase = [];
    d.deps.ws.testsOnBase = async (dir, sha, testDirs, run) => { d.onBase.push({ dir, sha, testDirs, pushedYet: d.pushed.length }); return run(files); };
    d.deps.runTestFiles = async (dir, cfg, port, gitDir, fs) => { d.ranFiles = fs; d.ranGitDir = gitDir; return { passed, timedOut }; };
    return d;
  };

  test('without testFiles nothing runs on the base and the body has no such section', async () => {
    const d = fakes({ agent: [gate(90), work(), review()] });
    let called = false;
    d.deps.ws.testsOnBase = async () => { called = true; return null; };
    d.deps.runTestFiles = async () => { called = true; return { passed: [], timedOut: null }; };
    assert.equal((await runItem(issue, 'implement', d.deps, 4201)).outcome, 'done');
    assert.equal(called, false);
    assert.doesNotMatch(d.opened[0].body, /Tests that pass without the change/);
  });

  test('the new and changed tests run on the pinned base before the push; support files are not run', async () => {
    const d = on(fakes({ agent: [gate(90), work(), review()] }));
    assert.equal((await runItem(issue, 'implement', d.deps, 4201)).outcome, 'done');
    assert.deepEqual(d.onBase, [{ dir: '/f/worktrees/issue-1', sha: 'b'.repeat(40), testDirs: ['test/', 'e2e/'], pushedYet: 0 }]);
    assert.deepEqual(d.ranFiles, ['test/undo.test.js']);
    assert.equal(d.ranGitDir, '/f/repo/.git');
    assert.deepEqual(d.pushed, ['factory/issue-1']);
  });

  test('changed helper modules in a test folder hold no tests and are not run', async () => {
    const files = ['test/behavior/steps.mjs', 'test/behavior/world.mjs', 'test/helpers.mjs', 'test/undo.test.js', 'test/undo_test.py', 'tests/test_undo.py', 'e2e/undo.spec.ts'];
    const d = on(fakes({ agent: [gate(90), work(), review()] }), { files });
    assert.equal((await runItem(issue, 'implement', d.deps, 4201)).outcome, 'done');
    assert.deepEqual(d.ranFiles, ['test/undo.test.js', 'test/undo_test.py', 'tests/test_undo.py', 'e2e/undo.spec.ts']);
  });

  test('a test that passes on the base is a note in a ready pull request', async () => {
    const d = on(fakes({ agent: [gate(90), work(), review()] }), { passed: ['test/undo.test.js'] });
    assert.equal((await runItem(issue, 'implement', d.deps, 4201)).outcome, 'done');
    assert.equal(d.opened[0].draft, false);
    assert.match(d.opened[0].body, /## Tests that pass without the change\n\n.+\n\n- `test\/undo\.test\.js`\n/);
  });

  test('tests that fail on the base leave no note', async () => {
    const d = on(fakes({ agent: [gate(90), work(), review()] }), { passed: [] });
    assert.equal((await runItem(issue, 'implement', d.deps, 4201)).outcome, 'done');
    assert.doesNotMatch(d.opened[0].body, /Tests that pass without the change/);
  });

  test('a timeout on the base stops the run like a failed check, with no push', async () => {
    const d = on(fakes({ agent: [gate(90), work(), review()] }), { timedOut: { failed: 'node --test test/undo.test.js', output: '(timed out after 15 min)' } });
    const r = await runItem(issue, 'implement', d.deps, 4201);
    assert.equal(r.outcome, 'parked');
    assert.match(r.detail, /`node --test test\/undo\.test\.js` failed when the factory ran the checks/);
    assert.match(r.detail, /timed out/);
    assert.deepEqual(d.pushed, []);
  });

  test('a branch that cannot be restored stops the run, with no push', async () => {
    const d = on(fakes({ agent: [gate(90), work(), review()] }));
    d.deps.ws.testsOnBase = async () => { throw new Error('the worktree could not be put back: HEAD moved'); };
    const r = await runItem(issue, 'implement', d.deps, 4201);
    assert.equal(r.outcome, 'parked');
    assert.match(r.detail, /could not be put back/);
    assert.deepEqual(d.pushed, []);
  });
});
