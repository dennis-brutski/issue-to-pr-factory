// A fake `gh` for behaviour tests. It knows exactly the commands lib/github.mjs
// uses and keeps the "GitHub" state in the JSON file named by FAKE_GH_STATE.
// Anything else fails loudly, so a new gh call in the factory breaks the tests.
import { readFileSync, writeFileSync, renameSync, openSync, closeSync, rmSync } from 'node:fs';
import { PULLS_JQ, COMMENTS_JQ } from '../../../lib/github.mjs';
import { OPEN_ISSUES_JQ } from '../../../lib/github.mjs';

const argv = process.argv.slice(2);
const file = process.env.FAKE_GH_STATE;
let lock = null; // set while we hold it; process.exit skips finally blocks, so die releases it
const die = (msg, code = 1) => { if (lock) rmSync(lock, { force: true }); process.stderr.write(`${msg}\n`); process.exit(code); };
if (!file) die('fake gh: FAKE_GH_STATE is not set', 2);

// Parse: positional words, -X method, -f/-F key=value (repeatable), --flag value, bare --flags.
const pos = [], fields = [], opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '-f' || a === '-F') fields.push(argv[++i]);
  else if (a === '-X') opt.method = argv[++i];
  else if (['--jq', '--repo', '--head', '--base', '--title', '--body-file', '--state', '--json'].includes(a)) opt[a.slice(2)] = argv[++i];
  else if (a.startsWith('--')) opt[a.slice(2)] = true;
  else pos.push(a);
}
const field = (k) => fields.filter((f) => f.startsWith(`${k}=`)).map((f) => f.slice(k.length + 1));
const stdin = () => readFileSync(0, 'utf8');
const now = () => new Date().toISOString();

// One writer at a time: the factory runs gh from parallel item runs.
const lockFile = `${file}.lock`;
const deadline = Date.now() + 5000;
for (;;) {
  try { closeSync(openSync(lockFile, 'wx')); lock = lockFile; break; } catch (e) {
    if (e.code !== 'EEXIST' || Date.now() > deadline) die(`fake gh: cannot lock state: ${e.message}`, 2);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}
let out = '', code = 0, delay = 0;
try {
  const s = JSON.parse(readFileSync(file, 'utf8'));
  s.calls.push(argv);
  const item = (n) => s.items.find((i) => i.number === Number(n)) ?? die(`fake gh: no item #${n} (HTTP 404)`);
  const url = (repo, n) => `https://github.com/${repo}/pull/${n}`;
  const unsupported = () => die(`fake gh: unsupported command: ${argv.join(' ')}`, 2);
  let m;
  const apiPath = (re) => { m = re.exec(pos[1]); return m; }; // matches the API path and keeps the groups in m

  if (pos[0] === 'api' && pos[1] === 'graphql') {
    delay = s.listDelayMs ?? 0; // slow GitHub, outside the lock
    const query = field('query')[0] ?? '';
    const wanted = field('labels[]');
    const actor = (l) => (l ? { login: l } : null);
    const node = (i) => ({
      number: i.number, title: i.title, body: i.body, lastEditedAt: i.lastEditedAt ?? null, author: actor(i.author),
      labels: { nodes: i.labels.map((name) => ({ name })) },
      timelineItems: { nodes: i.labelEvents.map((e) => ({ createdAt: e.at, actor: actor(e.actor), label: { name: e.label } })) },
      renames: { nodes: (i.renames ?? []).map((e) => ({ createdAt: e.at, actor: actor(e.actor) })) },
      comments: { nodes: i.comments.filter((c) => !c.path).map((c) => ({ author: actor(c.author), body: c.body, createdAt: c.at })) },
      ...(i.kind === 'pr' ? {
        headRefName: i.headRefName, headRepository: i.headRepo ? { nameWithOwner: i.headRepo } : null,
        reviews: { nodes: [] },
        reviewThreads: { nodes: i.comments.filter((c) => c.path).map((c) => ({ comments: { nodes: [{ author: actor(c.author), body: c.body, path: c.path, createdAt: c.at }] } })) },
        ...(/\bmergeable\b/.test(query) ? { mergeable: i.mergeable ?? 'MERGEABLE' } : {}),
      } : {}),
    });
    // Pages like GitHub: at most `first:` nodes, starting after the cursor (here: how many came before).
    const connection = (name, kind) => {
      const args = new RegExp(`\\b${name}\\(([^)]*)\\)`).exec(query);
      if (!args) return undefined;
      const first = Number(/first:\s*(\d+)/.exec(args[1])?.[1] ?? 100);
      const start = /after:/.test(args[1]) ? Number(field('after')[0] ?? 0) : 0;
      // Without a labels: argument (the conflicts query), every open one.
      const labelled = (i) => !/labels:/.test(args[1]) || i.labels.some((l) => wanted.includes(l));
      const all = s.items.filter((i) => i.kind === kind && i.state === 'OPEN' && labelled(i));
      const nodes = all.slice(start, start + first).map(node);
      return { pageInfo: { hasNextPage: start + nodes.length < all.length, endCursor: String(start + nodes.length) }, nodes };
    };
    out = JSON.stringify({ data: { repository: { issues: connection('issues', 'issue'), pullRequests: connection('pullRequests', 'pr') } } });
  } else if (pos[0] === 'api' && pos[1] === 'user') {
    out = s.login;
  } else if (pos[0] === 'api' && apiPath(/^repos\/[^/]+\/[^/]+\/issues\/(\d+)\/labels(?:\/(.+))?$/)) {
    const i = item(m[1]);
    if (opt.method === 'POST') {
      for (const l of field('labels[]')) if (!i.labels.includes(l)) { i.labels.push(l); i.labelEvents.push({ label: l, actor: s.login, at: now() }); }
    } else if (opt.method === 'DELETE') {
      const l = decodeURIComponent(m[2]);
      if (s.removeLabelError) die(s.removeLabelError); // GitHub refuses, not with a 404
      if (!i.labels.includes(l)) die('gh: Label does not exist (HTTP 404)');
      i.labels = i.labels.filter((x) => x !== l);
    } else unsupported();
  } else if (pos[0] === 'api' && opt.method === 'POST' && apiPath(/^repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/)) {
    item(m[1]).comments.push({ author: s.login, body: stdin(), at: now() });
  } else if (pos[0] === 'api' && opt.method === 'PATCH' && apiPath(/^repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/)) {
    item(m[1]).body = stdin();
  } else if (pos[0] === 'api' && !opt.method && opt.jq === '.state' && apiPath(/^repos\/[^/]+\/[^/]+\/issues\/(\d+)$/)) {
    out = item(m[1]).state === 'OPEN' ? 'open' : 'closed';
  } else if (pos[0] === 'api' && /^repos\/[^/]+\/[^/]+\/labels$/.test(pos[1]) && opt.jq === '.[].name' && !opt.method) {
    out = (s.repoLabels ?? []).join('\n');
  } else if (pos[0] === 'api' && opt.method === 'POST' && /^repos\/[^/]+\/[^/]+\/labels$/.test(pos[1])) {
    s.repoLabels = [...(s.repoLabels ?? []), field('name')[0]];
    s.labelStyles ??= {};
    s.labelStyles[field('name')[0]] = { color: field('color')[0], description: field('description')[0] };
  } else if (pos[0] === 'api' && !opt.method && opt.paginate && opt.jq === PULLS_JQ && /^repos\/[^/]+\/[^/]+\/pulls\?state=all&per_page=100$/.test(pos[1])) {
    out = s.items.filter((i) => i.kind === 'pr').map((i) => JSON.stringify({ number: i.number, ref: i.headRefName, repo: i.headRepo ?? null,
      state: i.state === 'OPEN' ? 'open' : 'closed', merged: i.state === 'MERGED', at: i.createdAt ?? now(),
      mergedAt: i.state === 'MERGED' ? (i.mergedAt ?? now()) : null, title: i.title, body: i.body ?? null })).join('\n');
  } else if (pos[0] === 'api' && !opt.method && opt.paginate && opt.jq === COMMENTS_JQ && /^repos\/[^/]+\/[^/]+\/issues\/comments\?per_page=100$/.test(pos[1])) {
    // Review comments (with a path) live elsewhere on GitHub, so this list leaves them out.
    out = s.items.flatMap((i) => i.comments.filter((c) => !c.path).map((c) => JSON.stringify({ author: c.author, body: c.body, at: c.at, on: i.number }))).join('\n');
  } else if (pos[0] === 'api' && !opt.method && opt.paginate && opt.jq === OPEN_ISSUES_JQ && /^repos\/[^/]+\/[^/]+\/issues\?state=open&per_page=100$/.test(pos[1])) {
    out = s.items.filter((i) => i.kind === 'issue' && i.state === 'OPEN').map((i) => i.number).join('\n');
  } else if (pos[0] === 'pr' && pos[1] === 'list') {
    const keys = opt.json.split(',');
    const prs = s.items.filter((i) => i.kind === 'pr' && i.headRefName === opt.head && (opt.state === 'all' || i.state === 'OPEN'));
    out = JSON.stringify(prs.map((i) => Object.fromEntries(keys.map((k) => [k, k === 'url' ? url(i.headRepo, i.number) : i[k]]))));
  } else if (pos[0] === 'pr' && pos[1] === 'create') {
    const n = s.nextNumber++;
    s.items.push({ number: n, kind: 'pr', title: opt.title, body: stdin(), author: s.login, state: 'OPEN', labels: [], labelEvents: [],
      comments: [], headRefName: opt.head, headRepo: opt.repo, baseRefName: opt.base, isDraft: !!opt.draft });
    out = url(opt.repo, n);
  } else if (pos[0] === 'pr' && pos[1] === 'view' && opt.json === 'additions,deletions') {
    const i = item(pos[2]);
    out = JSON.stringify({ additions: i.additions ?? 0, deletions: i.deletions ?? 0 });
  } else if (pos[0] === 'pr' && pos[1] === 'view' && opt.json === 'body') {
    out = JSON.stringify({ body: item(pos[2]).body });
  } else if (pos[0] === 'pr' && pos[1] === 'merge' && opt.squash && opt.auto) {
    const i = item(pos[2]);
    if (s.autoMergeAllowed === false) die('GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)');
    i.autoMerge = 'squash';
  } else if (pos[0] === 'pr' && pos[1] === 'ready') {
    item(pos[2]).isDraft = !!opt.undo;
  } else unsupported();

  writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 1));
  renameSync(`${file}.tmp`, file); // readers never see a half-written file
} finally { rmSync(lockFile, { force: true }); }
if (delay) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
if (out) process.stdout.write(`${out}\n`);
process.exit(code);
