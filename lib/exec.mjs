import { spawn } from 'node:child_process';

// Live child processes, so the stop button can kill them.
export const children = new Set();

export function killGroup(child, signal = 'SIGKILL') {
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* already gone */ } }
}

// Runs a program. Never throws and never rejects: a non-zero exit, a missing
// program and a timeout are all reported in the result.
// inheritEnv: false gives the program exactly `env`, nothing of the factory's own environment.
/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string>, timeoutMs?: number, input?: string, inheritEnv?: boolean }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string, timedOut: boolean }>}
 */
export function run(cmd, args, { cwd, env, timeoutMs, input, inheritEnv = true } = {}) {
  return new Promise((resolve) => {
    let stdout = '', stderr = '', timedOut = false, timer, settled = false;
    const done = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      children.delete(child);
      resolve({ code, stdout, stderr, timedOut });
    };
    // detached: own process group, so a kill reaches grandchildren (npm → node → chromium).
    const child = spawn(cmd, args, {
      cwd, env: env ? (inheritEnv ? { ...process.env, ...env } : env) : process.env, detached: true,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    children.add(child);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { stderr += String(e.message); done(127); });
    child.on('close', (code) => done(code));
    if (input !== undefined) { child.stdin.on('error', () => {}); child.stdin.end(input); }
    if (timeoutMs) timer = setTimeout(() => { timedOut = true; killGroup(child); }, timeoutMs);
  });
}
