// A fake `claude -p` for behaviour tests. It follows a script (FAKE_CLAUDE_SCRIPT,
// { "<issue>": [step, …] }, consumed in order), logs every call (FAKE_CLAUDE_LOG,
// JSON lines) and answers like the real CLI's --output-format json.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { sessionOf } from './session.mjs';

const die = (msg) => { process.stderr.write(`fake claude: ${msg}\n`); process.exit(1); };
if (process.argv.includes('--version')) { process.stdout.write('fake 0.0.0\n'); process.exit(0); }

const prompt = readFileSync(0, 'utf8');
const cwd = process.cwd();
const { session, issue } = sessionOf(prompt, cwd);
if (!session) die(`unknown prompt: ${prompt.split('\n')[0]}`);

const scriptFile = process.env.FAKE_CLAUDE_SCRIPT, logFile = process.env.FAKE_CLAUDE_LOG;
if (!scriptFile || !logFile) die('FAKE_CLAUDE_SCRIPT and FAKE_CLAUDE_LOG must be set');
appendFileSync(logFile, `${JSON.stringify({ issue, session, cwd, prompt, args: process.argv.slice(2), hadNodeModules: existsSync(join(cwd, 'node_modules')), pid: process.pid, anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL ?? null })}\n`);

const script = JSON.parse(readFileSync(scriptFile, 'utf8'));
const step = (script[issue] ?? []).shift();
if (!step || step.session !== session) die(`expected ${step?.session ?? 'nothing'} for #${issue}, got ${session}`);
writeFileSync(scriptFile, JSON.stringify(script));

if (step.testConcerns) step.output = { ...step.output, test_concerns: step.testConcerns }; // what a review found in the test changes
if (step.testChanges) step.output = { ...step.output, test_changes: step.testChanges }; // existing tests a work session changed
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
for (const [path, content] of Object.entries(step.write ?? {})) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), content);
}
for (const path of step.remove ?? []) rmSync(join(cwd, path), { force: true });
if (step.commit) { git('add', '-A'); git('commit', '-q', '-m', step.commit); }
if (step.replaceHead) { // what a hostile session could do: show a commit without the change in place of the head
  const fake = git('commit-tree', 'HEAD~1^{tree}', '-p', 'HEAD~1', '-m', step.commit ?? 'fake');
  git('replace', 'HEAD', fake);
}
for (const [key, value] of Object.entries(step.gitConfig ?? {})) git('config', key, value); // what a hostile session could do
for (const args of step.git ?? []) git(...args); // likewise: any git command on the shared git data
if (step.placeholders) { // what a killed sandbox leaves behind
  const gitDir = resolve(cwd, git('rev-parse', '--git-common-dir'));
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  for (const f of [join(cwd, '.bashrc'), join(cwd, '.claude', 'settings.json'), join(gitDir, 'config.lock')]) { writeFileSync(f, ''); chmodSync(f, 0o444); }
}
if (step.hang) setTimeout(() => process.exit(0), 60_000); // bounded, so a failed test cannot leak it forever
else process.stdout.write(JSON.stringify({ type: 'result', is_error: false, session_id: 'fake', structured_output: step.output }));
