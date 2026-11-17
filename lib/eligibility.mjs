// Decides whether the factory may act on an item. Pure: no I/O.

const same = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();

const STAGE_ORDER = ['merge', 'review', 'implement', 'explore'];
const skip = (reason) => ({ action: 'skip', reason });

export function classify(item, cfg) {
  const states = Object.values(cfg.states);
  if (item.labels.some((l) => states.includes(l))) return skip('has a state label');

  const stage = STAGE_ORDER.find((s) => item.labels.includes(cfg.triggers[s]));
  if (!stage) return skip('no trigger label');
  const trigger = cfg.triggers[stage];

  if (stage === 'review' || stage === 'merge') {
    if (item.kind !== 'pr') return skip(`${trigger} only applies to pull requests`);
    if (!same(item.headRepo, cfg.repo) || !cfg.branchPattern.test(item.headRef || ''))
      return skip('not a factory pull request');
  } else if (item.kind !== 'issue') {
    return skip(`${trigger} only applies to issues`);
  }

  const events = item.labelEvents.filter((e) => e.label === trigger);
  if (!events.length) return skip('no record of who applied the label');
  const latest = events.reduce((a, b) => (Date.parse(b.at) >= Date.parse(a.at) ? b : a));
  if (!same(latest.actor, cfg.owner)) return skip('label was not applied by the owner');

  if (item.kind === 'issue' && !same(item.author, cfg.owner) && item.bodyEditedAt &&
      Date.parse(item.bodyEditedAt) > Date.parse(latest.at))
    return { action: 'park', reason: 'issue text was edited after it was approved' };

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
