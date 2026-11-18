// The gate can run on its own, cheaper model; every other session keeps cfg.model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.mjs';
import scorePad from '../targets/gin-rummy-score-pad.mjs';
import { runItem } from '../lib/stages.mjs';
import { fakeWorkspace } from './fakes/workspace.mjs';

const ok = (output) => ({ ok: true, output, reason: '', sessionId: 's' });
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
    cfg: { ...config, ...scorePad, target: 'gin-rummy-score-pad', ...models }, root: '/f', log: () => {},
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
      headInfo: async () => ({ sha: `abc${sessions}`, committedAt: '2026-11-01T10:00:00Z' }),
      changesAgainstBase: async () => [{ status: 'M', path: 'src/state.js' }],
      commitMessagesAgainstBase: async () => ['Fix undo'],
      isClean: async () => true, diffAgainstBase: async () => '', mergeBase: async () => 'clean',
      push: async () => {}, currentBranch: async () => 'factory/issue-7',
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
