import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './exec.mjs';

const FACTORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Settings for one agent session. File-tool rules are absolute (//path) and
// name the worktree itself: a project-relative rule would be resolved against
// wherever the settings come from, and widened the sandbox to the whole
// factory folder (found by smoke/containment.mjs).
export function agentSettings(worktreeDir) {
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
      filesystem: { denyRead: ['~'], allowRead: [FACTORY_ROOT, '~/.nvm', '~/.cache/ms-playwright'] },
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

let identity;
async function gitIdentity() {
  if (!identity) {
    const get = async (k) => (await run('git', ['config', '--global', k])).stdout.trim();
    identity = { name: await get('user.name'), email: await get('user.email') };
  }
  return identity;
}

export async function runAgent({ cwd, prompt, schema, readOnly = false, cfg, logFile, env = {} }) {
  const id = await gitIdentity();
  const exec = await run('claude', buildArgs({ schema, settings: agentSettings(cwd), maxTurns: cfg.maxTurns, model: cfg.model, readOnly }), {
    cwd, input: prompt, timeoutMs: cfg.sessionTimeoutMin * 60_000,
    env: {
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1', CLAUDE_CODE_DISABLE_CRON: '1', PW_CHROMIUM_NO_SANDBOX: '1',
      // The agent cannot read ~/.gitconfig, so its commits get their identity here.
      GIT_AUTHOR_NAME: id.name, GIT_AUTHOR_EMAIL: id.email, GIT_COMMITTER_NAME: id.name, GIT_COMMITTER_EMAIL: id.email,
      ...env,
    },
  });
  if (logFile) {
    mkdirSync(dirname(logFile), { recursive: true });
    writeFileSync(logFile, `${exec.stdout}\n--- stderr ---\n${exec.stderr}\n`);
  }
  return interpret(exec, cfg.sessionTimeoutMin);
}
