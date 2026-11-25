// Decides whether the factory may act on an item. Pure: no I/O.
import { issueOfBranch } from './names.mjs';

const same = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();

const STAGE_ORDER = ['merge', 'review', 'implement', 'explore'];
const skip = (reason) => ({ action: 'skip', reason });

// The issues an issue waits for: one "- #n" per line under "## Depends on", up to the next heading.
export function dependsOn(body) {
  const lines = String(body ?? '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+depends on\s*$/i.test(l.trim()));
  if (start < 0) return [];
  const numbers = [];
  for (const l of lines.slice(start + 1)) {
    if (/^#/.test(l.trim())) break;
    const m = /^[-*]\s+#(\d+)$/.exec(l.trim());
    if (m && !numbers.includes(Number(m[1]))) numbers.push(Number(m[1]));
  }
  return numbers;
}

// openIssues: the numbers of the repo's open issues. Without them (the lookup failed) every dependency counts as open.
export function classify(item, cfg, openIssues = null) {
  const states = Object.values(cfg.states);
  if (item.labels.some((l) => states.includes(l))) return skip('has a state label');

  const stage = STAGE_ORDER.find((s) => item.labels.includes(cfg.triggers[s]));
  if (!stage) return skip('no trigger label');
  const trigger = cfg.triggers[stage];

  if (stage === 'review' || stage === 'merge') {
    if (item.kind !== 'pr') return skip(`${trigger} only applies to pull requests`);
    if (!same(item.headRepo, cfg.repo) || issueOfBranch(item.headRef) === null)
      return skip('not a factory pull request');
  } else if (item.kind !== 'issue') {
    return skip(`${trigger} only applies to issues`);
  }

  const events = item.labelEvents.filter((e) => e.label === trigger);
  if (!events.length) return skip('no record of who applied the label');
  const latest = events.reduce((a, b) => (Date.parse(b.at) >= Date.parse(a.at) ? b : a));
  if (!same(latest.actor, cfg.owner)) return skip('label was not applied by the owner');

  if (item.kind === 'issue' && !same(item.author, cfg.owner) && item.bodyEditedAt &&
      Date.parse(item.bodyEditedAt) >= Date.parse(latest.at)) // same second: may be after; park
    return { action: 'park', reason: 'issue text was edited after it was approved' };
  // The title goes into every prompt too, and the rename names who did it.
  if (item.kind === 'issue' && (item.renames ?? []).some((r) => !same(r.actor, cfg.owner) && Date.parse(r.at) >= Date.parse(latest.at)))
    return { action: 'park', reason: 'issue title was changed after it was approved' };

  if (item.kind === 'issue') {
    const open = openIssues ? new Set(openIssues) : null;
    const waitsFor = dependsOn(item.body).filter((n) => n !== item.number && (!open || open.has(n)));
    if (waitsFor.length) return { ...skip(`waits for ${waitsFor.map((n) => `#${n}`).join(', ')}`), waitsFor };
  }

  return { action: 'run', stage };
}

// What an agent is allowed to see of an item: title, body, and the owner's own comments.
export function promptInput(item, cfg, sinceIso = null) {
  const since = sinceIso ? Date.parse(sinceIso) : -Infinity;
  return {
    title: item.title,
    body: item.body,
    comments: item.comments
      // gh posts the factory's own comments as the owner; they start with 🏭 and are not requests.
      .filter((c) => same(c.author, cfg.owner) && !c.body.startsWith('🏭') && Date.parse(c.at) > since)
      .map((c) => c.body),
  };
}
