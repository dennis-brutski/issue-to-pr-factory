// How much of the Claude plan's 5-hour and weekly limits the account has used.
// This is the endpoint Claude Code's /usage reads. It isn't public and may change,
// so any problem gives null. The token never goes into a log or an error.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const percent = (w) => (w && typeof w.utilization === 'number' && Number.isFinite(w.utilization) ? Math.floor(w.utilization) : undefined);

// The endpoint's reply → { fiveHour, fiveHourResetsAt, week }, leaving out what is missing; null when neither window has a number.
export function parsePlan(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const p = {};
  const fiveHour = percent(body.five_hour), week = percent(body.seven_day);
  if (fiveHour !== undefined) {
    p.fiveHour = fiveHour;
    const at = Date.parse(body.five_hour.resets_at);
    if (Number.isFinite(at)) p.fiveHourResetsAt = at;
  }
  if (week !== undefined) p.week = week;
  return Object.keys(p).length ? p : null;
}

export async function planUsage({ configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), url = USAGE_URL, timeoutMs = 3000 } = {}) {
  try {
    const token = JSON.parse(readFileSync(join(configDir, '.credentials.json'), 'utf8'))?.claudeAiOauth?.accessToken;
    if (typeof token !== 'string' || !token) return null;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return parsePlan(await res.json());
  } catch { return null; }
}
