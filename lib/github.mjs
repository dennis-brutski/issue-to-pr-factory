import { run } from './exec.mjs';
import { branchFor } from './names.mjs';

const login = (x) => x?.login ?? '';

// Pure: GraphQL response → Item[] (shape documented in the plan, Task 1).
export function toItems(graphqlData) {
  const repo = graphqlData.data.repository;
  const map = (kind) => (n) => {
    const comments = (n.comments?.nodes ?? []).map((c) => ({ author: login(c.author), body: c.body, at: c.createdAt }));
    for (const r of n.reviews?.nodes ?? [])
      if (r.body) comments.push({ author: login(r.author), body: r.body, at: r.createdAt });
    for (const t of n.reviewThreads?.nodes ?? [])
      for (const c of t.comments?.nodes ?? [])
        comments.push({ author: login(c.author), body: c.path ? `[${c.path}] ${c.body}` : c.body, at: c.createdAt });
    comments.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return {
      number: n.number, kind, title: n.title, body: n.body ?? '', author: login(n.author),
      bodyEditedAt: n.lastEditedAt ?? null,
      labels: (n.labels?.nodes ?? []).map((l) => l.name),
      labelEvents: (n.timelineItems?.nodes ?? []).filter((e) => e?.label)
        .map((e) => ({ label: e.label.name, actor: login(e.actor), at: e.createdAt })),
      // lastEditedAt covers the body only; a changed title shows up as a rename.
      renames: (n.renames?.nodes ?? []).filter(Boolean).map((e) => ({ actor: login(e.actor), at: e.createdAt })),
      comments,
      // GitHub's blocked-by links; a blocker the token cannot see comes back as null.
      blockedBy: (n.blockedBy?.nodes ?? []).filter(Boolean)
        .map((b) => ({ number: b.number, repo: b.repository?.nameWithOwner ?? '', open: b.state === 'OPEN' })),
      headRef: kind === 'pr' ? n.headRefName ?? null : null,
      headRepo: kind === 'pr' ? n.headRepository?.nameWithOwner ?? '' : null,
      mergeable: kind === 'pr' ? n.mergeable ?? null : null, // 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
    };
  };
  return [...(repo.issues?.nodes ?? []).map(map('issue')), ...(repo.pullRequests?.nodes ?? []).map(map('pr'))];
}

const COMMON = `number title body lastEditedAt author { login }
  labels(first: 20) { nodes { name } }
  timelineItems(itemTypes: [LABELED_EVENT], last: 50) { nodes { ... on LabeledEvent { createdAt actor { login } label { name } } } }
  renames: timelineItems(itemTypes: [RENAMED_TITLE_EVENT], last: 20) { nodes { ... on RenamedTitleEvent { createdAt actor { login } } } }
  comments(last: 100) { nodes { author { login } body createdAt } }`;

// last: — not first: — so the newest label events and comments are always present.
// Issues and pull requests are paged separately, 50 at a time, so none is ever missed.
const PAGE = (connection, extra = '', { labels = true } = {}) => `query($owner: String!, $name: String!,${labels ? ' $labels: [String!],' : ''} $after: String) {
  repository(owner: $owner, name: $name) {
    ${connection}(states: OPEN, first: 50, after: $after,${labels ? ' labels: $labels,' : ''} orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes { ${COMMON}${extra} }
    }
  }
}`;
const PR_FIELDS = `
      headRefName headRepository { nameWithOwner }
      reviews(last: 50) { nodes { author { login } body createdAt } }
      reviewThreads(last: 50) { nodes { comments(last: 20) { nodes { author { login } body path createdAt } } } }`;
const BLOCKED_BY = `
      blockedBy(first: 20) { nodes { number state repository { nameWithOwner } } }`;
const QUERIES = {
  issues: PAGE('issues', BLOCKED_BY),
  pullRequests: PAGE('pullRequests', PR_FIELDS),
  // Every open pull request, labelled or not, to find the ones that conflict with the base branch.
  conflicts: PAGE('pullRequests', `${PR_FIELDS}
      mergeable`, { labels: false }),
};
const CONNECTION = { issues: 'issues', pullRequests: 'pullRequests', conflicts: 'pullRequests' };

async function gh(args, opts = {}) {
  const r = await run('gh', args, { timeoutMs: 60_000, ...opts });
  if (r.code !== 0) throw new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${(r.stderr || r.stdout).trim().slice(0, 500)}`);
  return r.stdout;
}

const allLabels = (cfg) => [...Object.values(cfg.triggers), ...Object.values(cfg.states)];

// One page of open issues or pull requests (labelled ones, unless the query is conflicts): { nodes, pageInfo }.
async function fetchPage(cfg, query, after) {
  const [owner, name] = cfg.repo.split('/');
  const args = ['api', 'graphql', '-f', `query=${QUERIES[query]}`, '-f', `owner=${owner}`, '-f', `name=${name}`];
  if (query !== 'conflicts') for (const l of allLabels(cfg)) args.push('-f', `labels[]=${l}`);
  if (after) args.push('-f', `after=${after}`);
  return JSON.parse(await gh(args)).data.repository[CONNECTION[query]];
}

const allPages = async (page, query) => {
  const nodes = [];
  for (let after = null; ;) {
    const p = await page(query, after);
    nodes.push(...(p.nodes ?? []));
    if (!p.pageInfo?.hasNextPage) return nodes;
    after = p.pageInfo.endCursor;
  }
};

export async function listCandidates(cfg, page = (query, after) => fetchPage(cfg, query, after)) {
  const issues = await allPages(page, 'issues');
  const pullRequests = await allPages(page, 'pullRequests');
  return toItems({ data: { repository: { issues: { nodes: issues }, pullRequests: { nodes: pullRequests } } } });
}

// Every open pull request, labelled or not, with whether it conflicts with the base branch.
export async function listPullRequests(cfg, page = (query, after) => fetchPage(cfg, query, after)) {
  return toItems({ data: { repository: { pullRequests: { nodes: await allPages(page, 'conflicts') } } } });
}

// The numbers of every open issue, labelled or not; the issues API lists pull requests too, so they are left out.
export const OPEN_ISSUES_JQ = '.[] | select(.pull_request == null) | .number';
export async function openIssueNumbers(cfg) {
  const out = await gh(['api', `repos/${cfg.repo}/issues?state=open&per_page=100`, '--paginate', '--jq', OPEN_ISSUES_JQ]);
  return out.split('\n').filter(Boolean).map(Number);
}

export async function addLabel(cfg, number, label) {
  await gh(['api', '-X', 'POST', `repos/${cfg.repo}/issues/${number}/labels`, '-f', `labels[]=${label}`]);
}

export async function removeLabel(cfg, number, label) {
  const r = await run('gh', ['api', '-X', 'DELETE', `repos/${cfg.repo}/issues/${number}/labels/${encodeURIComponent(label)}`], { timeoutMs: 60_000 });
  if (r.code !== 0 && !/404|Label does not exist|Not Found/i.test(r.stderr + r.stdout))
    throw new Error(`removing label ${label} from #${number} failed: ${r.stderr.trim().slice(0, 500)}`);
}

export async function comment(cfg, number, body) {
  await gh(['api', '-X', 'POST', `repos/${cfg.repo}/issues/${number}/comments`, '-F', 'body=@-'], { input: body.slice(0, 60_000) });
}

export async function findPullRequest(cfg, branch) {
  const out = await gh(['pr', 'list', '--repo', cfg.repo, '--head', branch, '--state', 'open', '--json', 'number,url,isDraft']);
  return JSON.parse(out)[0] ?? null;
}

export async function openPullRequest(cfg, { branch, title, body, draft }) {
  const args = ['pr', 'create', '--repo', cfg.repo, '--head', branch, '--base', cfg.baseBranch, '--title', title, '--body-file', '-'];
  if (draft) args.push('--draft');
  const url = (await gh(args, { input: body })).trim().split('\n').pop();
  return { number: Number(url.split('/').pop()), url };
}

export async function updatePullRequestBody(cfg, number, body) {
  // REST, not `gh pr edit`: gh 2.45's pr edit queries classic project cards, which GitHub now rejects.
  await gh(['api', '-X', 'PATCH', `repos/${cfg.repo}/pulls/${number}`, '-F', 'body=@-'], { input: body });
}

export async function setDraft(cfg, number, draft) {
  await gh(['pr', 'ready', String(number), '--repo', cfg.repo, ...(draft ? ['--undo'] : [])]);
}

// Lines added and removed, as GitHub counts them for the pull request.
export async function pullRequestSize(cfg, number) {
  const { additions, deletions } = JSON.parse(await gh(['pr', 'view', String(number), '--repo', cfg.repo, '--json', 'additions,deletions']));
  return { additions, deletions };
}

// The pull request's body as it is now, not as the poll read it.
export async function pullRequestBody(cfg, number) {
  return JSON.parse(await gh(['pr', 'view', String(number), '--repo', cfg.repo, '--json', 'body'])).body;
}

// Squash-merges once GitHub allows it: after required checks, if the repo has any.
export async function autoMerge(cfg, number) {
  await gh(['pr', 'merge', String(number), '--repo', cfg.repo, '--squash', '--auto']);
}

// True when nothing more will happen for this issue: it is closed, or its
// factory pull request was merged or closed.
export async function isFinished(cfg, issueNumber) {
  const state = (await gh(['api', `repos/${cfg.repo}/issues/${issueNumber}`, '--jq', '.state'])).trim();
  if (state === 'closed') return true;
  const prs = JSON.parse(await gh(['pr', 'list', '--repo', cfg.repo, '--head', branchFor(issueNumber), '--state', 'all', '--json', 'state']));
  return prs.length > 0 && prs.every((p) => p.state !== 'OPEN');
}

export async function listLabels(cfg) {
  return (await gh(['api', `repos/${cfg.repo}/labels`, '--paginate', '--jq', '.[].name'])).split('\n').filter(Boolean);
}

// How the factory's labels look on GitHub: what you set in blue, its own states yellow, green and orange.
const labelStyles = (cfg) => ({
  [cfg.triggers.explore]: ['1d76db', 'Factory: investigate and write up'],
  [cfg.triggers.implement]: ['1d76db', 'Factory: build it and open a pull request'],
  [cfg.triggers.review]: ['1d76db', 'Factory: rework this pull request per my comments'],
  [cfg.triggers.merge]: ['1d76db', `Factory: merge ${cfg.baseBranch} into this branch`],
  [cfg.states.inProgress]: ['fbca04', 'Factory is working on this'],
  [cfg.states.done]: ['0e8a16', 'Factory opened the pull request'],
  [cfg.states.needsHuman]: ['d93f0b', 'Factory stopped; see its comment. Remove to retry'],
});

export async function createLabel(cfg, name) {
  const [color, description] = labelStyles(cfg)[name] ?? ['ededed', ''];
  await gh(['api', '-X', 'POST', `repos/${cfg.repo}/labels`, '-f', `name=${name}`, '-f', `color=${color}`, '-f', `description=${description}`]);
}

// For stats.mjs: every pull request and every issue or pull request comment, all pages, one JSON per line.
const jsonLines = (out) => out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
// One read of each list gives every field the stats need. A comment is on the issue or pull request
// that is the last part of its issue_url.
export const PULLS_JQ = '.[] | {number, ref: .head.ref, repo: .head.repo.full_name, state, merged: (.merged_at != null), at: .created_at, mergedAt: .merged_at, title, body} | @json';
export const COMMENTS_JQ = '.[] | {author: .user.login, body, at: .created_at, on: (.issue_url | split("/") | last | tonumber)} | @json';

/**
 * Every pull request of the repo, open or closed, all pages. Calls `gh`; only reads.
 * @param {{ repo: string }} cfg
 * @returns {Promise<Array<{ number: number, ref: string, repo: string | null, state: string, merged: boolean, at: string, mergedAt: string | null, title: string, body: string | null }>>}
 *   `repo` is null when the head repo is gone; `mergedAt` is null when not merged.
 */
export async function listAllPullRequests(cfg) {
  return jsonLines(await gh(['api', `repos/${cfg.repo}/pulls?state=all&per_page=100`, '--paginate', '--jq', PULLS_JQ]));
}

/**
 * Every comment on the repo's issues and pull requests, all pages; no review comments. Calls `gh`; only reads.
 * @param {{ repo: string }} cfg
 * @returns {Promise<Array<{ author: string, body: string, at: string, on: number }>>} `on` is the issue or pull request number.
 */
export async function listAllIssueComments(cfg) {
  return jsonLines(await gh(['api', `repos/${cfg.repo}/issues/comments?per_page=100`, '--paginate', '--jq', COMMENTS_JQ]));
}

export async function authenticatedLogin() {
  return (await gh(['api', 'user', '--jq', '.login'])).trim();
}
