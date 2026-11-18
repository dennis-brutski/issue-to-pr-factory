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

function deps(extra = {}) {
  const opened = [];
  const queue = [ok({ confidence: 87, questions: [] }), ok({ status: 'complete', summary: 'Changed undo.', detail: '' }), ok({ verdict: 'clean', findings: [] })];
  let sessions = 0;
  const d = {
    cfg: { ...config, ...scorePad, target: 'gin-rummy-score-pad', model: 'opus-test', gateModel: 'opus-test' }, root: '/f', log: () => {},
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
      headInfo: async () => ({ sha: `abc${sessions}`, committedAt: '2026-11-01T10:00:00Z' }),
      changesAgainstBase: async () => [{ status: 'M', path: 'src/state.js' }],
      commitMessagesAgainstBase: async () => ['Fix undo'],
      isClean: async () => true, diffAgainstBase: async () => '', mergeBase: async () => 'clean',
      push: async () => {}, currentBranch: async () => 'factory/issue-7',
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
  assert.equal(last, `🏭 Built by issue-to-pr-factory f00ba12 · model opus-test · gate confidence 87 · checks: ${checks} · session logs: runs/gin-rummy-score-pad/logs/issue-7/`);
  assert.match(body, /\n---\n🏭 Built by/);
  assert.match(body, /Closes #7/);
});

test('an unknown factory commit says unknown', async () => {
  const { d, opened } = deps();
  await runItem(issue, 'implement', d, 4201);
  assert.match(opened[0].body, /🏭 Built by issue-to-pr-factory unknown · model opus-test · gate confidence 87 ·/);
});
