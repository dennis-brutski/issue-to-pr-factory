import { run } from './exec.mjs';

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
      headRef: kind === 'pr' ? n.headRefName ?? null : null,
      headRepo: kind === 'pr' ? n.headRepository?.nameWithOwner ?? '' : null,
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
const PAGE = (connection, extra = '') => `query($owner: String!, $name: String!, $labels: [String!], $after: String) {
  repository(owner: $owner, name: $name) {
    ${connection}(states: OPEN, first: 50, after: $after, labels: $labels, orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes { ${COMMON}${extra} }
    }
  }
}`;
const QUERIES = {
  issues: PAGE('issues'),
  pullRequests: PAGE('pullRequests', `
      headRefName headRepository { nameWithOwner }
      reviews(last: 50) { nodes { author { login } body createdAt } }
      reviewThreads(last: 50) { nodes { comments(last: 20) { nodes { author { login } body path createdAt } } } }`),
};

async function gh(args, opts = {}) {
  const r = await run('gh', args, { timeoutMs: 60_000, ...opts });
  if (r.code !== 0) throw new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${(r.stderr || r.stdout).trim().slice(0, 500)}`);
  return r.stdout;
}

const allLabels = (cfg) => [...Object.values(cfg.triggers), ...Object.values(cfg.states)];

// One page of open labelled issues or pull requests: { nodes, pageInfo }.
async function fetchPage(cfg, connection, after) {
  const [owner, name] = cfg.repo.split('/');
  const args = ['api', 'graphql', '-f', `query=${QUERIES[connection]}`, '-f', `owner=${owner}`, '-f', `name=${name}`];
  for (const l of allLabels(cfg)) args.push('-f', `labels[]=${l}`);
  if (after) args.push('-f', `after=${after}`);
  return JSON.parse(await gh(args)).data.repository[connection];
}

export async function listCandidates(cfg, page = (connection, after) => fetchPage(cfg, connection, after)) {
  const all = async (connection) => {
    const nodes = [];
    for (let after = null; ;) {
      const p = await page(connection, after);
      nodes.push(...(p.nodes ?? []));
      if (!p.pageInfo?.hasNextPage) return nodes;
      after = p.pageInfo.endCursor;
    }
  };
  const issues = await all('issues');
  const pullRequests = await all('pullRequests');
  return toItems({ data: { repository: { issues: { nodes: issues }, pullRequests: { nodes: pullRequests } } } });
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

// True when nothing more will happen for this issue: it is closed, or its
// factory pull request was merged or closed.
export async function isFinished(cfg, issueNumber) {
  const state = (await gh(['api', `repos/${cfg.repo}/issues/${issueNumber}`, '--jq', '.state'])).trim();
  if (state === 'closed') return true;
  const prs = JSON.parse(await gh(['pr', 'list', '--repo', cfg.repo, '--head', `factory/issue-${issueNumber}`, '--state', 'all', '--json', 'state']));
  return prs.length > 0 && prs.every((p) => p.state !== 'OPEN');
}

export async function listLabels(cfg) {
  return (await gh(['api', `repos/${cfg.repo}/labels`, '--paginate', '--jq', '.[].name'])).split('\n').filter(Boolean);
}

export async function createLabel(cfg, name) {
  await gh(['api', '-X', 'POST', `repos/${cfg.repo}/labels`, '-f', `name=${name}`, '-f', 'color=ededed']);
}

export async function authenticatedLogin() {
  return (await gh(['api', 'user', '--jq', '.login'])).trim();
}
