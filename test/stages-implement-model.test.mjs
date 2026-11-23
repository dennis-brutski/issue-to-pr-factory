// A cheaper model may write the first draft of a simple issue; review and fix stay on cfg.model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.mjs';
import scorePad from './fixtures/web-app-target.mjs';
import { runItem, schemas } from '../lib/stages.mjs';
import { stopped } from '../lib/comments.mjs';
import { fakeWorkspace } from './fakes/workspace.mjs';

const ok = (output) => ({ ok: true, output, reason: '', sessionId: 's' });
const issue = {
  number: 7, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
  labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: '2026-11-01T10:00:00Z' }],
  comments: [], headRef: null, headRepo: null,
};
const simpleGate = { confidence: 90, questions: [], difficulty: 'simple', files: ['src/a.js'] };

function deps(gate, models, review = { verdict: 'clean', findings: [] }) {
  const opened = [], seen = [];
  const queue = [ok(gate), ok({ status: 'complete', summary: 'Changed undo.', detail: '' }), ok(review),
    ok({ status: 'complete', summary: 'Fixed.', detail: '' })];
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
      headInfo: async () => ({ sha: `abc${sessions}`, committedAt: '2026-11-01T10:00:00Z' }),
      changesAgainstBase: async () => [{ status: 'M', path: 'src/state.js' }],
      commitMessagesAgainstBase: async () => ['Fix undo'],
      isClean: async () => true, diffAgainstBase: async () => '', mergeBase: async () => 'clean',
      push: async () => {}, currentBranch: async () => 'factory/issue-7',
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

test('a simple issue is drafted on simpleModel, reviewed and fixed on model', async () => {
  const { seen } = await run(simpleGate, { model: 'opus', gateModel: 'sonnet', simpleModel: 'sonnet' },
    { verdict: 'findings', findings: ['Missing test for redo'] });
  assert.deepEqual(seen, [
    { session: 'gate', model: 'sonnet' }, { session: 'implement', model: 'sonnet' },
    { session: 'review', model: 'opus' }, { session: 'fix', model: 'opus' },
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
