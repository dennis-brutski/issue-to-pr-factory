import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './exec.mjs';
import { targetEnv, gitIdentityEnv } from './confine.mjs';

const FACTORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Settings for one agent session. File-tool rules are absolute (//path) and
// name the worktree itself: a project-relative rule would be resolved against
// wherever the settings come from, and widened the sandbox to the whole
// factory folder (found by smoke/containment.mjs).
export function agentSettings(worktreeDir, cfg = {}) {
  const scope = `/${worktreeDir}/**`;
  return {
    attribution: { commit: '', pr: '' },
    permissions: {
      allow: [`Read(${scope})`, `Edit(${scope})`, `Write(${scope})`, 'Glob', 'Grep', 'Bash'],
      deny: ['Bash(git push*)', 'Bash(gh *)', 'WebFetch', 'WebSearch'],
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: [] },
      filesystem: { denyRead: ['~'], allowRead: [FACTORY_ROOT, ...(cfg.runtimeRead ?? []), ...(cfg.sandboxRead ?? [])] },
    },
  };
}

const ALWAYS_DISALLOWED = ['AskUserQuestion', 'Agent', 'Monitor', 'ScheduleWakeup', 'WebFetch', 'WebSearch'];
const WRITE_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

// The prompt goes in on stdin, so --disallowedTools (variadic) can stay last.
export function buildArgs({ schema, settings, maxTurns, model, readOnly }) {
  const args = [
    '-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema),
    '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
    '--settings', JSON.stringify(settings), '--setting-sources', 'project',
    '--max-turns', String(maxTurns), '--no-session-persistence',
  ];
  if (model) args.push('--model', model);
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
  if (r.terminal_reason && r.terminal_reason !== 'completed')
    return fail(`the agent session stopped: ${r.terminal_reason}${r.result ? ` — ${String(r.result).slice(0, 2000)}` : ''}`, sessionId);
  if (r.is_error || code !== 0)
    return fail(`the agent session failed: ${String(r.result ?? stderr ?? '').slice(0, 2000)}`, sessionId);
  if (!r.structured_output || typeof r.structured_output !== 'object')
    return fail('the agent session ended without the required status report', sessionId);
  return { ok: true, output: r.structured_output, reason: '', sessionId };
}

export async function runAgent({ cwd, prompt, schema, readOnly = false, cfg, port, logFile, env = {} }) {
  const exec = await run('claude', buildArgs({ schema, settings: agentSettings(cwd, cfg), maxTurns: cfg.maxTurns, model: cfg.model, readOnly }), {
    cwd, input: prompt, timeoutMs: cfg.sessionTimeoutMin * 60_000,
    env: {
      ...targetEnv(cfg, port),
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1', CLAUDE_CODE_DISABLE_CRON: '1',
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
