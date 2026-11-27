import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { run } from './exec.mjs';
import { targetEnv, gitIdentityEnv, pick } from './confine.mjs';
/** @import { Config } from './settings.mjs' */

// Settings for one agent session. File-tool rules are absolute (//path) and
// name the worktree itself: a project-relative rule would be resolved against
// wherever the settings come from, and widened the sandbox to the whole
// factory folder (found by smoke/containment.mjs).
// Reads stay in the target's own run folder (its clone, worktrees and logs), never
// the factory folder, which holds every target's. Without one, only the worktree.
// The factory's skills (cfg.skillsDir) are readable, never writable: they sit outside the
// worktree, so an agent cannot change its own instructions.
export function agentSettings(worktreeDir, cfg = {}) {
  const scope = `/${worktreeDir}/**`;
  const skills = cfg.skillsDir ? [cfg.skillsDir] : [];
  return {
    attribution: { commit: '', pr: '' },
    permissions: {
      allow: [`Read(${scope})`, `Edit(${scope})`, `Write(${scope})`, 'Glob', 'Grep', 'Bash', ...skills.map((d) => `Read(/${d}/**)`)],
      deny: ['Bash(git push*)', 'Bash(gh *)', 'WebFetch', 'WebSearch'],
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: [] },
      filesystem: { denyRead: ['~'], allowRead: [cfg.runDir ?? worktreeDir, ...(cfg.runtimeRead ?? []), ...(cfg.sandboxRead ?? []), ...skills] },
    },
  };
}

// ListAgents and ReportFindings: no stage uses them, and each tool's description costs tokens in every session.
const ALWAYS_DISALLOWED = ['AskUserQuestion', 'Agent', 'Monitor', 'ScheduleWakeup', 'WebFetch', 'WebSearch', 'ListAgents', 'ReportFindings'];
const WRITE_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

// The prompt goes in on stdin, so --disallowedTools (variadic) can stay last.
/**
 * The claude command line for one session.
 * @param {{ schema: object, settings: object, maxTurns: number, model: string | null, readOnly: boolean, pluginDir?: string, maxBudgetUsd?: number | null }} opts
 *   no pluginDir: no skills; no maxBudgetUsd (or 0): no budget cap
 * @returns {string[]}
 */
export function buildArgs({ schema, settings, maxTurns, model, readOnly, pluginDir, maxBudgetUsd }) {
  const args = [
    '-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema),
    '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
    '--settings', JSON.stringify(settings), '--setting-sources', 'project',
    '--max-turns', String(maxTurns), '--no-session-persistence',
    '--exclude-dynamic-system-prompt-sections', // worktree path and git status out of the system prompt, so sessions share its cache
  ];
  if (model) args.push('--model', model);
  if (pluginDir) args.push('--plugin-dir', pluginDir);
  if (maxBudgetUsd > 0) args.push('--max-budget-usd', String(maxBudgetUsd)); // Claude Code's own estimate
  args.push('--disallowedTools', [...(readOnly ? WRITE_TOOLS : []), ...ALWAYS_DISALLOWED].join(','));
  return args;
}

export function interpret({ code, stdout, stderr, timedOut }, timeoutMin) {
  const fail = (reason, sessionId = null) => ({ ok: false, output: null, reason, sessionId });
  if (timedOut) return fail(`timed out after ${timeoutMin} min`);
  let r;
  try { r = JSON.parse(stdout); } catch {
    return fail(`the agent session failed (exit ${code}): ${((stderr || '') + (stdout || '')).trim().slice(0, 2000)}`);
  }
  const sessionId = r.session_id ?? null;
  if (r.terminal_reason === 'budget_exhausted')
    return fail(`the agent session stopped: it spent its budget${typeof r.total_cost_usd === 'number' ? ` (≈ $${r.total_cost_usd.toFixed(2)})` : ''}`, sessionId);
  if (r.terminal_reason && r.terminal_reason !== 'completed')
    return fail(`the agent session stopped: ${r.terminal_reason}${r.result ? ` — ${String(r.result).slice(0, 2000)}` : ''}`, sessionId);
  if (r.is_error || code !== 0)
    return fail(`the agent session failed: ${String(r.result ?? stderr ?? '').slice(0, 2000)}`, sessionId);
  if (!r.structured_output || typeof r.structured_output !== 'object')
    return fail('the agent session ended without the required status report', sessionId);
  return { ok: true, output: r.structured_output, reason: '', sessionId };
}

// What a session sees of the factory's environment: no tokens, API keys or agent sockets,
// since its Bash commands could write them into a commit. claude signs in with the
// login in ~/.claude. A list of its own: confined checks get PASSED_ON in confine.mjs.
const AGENT_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TERM', 'TZ', 'SHELL', 'TMPDIR',
  'CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS'];

// session: the prompt's name (gate, implement, …); a type without its own limit in cfg.turns gets maxTurns.
/**
 * @param {{ cwd: string, prompt: string, schema: object, readOnly?: boolean, cfg: Config, port?: number, logFile?: string, env?: Record<string, string>, session?: string }} opts
 */
export async function runAgent({ cwd, prompt, schema, readOnly = false, cfg, port, logFile, env = {}, session }) {
  const maxTurns = cfg.turns?.[session] ?? cfg.maxTurns;
  const exec = await run('claude', buildArgs({ schema, settings: agentSettings(cwd, cfg), maxTurns, model: cfg.model, readOnly, pluginDir: cfg.skillsDir, maxBudgetUsd: cfg.maxBudgetUsd }), {
    cwd, input: prompt, timeoutMs: cfg.sessionTimeoutMin * 60_000, inheritEnv: false,
    env: {
      ...pick(process.env, AGENT_ENV),
      ...targetEnv(cfg, port),
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1', CLAUDE_CODE_DISABLE_CRON: '1',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', // agents get no memory instructions pointing into ~/.claude
      ...(await gitIdentityEnv()), // the agent cannot read ~/.gitconfig
      ...env,
    },
  });
  if (logFile) {
    mkdirSync(dirname(logFile), { recursive: true });
    writeFileSync(logFile, `${exec.stdout}\n--- stderr ---\n${exec.stderr}\n`);
  }
  return interpret(exec, cfg.sessionTimeoutMin);
}
