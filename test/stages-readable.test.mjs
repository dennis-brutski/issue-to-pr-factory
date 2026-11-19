import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.mjs';
import scorePad from '../targets/gin-rummy-score-pad.mjs';
import { runItem, lastStopReason } from '../lib/stages.mjs';
import { stopLabel } from '../stats.mjs';
import { fakeWorkspace } from './fakes/workspace.mjs';

const ok = (output) => ({ ok: true, output, reason: '', sessionId: 's' });
const issue = {
  number: 7, kind: 'issue', title: 'Fix undo', body: 'Undo fails', author: 'dennis-brutski', bodyEditedAt: null,
  labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: 'dennis-brutski', at: '2026-11-01T10:00:00Z' }],
  comments: [], headRef: null, headRepo: null,
};
const OUTPUT = 'not ok 1 - undo\n  ```\n  expected 2\nnot ok 2 - redo';

function deps({ gate = { confidence: 87, questions: [] }, changes = [{ status: 'M', path: 'src/state.js' }], ...extra } = {}) {
  const opened = [], comments = [];
  const queue = [ok(gate), ok({ status: 'complete', summary: 'Changed undo.', detail: '' }), ok({ verdict: 'clean', findings: [] })];
  let sessions = 0;
  const d = {
    cfg: { ...config, ...scorePad, target: 'gin-rummy-score-pad', model: 'opus-test', gateModel: 'opus-test' }, root: '/f', log: () => {},
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
      headInfo: async () => ({ sha: `abc${sessions}`, committedAt: '2026-11-01T10:00:00Z' }),
      changesAgainstBase: async () => changes,
      commitMessagesAgainstBase: async () => ['Fix undo'],
      isClean: async () => true, diffAgainstBase: async () => '', mergeBase: async () => 'clean',
      push: async () => {}, currentBranch: async () => 'factory/issue-7',
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
  assert.match(r2.detail, /is a draft because it touches protected files:\n\n- /);
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
  reworked.d.ws.headInfo = async () => ({ sha: `abc${n++}`, committedAt: '2026-11-01T10:00:00Z' });
  const r2 = await runItem(asked, 'review', reworked.d, 4201);
  assert.match(r2.detail, /it touches protected files, so the pull request is now a draft:\n\n- /);
});
