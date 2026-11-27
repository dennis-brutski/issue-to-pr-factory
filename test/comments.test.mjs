// The factory's own GitHub comments: what one module writes, the same module reads back.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { stopped, didNotStart, explore, rework, pullRequest, merged, isFactory, lastStop, lastPush, NO_NEW_COMMENTS, autoMerged, autoMergeFailed, autoMergedPull, reasons, stopLabel, isRework, setupApprovals, isStop } from '../lib/comments.mjs';
import { config } from '../config.mjs';
import scorePad from './fixtures/web-app-target.mjs';
import { verifyBranch } from '../lib/verify.mjs';
import { interpret } from '../lib/agent.mjs';
import { classify } from '../lib/eligibility.mjs';
import { fakeWorkspace, fakeView } from './fakes/workspace.mjs';
import { proxyServer } from '../lib/proxy.mjs';
import { connect } from 'node:net';

const OWNER = 'dennis-brutski', T = '2026-11-01T10:00:00Z', T2 = '2026-11-01T11:00:00Z';
const LABEL = 'agent:needs-human';
const c = (body, at = T2, author = OWNER) => ({ author, body, at });

test('the wording of each comment stays word for word', () => {
  assert.equal(stopped('implement', '`npm test` failed', LABEL),
    '🏭 **Factory stopped (implement).**\n\n`npm test` failed\n\nRemove the `agent:needs-human` label to try again.');
  assert.equal(stopped('review', 'RED', LABEL, 'factory/issue-3'),
    "🏭 **Factory stopped (review).**\n\nRED\n\nRemove the `agent:needs-human` label to try again. Work so far is kept on the factory's local branch `factory/issue-3`.");
  assert.equal(didNotStart('issue text was edited after it was approved', LABEL),
    '🏭 **Factory did not start.**\n\nThe issue text was edited after it was approved. Check it, then remove the `agent:needs-human` label to approve it again.');
  assert.equal(explore('Notes', true, false), '🏭 **Factory explore write-up**\n\nNotes\n\nEasy to undo: yes · Small reach: no');
  assert.equal(rework('Renamed a'), '🏭 **Rework**\n\nRenamed a');
  assert.equal(pullRequest('https://github.com/x/y/pull/5'), '🏭 Pull request: https://github.com/x/y/pull/5');
});

test('every comment the factory writes is recognised as its own; others are not', () => {
  for (const body of [stopped('implement', 'x', LABEL), didNotStart('y', LABEL), explore('w', false, true), rework('s'), pullRequest('u'), merged])
    assert.ok(isFactory(body), body);
  assert.equal(isFactory('rename it'), false);
  assert.equal(isFactory('Factory stopped: do X'), false);
});

test('what stopped() writes, lastStop() finds: the newest one since the push', () => {
  const comments = [
    c(stopped('implement', 'old reason', LABEL), '2026-11-01T09:30:00Z'),
    c(pullRequest('https://github.com/x/y/pull/50'), T),
    c(stopped('implement', 'RED', LABEL), T2),
    c(didNotStart('issue text was edited', LABEL), '2026-11-01T12:30:00Z'),
  ];
  assert.equal(lastStop(comments, OWNER), stopped('implement', 'RED', LABEL));
  assert.equal(lastStop([...comments, c(rework('s'), '2026-11-01T11:30:00Z')], OWNER), '');
  assert.equal(lastStop(comments.slice(0, 1), OWNER), stopped('implement', 'old reason', LABEL));
});

test('a "no new comments" stop is skipped', () => {
  const comments = [c(stopped('review', 'could not finish the rework', LABEL), '2026-11-01T10:30:00Z'), c(stopped('review', NO_NEW_COMMENTS, LABEL), T2)];
  assert.equal(lastStop([c(rework('s'), T), ...comments], OWNER), stopped('review', 'could not finish the rework', LABEL));
});

test('stop comments by others are ignored; the owner matches in any case', () => {
  assert.equal(lastStop([c(rework('s'), T), c(stopped('implement', 'RED', LABEL), T2, 'someone')], OWNER), '');
  assert.equal(lastStop([c(rework('s'), T), c(stopped('implement', 'RED', LABEL), T2, 'Dennis-Brutski')], OWNER), stopped('implement', 'RED', LABEL));
});

test('the last push is the newest factory comment by the owner that is not a stop', () => {
  assert.equal(lastPush([], OWNER), null);
  assert.equal(lastPush([c(pullRequest('u'), T), c(rework('s'), T2)], OWNER), T2);
  assert.equal(lastPush([c(rework('s'), T2), c(merged, T)], OWNER), T2);
  assert.equal(lastPush([c(merged, T), c(stopped('merge', 'RED', LABEL), T2), c(didNotStart('y', LABEL), T2)], OWNER), T);
  assert.equal(lastPush([c(merged, T), c('looks good', T2), c(rework('s'), T2, 'someone')], OWNER), T);
});

// ADR 0007: only the owner's own comments approve setup for a commit, never the factory's.
test('setup approvals are the full shas the owner names in their own comments', () => {
  const a = 'a'.repeat(40), b = '0123456789abcdef0123456789abcdef01234567';
  assert.deepEqual(setupApprovals([c(`approve protected setup ${a}`, T), c(`Read it, fine.\napprove protected setup ${b}\n`, T2, 'Dennis-Brutski')], OWNER), [a, b]);
});

test('setup approvals by others, in factory comments or without a full sha do not count', () => {
  const a = 'a'.repeat(40);
  assert.deepEqual(setupApprovals([
    c(`approve protected setup ${a}`, T, 'someone'),
    c(stopped('implement', `approve protected setup ${a}`, LABEL), T),
    c(`🏭 approve protected setup ${a}`, T),
    c(`approve protected setup ${a.slice(0, 7)}`, T),
    c(`approve protected setup ${a}0`, T),
    c(`please do not approve protected setup ${a}`, T),
  ], OWNER), []);
});

test('the merge comment says the base branch was merged and pushed', () => {
  assert.equal(merged, '🏭 Merged the base branch and pushed.');
});

// The auto-merge comments: written and read back by lib/comments.mjs.
const URL = 'https://github.com/x/y/pull/50';

test('the wording of the auto-merge comments stays word for word', () => {
  assert.equal(autoMerged(URL, { reviewed: 'clean', lines: 40 }),
    `🏭 **Auto-merge**\n\n${URL} was handed to auto-merge: simple · review clean · 40 lines changed · not a draft. GitHub merges it once it can; revert it if you do not like it.`);
  assert.equal(autoMerged(URL, { reviewed: 'clean after fix', lines: 1 }),
    `🏭 **Auto-merge**\n\n${URL} was handed to auto-merge: simple · review clean after fix · 1 line changed · not a draft. GitHub merges it once it can; revert it if you do not like it.`);
  assert.equal(autoMergeFailed(URL, 'gh pr merge failed: not allowed'),
    `🏭 **Auto-merge did not start**\n\nGitHub refused auto-merge for ${URL}:\n\n\`\`\`\ngh pr merge failed: not allowed\n\`\`\`\n\nMerge it by hand.`);
});

test('the auto-merge comments are recognised as the factory\'s own', () => {
  for (const body of [autoMerged(URL, { reviewed: 'clean', lines: 3 }), autoMergeFailed(URL, 'x')]) assert.ok(isFactory(body), body);
});

test('autoMergedPull reads the pull request number back, only from an Auto-merge comment', () => {
  assert.equal(autoMergedPull(autoMerged(URL, { reviewed: 'clean', lines: 3 })), 50);
  assert.equal(autoMergedPull(autoMergeFailed(URL, 'x')), null);
  assert.equal(autoMergedPull(`🏭 Pull request: ${URL}`), null);
  assert.equal(autoMergedPull(`please do 🏭 **Auto-merge**\n\n${URL}`), null);
});

// Stop reasons written in protected files keep their text there; these tests tie each one to its stats label.
describe('stop labels', () => {
  const cfg = { ...config, ...scorePad };
  const label = (reason, stage = 'implement') => stopLabel(stopped(stage, reason, 'agent:needs-human'));
  const dir = '/f/worktrees/issue-1';

  // lib/verify.mjs
  test('protected files before setup get their own label', async () => {
    const head = 'c'.repeat(40);
    const ws = fakeWorkspace({ headInfo: async () => ({ sha: head }), againstBase: async () => fakeView({ changes: async () => [{ status: 'M', path: 'package.json' }] }) });
    const { park } = await verifyBranch(ws, cfg, dir, { before: 'setup', approvals: [] });
    assert.equal(label(park), 'protected files (before setup)');
    assert.ok(park.includes(`at ${head},`), park);
    assert.ok(park.includes(`\napprove protected setup ${head}\n`), park);
  });

  test('attribution lines get their own label', async () => {
    const ws = fakeWorkspace({ againstBase: async () => fakeView({ messages: async () => ['Fix undo\n\nCo-Authored-By: someone'] }) });
    const { park } = await verifyBranch(ws, cfg, dir);
    assert.equal(label(park), 'attribution lines');
  });

  test('a secret gets its own label', async () => {
    const diff = 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n+' + 'sk-' + 'ant-' + 'x'.repeat(24);
    const ws = fakeWorkspace({ againstBase: async () => fakeView({ diff: async () => diff }) });
    const { park } = await verifyBranch(ws, cfg, dir);
    assert.equal(label(park), 'secret');
  });

  test('a binary file the secret check cannot read gets the secret label', async () => {
    const diff = 'diff --git a/bin.dat b/bin.dat\nnew file mode 100644\nBinary files /dev/null and b/bin.dat differ';
    const ws = fakeWorkspace({ againstBase: async () => fakeView({ diff: async () => diff }) });
    const { park } = await verifyBranch(ws, cfg, dir);
    assert.equal(label(park), 'secret');
  });

  test('CI workflow files are labelled workflow files', async () => {
    const ws = fakeWorkspace({ againstBase: async () => fakeView({ changes: async () => [{ status: 'M', path: '.github/workflows/ci.yml' }] }) });
    const { park } = await verifyBranch(ws, cfg, dir);
    assert.equal(label(park), 'workflow files');
  });

  // lib/agent.mjs, as the stages wrap it: "The <step> step failed: <reason>"
  const session = (r, code = 0) => ({ code, timedOut: false, stderr: '', stdout: JSON.stringify({ type: 'result', session_id: 's1', ...r }) });
  const failed = (exec) => label(reasons.stepFailed('implement', interpret(exec, 45).reason));

  test('a timed-out session is labelled timed out', () => {
    assert.equal(failed({ code: null, timedOut: true, stderr: '', stdout: '' }), 'timed out / max turns / usage limit');
  });

  test('a session that spent its budget is labelled budget cap', () => {
    assert.equal(failed(session({ is_error: true, terminal_reason: 'budget_exhausted', total_cost_usd: 2 })), 'budget cap');
  });

  test('a session stopped at max turns is labelled max turns', () => {
    assert.equal(failed(session({ is_error: true, terminal_reason: 'max_turns' })), 'timed out / max turns / usage limit');
  });

  test('a session that hit the usage limit is labelled usage limit', () => {
    assert.equal(failed(session({ is_error: true, result: "You've hit your usage limit" }, 1)), 'timed out / max turns / usage limit');
  });

  test('a session that failed for another reason is labelled agent session failed', () => {
    assert.equal(failed(session({ is_error: true, result: 'API error' }, 1)), 'agent session failed');
  });

  test('a session whose output is not JSON is labelled agent session failed', () => {
    assert.equal(failed({ code: 1, timedOut: false, stderr: 'boom', stdout: '' }), 'agent session failed');
  });

  test('a session without a status report is labelled no status report', () => {
    assert.equal(failed(session({ is_error: false, structured_output: null })), 'no status report');
  });

  // lib/eligibility.mjs, written by lib/loop.mjs as a did-not-start comment
  const T = '2026-11-01T10:00:00Z', LATER = '2026-11-01T11:00:00Z';
  const issue = (o) => ({
    number: 1, kind: 'issue', title: 't', body: 'b', author: 'mallory', bodyEditedAt: null,
    labels: ['agent:implement'], labelEvents: [{ label: 'agent:implement', actor: config.owner, at: T }],
    comments: [], renames: [], headRef: null, headRepo: null, ...o,
  });
  const parked = (item) => {
    const c = classify(item, cfg);
    assert.equal(c.action, 'park');
    return c.reason;
  };

  test('an issue edited after approval is labelled edited after approval', () => {
    const reason = parked(issue({ bodyEditedAt: LATER }));
    assert.equal(stopLabel(didNotStart(reason, 'agent:needs-human')), 'edited after approval');
    assert.equal(label(reason), 'edited after approval');
  });

  test('an issue renamed after approval is labelled edited after approval', () => {
    const reason = parked(issue({ renames: [{ actor: 'mallory', at: LATER }] }));
    assert.equal(stopLabel(didNotStart(reason, 'agent:needs-human')), 'edited after approval');
    assert.equal(label(reason), 'edited after approval');
  });
});

// Sample arguments for every reason function. A new reason without a sample fails the first test.
const SAMPLES = {
  stepFailed: ['implement', 'something new went wrong'],
  readOnlyChanged: ['gate'],
  worktreeDirty: ['runs/demo/worktrees/issue-1'],
  conflictsWithBase: ['factory/issue-1', 'main', 'runs/demo/worktrees/issue-1'],
  setupFailed: ['npm ci', '<details>out</details>'],
  factoryError: ['gh api failed'],
  notOnBranch: ['factory/issue-1', null],
  uncommitted: [],
  heldOutFailed: ['node --test held/'],
  checkFailed: ['npm test', '<details>out</details>'],
  needsDecision: ['agent:explore', 'agent:implement'],
  notClear: [40, 70, '- Which?'],
  couldNotFinish: ['Missing a fixture.'],
  noChanges: [],
  couldNotFix: ['No.'],
  draft: ['https://github.com/x/y/pull/3', '- package.json'],
  couldNotRework: ['No.'],
  reworkDraft: ['- package.json'],
  mergeUnresolved: ['Gave up.'],
  mergeDraft: ['- package.json'],
};

test('every reason function has a label and a sample here', () => {
  assert.deepEqual(Object.keys(reasons).sort(), Object.keys(SAMPLES).sort());
  for (const [name, fn] of Object.entries(reasons)) assert.ok(fn.label && !fn.label.startsWith('other'), name);
});

test('stopLabel gives each reason function its own label, never other', () => {
  for (const [name, fn] of Object.entries(reasons)) {
    const body = stopped('implement', fn(...SAMPLES[name]), 'agent:needs-human', 'factory/issue-1');
    assert.equal(stopLabel(body), fn.label, name);
  }
});

// The two verify.mjs reasons (attribution lines, protected files before setup) are asserted in
// test/comments-protected-reasons.test.mjs, where they are produced the real way.
test('the four stages.mjs reasons stats used to show as other get labels of their own', () => {
  const label = (reason) => stopLabel(stopped('implement', reason, 'agent:needs-human', 'factory/issue-1'));
  assert.equal(label(reasons.readOnlyChanged('gate')), 'read-only step changed files');
  assert.equal(label(reasons.notOnBranch('factory/issue-1', null)), 'worktree not on its branch');
  assert.equal(label(reasons.notOnBranch('factory/issue-1', 'main')), 'worktree not on its branch');
  assert.equal(label(reasons.uncommitted()), 'agent left uncommitted changes');
  assert.equal(label(reasons.mergeUnresolved('Gave up.')), 'merge unresolved');
});

test('the reason texts stay as the owner knows them', () => {
  assert.equal(reasons.uncommitted(), 'The agent left uncommitted changes in the worktree.');
  assert.equal(reasons.notOnBranch('factory/issue-1', null), 'The worktree is not on its branch `factory/issue-1` (HEAD is detached), so the factory did not push.');
  assert.equal(reasons.notOnBranch('factory/issue-1', 'main'), 'The worktree is not on its branch `factory/issue-1` (HEAD is on `main`), so the factory did not push.');
  assert.equal(reasons.readOnlyChanged('gate'), 'The gate step is read-only but changed files in the worktree.');
  assert.equal(reasons.mergeUnresolved('Gave up.'), 'The merge is still unresolved. The worktree is left mid-merge.\n\nGave up.');
  assert.equal(reasons.stepFailed('gate', 'timed out after 45 min'), 'The gate step failed: timed out after 45 min');
});

test('what rework() writes, isRework() recognises; other comments are not reworks', () => {
  assert.equal(isRework(rework('Renamed a')), true);
  for (const body of [stopped('review', 'x', LABEL), pullRequest('u'), 'Rework: please rename it', `say 🏭 **Rework**`]) assert.equal(isRework(body), false, body);
});

test('isStop: the stop and did-not-start comments, nothing else', () => {
  assert.equal(isStop(stopped('implement', 'Something broke.', 'agent:needs-human')), true);
  assert.equal(isStop(didNotStart('issue body changed', 'agent:needs-human')), true);
  assert.equal(isStop(merged), false);
  assert.equal(isStop('Factory stopped, I think'), false);
});

test('a failed setup through the proxy names the hosts it refused, before the output', () => {
  const one = reasons.setupFailed('npm ci', '<details>out</details>', { refused: [{ host: 'x.com', why: 'unlisted' }], requests: 2 });
  assert.equal(one, '`npm ci` failed in the worktree (setup):\n\nsetup tried to reach `x.com`, which is not in `setupHosts`.\n\n<details>out</details>');
  const two = reasons.setupFailed('npm ci', 'out', { refused: [{ host: 'x.com', why: 'unlisted' }, { host: 'y.org', why: 'unlisted' }], requests: 2 });
  assert.match(two, /setup tried to reach `x.com` and `y.org`, which are not in `setupHosts`\./);
  assert.equal(stopLabel(stopped('implement', two, 'agent:needs-human')), 'setup failed');
});
test('a failed setup names hosts in setupHosts refused for another reason with that reason, not as unlisted', () => {
  const r = reasons.setupFailed('npm ci', 'out', { requests: 4, refused: [{ host: 'x.com', why: 'unlisted' }, { host: 'a.test', why: 'private' },
    { host: 'registry.npmjs.org:22', why: 'port' }, { host: 'registry.npmjs.org', why: 'plain' }] });
  assert.equal(r, '`npm ci` failed in the worktree (setup):\n\n'
    + 'setup tried to reach `x.com`, which is not in `setupHosts`.\n\n'
    + 'setup tried to reach `a.test`, which resolves to an address on this machine or the local network: the proxy refuses those, even for hosts in `setupHosts`.\n\n'
    + 'setup tried to reach `registry.npmjs.org:22`: the proxy allows only port 443.\n\n'
    + 'setup sent plain HTTP to `registry.npmjs.org`: the proxy allows only HTTPS (`CONNECT` to port 443). Use an `https://` URL.\n\n'
    + 'out');
});
test('a failed setup with more refusals than the proxy recorded says how many more', () => {
  const refused = Array.from({ length: 10 }, (_, i) => ({ host: `h${i}.test`, why: 'unlisted' }));
  const r = reasons.setupFailed('npm ci', 'out', { refused, moreRefused: 2990, requests: 3000 });
  assert.match(r, /setup tried to reach `h0.test`, .* and `h9.test`, which are not in `setupHosts`\.\n\nThe proxy refused 2990 more requests to other hosts\.\n\nout$/);
  assert.ok(r.length < 2000, String(r.length));
  // Even a list longer than the proxy records prints only the first 10.
  const long = reasons.setupFailed('npm ci', 'out', { refused: Array.from({ length: 3000 }, (_, i) => ({ host: `h${i}.test`, why: 'unlisted' })), requests: 3000 });
  assert.match(long, /`h9.test`, which are not in `setupHosts`\.\n\nThe proxy refused 2990 more requests to other hosts\.\n\nout$/);
  assert.ok(!long.includes('h10.test'));
});
test('a failed setup after ten refused 8,000-character hosts gives a comment well under GitHub\'s limit', async () => {
  const proxy = proxyServer({ hosts: [] });
  await new Promise((r) => proxy.server.listen(0, '127.0.0.1', () => r(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (proxy.server.address()).port;
  try {
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve, reject) => {
        const s = connect(port, '127.0.0.1', () => s.write(`CONNECT ${String(i).repeat(8000)}.test:443 HTTP/1.1\r\n\r\n`));
        s.once('data', () => { s.destroy(); resolve(undefined); });
        s.once('error', reject);
      });
    }
    assert.equal(proxy.refused().length, 10);
    const r = reasons.setupFailed('npm ci', 'out', { refused: proxy.refused(), moreRefused: proxy.moreRefused(), requests: proxy.requests() });
    assert.ok(r.length < 5000, String(r.length));
    assert.ok(stopped('implement', r, LABEL).length < 65_536);
  } finally { await proxy.close(); }
});
test('a failed setup the proxy saw no request from says the tool may ignore HTTPS_PROXY', () => {
  const r = reasons.setupFailed('npm ci', 'out', { refused: [], requests: 0 });
  assert.match(r, /The proxy saw no requests at all: the tool may ignore `HTTPS_PROXY`\./);
});
test('a failed setup with requests and nothing refused, or with full network, adds nothing', () => {
  assert.equal(reasons.setupFailed('npm ci', 'out', { refused: [], requests: 3 }), '`npm ci` failed in the worktree (setup):\n\nout');
  assert.equal(reasons.setupFailed('npm ci', 'out', {}), '`npm ci` failed in the worktree (setup):\n\nout');
});
