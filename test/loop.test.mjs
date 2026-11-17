import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.mjs';
import { recover, tick, cleanup, acquireLock, preflight } from '../lib/loop.mjs';

const T = '2026-11-01T10:00:00Z', T2 = '2026-11-01T11:00:00Z';
const issue = (number, o = {}) => ({
  number, kind: 'issue', title: `Issue ${number}`, body: '', author: 'dennis-brutski', bodyEditedAt: null,
  labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: T }],
  comments: [], headRef: null, headRepo: null, ...o,
});
const pr = (number, issueNumber) => issue(number, {
  kind: 'pr', labels: ['agent:review'], labelEvents: [{ label: 'agent:review', actor: 'dennis-brutski', at: T }],
  headRef: `factory/issue-${issueNumber}`, headRepo: 'dennis-brutski/gin-rummy-score-pad',
});

function fakes(o = {}) {
  const d = { started: [], comments: [], labelsAdded: [], labelsRemoved: [], removed: [], logs: [] };
  d.deps = {
    cfg: config, root: '/f', log: (m) => d.logs.push(m),
    runItem: async (item, stage, deps, port) => { d.started.push({ n: item.number, stage, port }); await (o.hold ?? Promise.resolve()); return { outcome: 'done' }; },
    gh: {
      listCandidates: async () => { if (o.listFails) throw new Error('GitHub is down'); return o.candidates ?? []; },
      addLabel: async (c, n, l) => { d.labelsAdded.push(`${n}:${l}`); },
      removeLabel: async (c, n, l) => { d.labelsRemoved.push(`${n}:${l}`); },
      comment: async (c, n, b) => { d.comments.push(`${n}:${b}`); },
      isFinished: async (c, n) => (o.finished ?? []).includes(n),
      authenticatedLogin: async () => o.login ?? 'dennis-brutski',
    },
    ws: { listWorktrees: async () => o.worktrees ?? [], removeWorktree: async (root, n) => { d.removed.push(n); } },
    run: async (cmd) => ({ code: (o.failing ?? []).includes(cmd) ? 1 : 0, stdout: '', stderr: 'nope', timedOut: false }),
  };
  return d;
}

test('tick starts at most maxParallel runs, oldest first', async () => {
  const d = fakes({ candidates: [issue(9), issue(3), issue(5)] });
  const running = new Map();
  assert.deepEqual(await tick(d.deps, running), [3, 5]);
  await Promise.all(running.values());
  assert.deepEqual(d.started.map((s) => s.n), [3, 5]);
  assert.equal(d.started[0].stage, 'implement');
});
test('a finished run frees its slot', async () => {
  const d = fakes({ candidates: [issue(3), issue(5), issue(9)] });
  const running = new Map();
  await tick(d.deps, running);
  await Promise.all(running.values());
  assert.equal(running.size, 0);
  assert.deepEqual(await tick(d.deps, running), [3, 5]);
});
test('tick does not restart an item that is already running', async () => {
  let release; const hold = new Promise((r) => { release = r; });
  const d = fakes({ candidates: [issue(3), issue(5), issue(9)], hold });
  const running = new Map();
  assert.deepEqual(await tick(d.deps, running), [3, 5]);
  assert.deepEqual(await tick(d.deps, running), []);
  release(); await Promise.all(running.values());
});
test('an issue and its pull request never run at the same time', async () => {
  let release; const hold = new Promise((r) => { release = r; });
  const d = fakes({ candidates: [issue(1), pr(4, 1)], hold });
  const running = new Map();
  assert.deepEqual(await tick(d.deps, running), [1]);
  release(); await Promise.all(running.values());
});
test('each run gets its own e2e port', async () => {
  const d = fakes({ candidates: [issue(3), issue(5)] });
  const running = new Map();
  await tick(d.deps, running); await Promise.all(running.values());
  assert.deepEqual(d.started.map((s) => s.port), [4203, 4205]);
});
test('tick parks an edited foreign issue with a comment and starts nothing for it', async () => {
  const d = fakes({ candidates: [issue(2, { author: 'mallory', bodyEditedAt: T2 })] });
  assert.deepEqual(await tick(d.deps, new Map()), []);
  assert.equal(d.started.length, 0);
  assert.match(d.comments[0], /^2:.*edited after it was approved/s);
  assert.deepEqual(d.labelsAdded, ['2:agent:needs-human']);
});
test('tick ignores items labelled by someone else, silently', async () => {
  const d = fakes({ candidates: [issue(2, { labelEvents: [{ label: 'agent:implement', actor: 'mallory', at: T }] })] });
  assert.deepEqual(await tick(d.deps, new Map()), []);
  assert.deepEqual(d.comments, []); assert.deepEqual(d.labelsAdded, []);
});
test('tick survives a GitHub listing failure', async () => {
  const d = fakes({ listFails: true });
  assert.deepEqual(await tick(d.deps, new Map()), []);
  assert.ok(d.logs.some((l) => l.includes('GitHub is down')));
});
test('a run that throws does not take the loop down and frees its slot', async () => {
  const d = fakes({ candidates: [issue(3)] });
  d.deps.runItem = async () => { throw new Error('kaboom'); };
  const running = new Map();
  await tick(d.deps, running); await Promise.all(running.values());
  assert.equal(running.size, 0);
  assert.ok(d.logs.some((l) => l.includes('kaboom')));
});
test('recover re-queues every in-progress item', async () => {
  const d = fakes({ candidates: [issue(3, { labels: ['agent:implement', 'agent:in-progress'] }), issue(5)] });
  assert.deepEqual(await recover(d.deps), [3]);
  assert.deepEqual(d.labelsRemoved, ['3:agent:in-progress']);
});
test('parked item is not picked up again on the next tick', async () => {
  const d = fakes({ candidates: [issue(3, { labels: ['agent:implement', 'agent:needs-human'] })] });
  assert.deepEqual(await tick(d.deps, new Map()), []);
  assert.deepEqual(d.comments, []);
});
test('cleanup removes worktrees of finished items only', async () => {
  const d = fakes({ worktrees: [1, 2, 3], finished: [1, 3] });
  await cleanup(d.deps, new Map([[3, Promise.resolve()]]));
  assert.deepEqual(d.removed, [1]);
});
test('acquireLock refuses a second holder and takes over a dead pid', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'factory-lock-')), 'factory.lock');
  const release = acquireLock(file);
  assert.equal(readFileSync(file, 'utf8').trim(), String(process.pid));
  assert.throws(() => acquireLock(file), /already running \(pid \d+\)/);
  release();
  assert.equal(existsSync(file), false);
  writeFileSync(file, '999999999');
  acquireLock(file)();
  assert.equal(existsSync(file), false);
});
test('preflight passes when everything is in place', async () =>
  assert.equal(await preflight(fakes().deps), undefined));
test('preflight fails closed when the sandbox probe fails', async () =>
  assert.rejects(preflight(fakes({ failing: ['bwrap'] }).deps), /sandbox/i));
test('preflight fails when claude is missing', async () =>
  assert.rejects(preflight(fakes({ failing: ['claude'] }).deps), /claude/i));
test('preflight fails when gh is logged in as someone else', async () =>
  assert.rejects(preflight(fakes({ login: 'mallory' }).deps), /mallory/));
test('a park is logged once, with every line of its reason', async () => {
  const d = fakes({ candidates: [issue(9)] });
  d.deps.runItem = async () => ({ outcome: 'parked', detail: 'touches protected files:\n- test/a.test.js\n- test/b.test.js' });
  const running = new Map();
  await tick(d.deps, running); await Promise.all(running.values());
  const parks = d.logs.filter((l) => l.includes('parked'));
  assert.equal(parks.length, 1);
  assert.ok(parks[0].includes('touches protected files:\n          - test/a.test.js\n          - test/b.test.js'), parks[0]);
});
test('lockHolder names a live holder and ignores dead or missing locks', async () => {
  const { lockHolder } = await import('../lib/loop.mjs');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'lock-'));
  assert.equal(lockHolder(join(dir, 'none.lock')), null);
  writeFileSync(join(dir, 'live.lock'), String(process.pid));
  assert.equal(lockHolder(join(dir, 'live.lock')), process.pid);
  writeFileSync(join(dir, 'dead.lock'), '2147483646');
  assert.equal(lockHolder(join(dir, 'dead.lock')), null);
});
