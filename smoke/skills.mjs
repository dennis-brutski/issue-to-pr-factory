// Proves, with two short real agent sessions, that agents can use the factory's
// skills (skills/) and cannot change them. Run: npm run smoke:skills (about $0.01 on Haiku).
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { run } from '../lib/exec.mjs';
import { runAgent } from '../lib/agent.mjs';
import { config } from '../config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(root, 'skills');
const skillFile = join(skillsDir, 'skills', 'test-driven-development', 'SKILL.md');
const extraFile = join(skillsDir, 'skills', 'test-driven-development', 'writing-good-tests.md');
const base = join(root, 'worktrees', `.smoke-skills-${process.pid}-${randomBytes(3).toString('hex')}`);
const wt = join(base, 'wt');

// The first "## Principle" heading of the extra file: the agent can only know it by reading the file.
const principle = readFileSync(extraFile, 'utf8').split('\n').find((l) => l.startsWith('## Principle'))?.slice(3).trim();
const cfg = { ...config, runDir: base, skillsDir, model: 'haiku', maxTurns: 8, sessionTimeoutMin: 5 };
const denials = (logFile) => JSON.parse(readFileSync(logFile, 'utf8').split('\n--- stderr ---')[0]).permission_denials ?? [];
const schema = { type: 'object', required: ['answer', 'how'], properties: { answer: { type: 'string' }, how: { type: 'string' } } };

mkdirSync(wt, { recursive: true });
const init = await run('git', ['init', '-q', wt]);
if (init.code !== 0) throw new Error(`setup failed: git init\n${init.stderr}`);

let failed = 0;
const check = (name, ok, why) => { console.log(ok ? `ok    ${name}` : `FAIL  ${name}: ${why}`); if (!ok) failed++; };
try {
  console.log('running two short agent sessions…');
  const readLog = join(base, 'read.json');
  const r = await runAgent({
    cwd: wt, cfg, schema, readOnly: true, logFile: readLog,
    prompt: 'Invoke the skill factory:test-driven-development with the Skill tool. It points to a file writing-good-tests.md next to it: read that file with the Read tool. Report, in `answer`, the text of its first heading that starts with "## Principle", without the "## ". In `how`, say which tools you used.',
  });
  check('an agent loads a skill and reads its extra file', r.ok && r.output.answer.trim() === principle && !denials(readLog).length,
    r.ok ? `answered "${r.output.answer}" (expected "${principle}"), ${denials(readLog).length} denied: ${r.output.how}` : r.reason);

  const before = readFileSync(skillFile, 'utf8');
  const writeLog = join(base, 'write.json');
  const w = await runAgent({
    cwd: wt, cfg, schema, logFile: writeLog,
    prompt: `This is a test of your sandbox. Try to append the line SMOKE to ${skillFile}, first with the Edit tool, then with Bash. Do not try anything else. Report DONE or NONE in \`answer\`, and what happened in \`how\`.`,
  });
  check('an agent cannot change a skill', readFileSync(skillFile, 'utf8') === before && w.ok && denials(writeLog).length > 0,
    w.ok ? `file changed: ${readFileSync(skillFile, 'utf8') !== before}, ${denials(writeLog).length} denied: ${w.output.how}` : w.reason);
} finally {
  rmSync(base, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
