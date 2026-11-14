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
  comments(last: 100) { nodes { author { login } body createdAt } }`;

// last: — not first: — so the newest label events and comments are always present.
const QUERY = `query($owner: String!, $name: String!, $labels: [String!]) {
  repository(owner: $owner, name: $name) {
    issues(states: OPEN, first: 50, labels: $labels, orderBy: {field: CREATED_AT, direction: ASC}) { nodes { ${COMMON} } }
    pullRequests(states: OPEN, first: 50, labels: $labels, orderBy: {field: CREATED_AT, direction: ASC}) { nodes { ${COMMON}
      headRefName headRepository { nameWithOwner }
      reviews(last: 50) { nodes { author { login } body createdAt } }
      reviewThreads(last: 50) { nodes { comments(last: 20) { nodes { author { login } body path createdAt } } } }
    } }
  }
}`;

async function gh(args, opts = {}) {
  const r = await run('gh', args, { timeoutMs: 60_000, ...opts });
  if (r.code !== 0) throw new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${(r.stderr || r.stdout).trim().slice(0, 500)}`);
  return r.stdout;
}

const allLabels = (cfg) => [...Object.values(cfg.triggers), ...Object.values(cfg.states)];

export async function listCandidates(cfg) {
  const [owner, name] = cfg.repo.split('/');
  const args = ['api', 'graphql', '-f', `query=${QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`];
  for (const l of allLabels(cfg)) args.push('-f', `labels[]=${l}`);
  return toItems(JSON.parse(await gh(args)));
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
  await gh(['pr', 'edit', String(number), '--repo', cfg.repo, '--body-file', '-'], { input: body });
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

export async function authenticatedLogin() {
  return (await gh(['api', 'user', '--jq', '.login'])).trim();
}
