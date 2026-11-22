// A throwaway world for running the real factory: a local bare repo as origin,
// a fake GitHub (fakes/gh.mjs) and a fake Claude (fakes/claude.mjs) first on PATH.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, renameSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FAKES_BIN = join(HERE, 'fakes', 'bin');
export const FAKE_BWRAP_BIN = join(HERE, 'fakes', 'bwrap-bin');
// Inside an agent's own sandbox bwrap cannot start; the factory's check run, where it can, still uses the real one.
const bwrapWorks = (() => { try { execFileSync('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-net', 'true'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const BINS = bwrapWorks ? FAKES_BIN : `${FAKES_BIN}:${FAKE_BWRAP_BIN}`;
const FACTORY = join(HERE, '..', '..', 'factory.mjs');
const OWNER = 'dennis-brutski';
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid'];

const SEED = {
  'package.json': JSON.stringify({ name: 'demo', version: '1.0.0', private: true, type: 'module', scripts: {
    test: 'node --test', e2e: 'node -e ""',
    // npm ci runs this, so node_modules appearing proves setup ran (a project without dependencies gets none otherwise).
    prepare: "node -e \"require('fs').mkdirSync('node_modules', { recursive: true })\"",
  } }, null, 2) + '\n',
  'package-lock.json': JSON.stringify({ name: 'demo', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'demo', version: '1.0.0' } } }, null, 2) + '\n',
  '.gitignore': 'node_modules/\n',
  'src/a.js': 'export const a = 1;\n',
  'test/a.test.js': "import { test } from 'node:test';\ntest('a', () => {});\n",
};

export async function world({ seed = SEED, settings = {}, name = 'demo' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-world-'));
  const origin = join(dir, 'origin.git'), work = join(dir, 'seed');
  const ghState = join(dir, 'gh.json'), script = join(dir, 'claude-script.json'), log = join(dir, 'claude-log.jsonl');
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...ID, ...args], { encoding: 'utf8' }).trim();

  execFileSync('git', ['init', '-q', '--bare', '-b', 'master', origin]);
  execFileSync('git', ['init', '-q', '-b', 'master', work]);
  for (const [path, content] of Object.entries(seed)) { mkdirSync(dirname(join(work, path)), { recursive: true }); writeFileSync(join(work, path), content); }
  git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', 'init');
  git(work, 'remote', 'add', 'origin', origin); git(work, 'push', '-q', 'origin', 'master');

  writeFileSync(ghState, JSON.stringify({ login: OWNER, nextNumber: 1, items: [], calls: [] }));
  writeFileSync(script, '{}'); writeFileSync(log, '');
  const settingsFile = join(dir, `${name}.mjs`);
  const runDir = join(dir, 'run');
  writeFileSync(settingsFile, `export default ${JSON.stringify({ repo: `${OWNER}/${name}`, owner: OWNER, ownerName: 'Dennis', baseBranch: 'master', protectedFiles: ['package.json', 'package-lock.json'], testDirs: ['test/'], setup: [['npm', ['ci']]], checks: [['npm', ['test']]], setupWrite: ['{runDir}/npm-cache'], env: { npm_config_cache: '{runDir}/npm-cache', FAKE_CLAUDE_SCRIPT: script, FAKE_CLAUDE_LOG: log }, remoteUrl: origin, runDir, pollSec: 1, ...settings })};\n`);

  const readGh = () => JSON.parse(readFileSync(ghState, 'utf8'));
  // Same lock and atomic write as the fake gh, which may be writing at the same moment.
  const change = (fn) => {
    const lock = `${ghState}.lock`, end = Date.now() + 5000;
    for (;;) {
      try { closeSync(openSync(lock, 'wx')); break; } catch (e) {
        if (e.code !== 'EEXIST' || Date.now() > end) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    try {
      const s = readGh(); fn(s);
      writeFileSync(`${ghState}.tmp`, JSON.stringify(s, null, 1)); renameSync(`${ghState}.tmp`, ghState);
    } finally { rmSync(lock, { force: true }); }
  };
  const now = () => new Date().toISOString();
  const running = new Set(), outputs = [];

  const w = {
    dir, origin, runDir, settingsFile,
    issue({ title = 'Change a', body = 'Do it.', labels = [], by = OWNER, author = OWNER } = {}) {
      let n;
      change((s) => {
        n = s.nextNumber++;
        s.items.push({ number: n, kind: 'issue', title, body, author, state: 'OPEN', labels: [...labels],
          labelEvents: labels.map((label) => ({ label, actor: by, at: now() })), comments: [] });
      });
      return n;
    },
    label(n, label, by = OWNER) { change((s) => { const i = s.items.find((x) => x.number === n); i.labels.push(label); i.labelEvents.push({ label, actor: by, at: now() }); }); },
    rename(n, title, by = OWNER) { change((s) => { const i = s.items.find((x) => x.number === n); i.title = title; (i.renames ??= []).push({ actor: by, at: now() }); }); },
    unlabel(n, label) { change((s) => { const i = s.items.find((x) => x.number === n); i.labels = i.labels.filter((l) => l !== label); }); },
    comment(n, body, { by = OWNER, path } = {}) { change((s) => { s.items.find((x) => x.number === n).comments.push({ author: by, body, at: now(), ...(path ? { path } : {}) }); }); },
    slowLists(ms) { change((s) => { s.listDelayMs = ms; }); }, // the fake gh waits this long after each list call
    merge(n) { change((s) => { s.items.find((x) => x.number === n).state = 'MERGED'; }); },
    state: readGh,
    item: (n) => readGh().items.find((x) => x.number === n),
    pr: () => readGh().items.find((x) => x.kind === 'pr'),
    script(n, steps) {
      const s = JSON.parse(readFileSync(script, 'utf8'));
      s[n] = [...(s[n] ?? []), ...steps];
      writeFileSync(script, JSON.stringify(s));
    },
    claudeCalls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    branch(name) {
      try { execFileSync('git', ['--git-dir', origin, 'rev-parse', '--verify', '-q', name], { stdio: 'ignore' }); } catch { return null; }
      const lines = (args) => execFileSync('git', ['--git-dir', origin, ...args], { encoding: 'utf8' }).split('\n').filter(Boolean);
      return { subjects: lines(['log', '--format=%s', `master..${name}`]).reverse(), files: lines(['diff', '--name-only', `master...${name}`]) };
    },
    start(extraArgs = []) {
      // node --test marks its children with NODE_TEST_CONTEXT; a project's own `node --test`
      // inheriting it reports to us instead and exits 0 even when its tests fail.
      // node --test in a terminal sets FORCE_COLOR; the factory would then colour its piped
      // output and the tests, which match plain text, would fail.
      const { NODE_TEST_CONTEXT, FORCE_COLOR, ...env } = process.env;
      const proc = spawn(process.execPath, [FACTORY, settingsFile, ...extraArgs], {
        env: { ...env, PATH: `${BINS}:${env.PATH}`, FAKE_GH_STATE: ghState, FAKE_CLAUDE_SCRIPT: script, FAKE_CLAUDE_LOG: log,
          npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' },
        stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      });
      let out = '';
      proc.stdout.on('data', (d) => { out += d; });
      proc.stderr.on('data', (d) => { out += d; });
      running.add(proc);
      outputs.push(() => out);
      const exited = new Promise((resolve) => proc.on('exit', (code, sig) => { running.delete(proc); resolve(code ?? sig); }));
      return { proc, output: () => out, signal: (sig) => proc.kill(sig), exited };
    },
    async until(fn, ms = 20000, what = 'condition') {
      const end = Date.now() + ms;
      for (;;) {
        if (await fn()) return;
        if (Date.now() > end) throw new Error(`timed out waiting for ${what}\n--- factory output ---\n${outputs.map((o) => o()).join('\n---\n').slice(-3000)}`);
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    close() {
      for (const p of running) try { process.kill(-p.pid, 'SIGKILL'); } catch {}
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return w;
}
