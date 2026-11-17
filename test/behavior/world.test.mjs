import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../lib/exec.mjs';
import { runAgent } from '../../lib/agent.mjs';
import { config } from '../../config.mjs';
import { world, FAKES_BIN, FAKE_BWRAP_BIN } from './world.mjs';

const ok = (summary) => ({ status: 'complete', summary, detail: '' });
const schema = { type: 'object' };

async function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'fake-claude-'));
  await run('git', ['init', '-q', '-b', 'master', dir]);
  await run('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init']);
  const script = join(dir, '..', `${Date.now()}-script.json`), log = join(dir, '..', `${Date.now()}-log.jsonl`);
  return { dir, script, log };
}
function useFakeClaude({ script, log }, steps) {
  writeFileSync(script, JSON.stringify(steps));
  writeFileSync(log, '');
  process.env.FAKE_CLAUDE_SCRIPT = script;
  process.env.FAKE_CLAUDE_LOG = log;
  if (!process.env.PATH.startsWith(FAKES_BIN)) process.env.PATH = `${FAKES_BIN}:${process.env.PATH}`;
}
const cfg = { ...config, maxTurns: 1, sessionTimeoutMin: 1 };

test('the fake claude follows its script and logs the call', async () => {
  const r0 = await scratchRepo();
  useFakeClaude(r0, { 3: [{ session: 'implement', write: { 'x.txt': 'x' }, commit: 'Add x', output: ok('s') }] });
  const r = await runAgent({ cwd: r0.dir, prompt: '# Implement issue #3\n\nDo it.', schema, cfg });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.output.status, 'complete');
  assert.equal((await run('git', ['-C', r0.dir, 'log', '-1', '--format=%s'])).stdout.trim(), 'Add x');
  const calls = readFileSync(r0.log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(calls.map((c) => [c.issue, c.session]), [[3, 'implement']]);
});
test('a session out of script order fails', async () => {
  const r0 = await scratchRepo();
  useFakeClaude(r0, { 3: [{ session: 'implement', output: ok('s') }] });
  const r = await runAgent({ cwd: r0.dir, prompt: '# Can issue #3 be built as written?', schema, cfg });
  assert.equal(r.ok, false);
  assert.match(r.reason, /expected implement/);
});
test('the factory starts in a world and reports 0 eligible', async () => {
  const w = await world();
  try {
    const f = w.start();
    await w.until(() => f.output().includes('0 eligible'), 20000, '0 eligible');
    f.signal('SIGINT');
    assert.equal(await f.exited, 0);
    assert.match(f.output(), /stopped/);
  } finally { w.close(); }
});

test('the stand-in bwrap runs the command in --chdir with only the --setenv variables', async () => {
  const bwrap = join(FAKE_BWRAP_BIN, 'bwrap'), dir = mkdtempSync(join(tmpdir(), 'fake-bwrap-'));
  process.env.FACTORY_SENTINEL_SECRET = 'leak';
  try {
    const r = await run(bwrap, ['--ro-bind', '/', '/', '--clearenv', '--setenv', 'A', 'x', '--setenv', 'PATH', process.env.PATH,
      '--chdir', dir, '--', 'sh', '-c', 'echo "$A $(pwd) $FACTORY_SENTINEL_SECRET"']);
    assert.equal(r.stdout, `x ${dir} \n`);
  } finally { delete process.env.FACTORY_SENTINEL_SECRET; }
  assert.equal((await run(bwrap, ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-net', 'true'])).code, 0, 'passes the sandbox probe');
  assert.equal((await run(bwrap, ['--', 'sh', '-c', 'exit 3'])).code, 3, 'keeps the exit code');
});
