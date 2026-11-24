// What an agent session used, read from the log file lib/agent.mjs writes:
// the `claude -p --output-format json` result, then `--- stderr ---` and stderr. No I/O.
// Token counts there are separate: input_tokens does not include the cache counts.

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
const sum = (xs) => (xs.some((x) => x !== undefined) ? xs.reduce((a, x) => a + (x ?? 0), 0) : undefined);

// The log file's text → what the session used, or null when its stdout is not JSON (timed out, crashed).
export function usageOf(text) {
  let r;
  try { r = JSON.parse(String(text).split('\n--- stderr ---')[0]); } catch { return null; }
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const u = r.usage && typeof r.usage === 'object' ? r.usage : {};
  const read = num(u.cache_read_input_tokens);
  return {
    turns: num(r.num_turns),
    durationMs: num(r.duration_ms),
    costUsd: num(r.total_cost_usd),
    tokensIn: sum([num(u.input_tokens), num(u.cache_creation_input_tokens), read]),
    cachedIn: read,
    tokensOut: num(u.output_tokens),
    models: r.modelUsage && typeof r.modelUsage === 'object' ? Object.keys(r.modelUsage) : [],
    denials: Array.isArray(r.permission_denials) ? r.permission_denials.length : 0,
    reason: typeof r.terminal_reason === 'string' ? r.terminal_reason : undefined,
  };
}

// Several sessions together. A field missing in all of them stays missing.
export function addUp(list) {
  const us = list.filter(Boolean);
  const field = (k) => sum(us.map((u) => num(u[k])));
  return {
    turns: field('turns'), durationMs: field('durationMs'), costUsd: field('costUsd'),
    tokensIn: field('tokensIn'), cachedIn: field('cachedIn'), tokensOut: field('tokensOut'),
    models: [...new Set(us.flatMap((u) => u.models ?? []))],
    denials: field('denials') ?? 0,
    reason: undefined,
  };
}

// 812, 1.5k, 18k, 1.3M
export function count(n) {
  const short = (x, unit) => `${x < 10 ? Math.round(x * 10) / 10 : Math.round(x)}${unit}`;
  if (n < 1000) return String(Math.round(n));
  if (Math.round(n / 1e3) < 1000) return short(n / 1e3, 'k');
  return short(n / 1e6, 'M');
}

// 45s, 4m12s, 1h03m
export function duration(ms) {
  const s = Math.round(ms / 1000), pad = (x) => String(x).padStart(2, '0');
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${pad(s % 60)}s`;
  return `${Math.floor(s / 3600)}h${pad(Math.floor((s % 3600) / 60))}m`;
}

// A local server may send 0 for every count (lemonade does while streaming): it gave none.
const noCounts = (u) => !u.tokensIn && !u.tokensOut;

// One line for the log, leaving out what is missing. The cost is Claude Code's estimate at list price, not a bill.
// On a local run it means nothing, so the line says "local" instead.
export function usageLine(u, { local = false } = {}) {
  if (!u) return '';
  const parts = [];
  if (u.turns !== undefined) parts.push(`${u.turns} ${u.turns === 1 ? 'turn' : 'turns'}`);
  if (u.durationMs !== undefined) parts.push(duration(u.durationMs));
  if (local && noCounts(u)) parts.push('local, no token counts');
  else {
    if (u.tokensIn !== undefined) parts.push(`${count(u.tokensIn)} in${u.tokensIn > 0 && u.cachedIn !== undefined ? ` (${Math.round((100 * u.cachedIn) / u.tokensIn)}% cached)` : ''}`);
    if (u.tokensOut !== undefined) parts.push(`${count(u.tokensOut)} out`);
    if (local) parts.push('local');
    else if (u.costUsd !== undefined) parts.push(`≈ $${u.costUsd.toFixed(2)}`);
  }
  if (u.denials > 0) parts.push(`${u.denials} denied`);
  return parts.join(' · ');
}

// What a local run used so far, for the pull request: its token counts, or that the server gave none.
export function localUse(u) {
  if (noCounts(u)) return 'local, no token counts';
  return [u.tokensIn !== undefined && `${count(u.tokensIn)} in`, u.tokensOut !== undefined && `${count(u.tokensOut)} out`, 'local'].filter(Boolean).join(' · ');
}

// The account's plan usage for the log: plan 5h 42% (resets 14:30) · week 18%, in local time.
// Leaves out what is missing; '' when there is nothing.
export function planLine(p) {
  if (!p) return '';
  const parts = [], pad = (x) => String(x).padStart(2, '0');
  if (p.fiveHour !== undefined) {
    const at = p.fiveHourResetsAt !== undefined ? new Date(p.fiveHourResetsAt) : null;
    parts.push(`5h ${p.fiveHour}%${at ? ` (resets ${pad(at.getHours())}:${pad(at.getMinutes())})` : ''}`);
  }
  if (p.week !== undefined) parts.push(`week ${p.week}%`);
  return parts.length ? `plan ${parts.join(' · ')}` : '';
}
