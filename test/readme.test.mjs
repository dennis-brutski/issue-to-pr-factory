import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.mjs';
import { execFileSync } from 'node:child_process';

const README = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md'), 'utf8');
const at = (text) => README.indexOf(text);
const mermaid = [...README.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
const firstScreen = README.slice(0, at('## Getting started'));

test('the README has a Getting started section', () => {
  assert.ok(at('## Getting started') > 0);
});

test('the first screen says what the factory is and who it is for', () => {
  assert.match(firstScreen, /software factory for a single maintainer/);
  assert.match(firstScreen, /no dependencies/);
  assert.match(firstScreen, /never pushes to/);
});

test('the first screen shows the batch loop as a diagram', () => {
  assert.match(firstScreen, /```mermaid/);
});

test('the trust model and the accepted risks come before Getting started', () => {
  assert.match(firstScreen, /Trust model/);
  assert.match(firstScreen, /Treat issue text as untrusted input/);
  assert.ok((firstScreen.match(/^- ⚠ /gm) ?? []).length >= 6, 'six risks, one line each with ⚠');
});

test('two Mermaid diagrams, coloured, without HTML in them', () => {
  assert.equal(mermaid.length, 2);
  for (const d of mermaid) {
    assert.match(d, /^(flowchart|stateDiagram-v2)\b/);
    assert.match(d, /classDef/);
    assert.doesNotMatch(d, /<[a-z/]/i, 'no HTML inside a diagram');
  }
});

test('every screenshot slot has alt text and points into docs/img/', () => {
  for (const name of ['terminal-run', 'stats'])
    assert.match(README, new RegExp(`!\\[[^\\]]+\\]\\(docs/img/${name}\\.png\\)`), name);
});

test('every config key a user changes is named in a table row', () => {
  for (const key of ['maxParallel', 'confidenceThreshold', 'maxTurns', 'sessionTimeoutMin', 'checkTimeoutMin', 'model',
    'gateModel', 'simpleModel', 'pollSec', 'autoMerge', 'maxBudgetUsd', 'turns'])
    assert.match(README, new RegExp(`^\\| \`${key}\``, 'm'), key);
});

test('the config table gives the defaults config.mjs has', () => {
  for (const key of ['maxParallel', 'confidenceThreshold', 'maxTurns', 'sessionTimeoutMin', 'checkTimeoutMin', 'pollSec'])
    assert.match(README, new RegExp(`^\\| \`${key}\` \\| ${config[key]} \\|`, 'm'), key);
  for (const key of ['model', 'gateModel', 'simpleModel'])
    assert.match(README, new RegExp(`^\\| \`${key}\` \\| \`${config[key]}\` \\|`, 'm'), key);
});

test('runtimeRead is in the Targets table', () => {
  assert.match(README, /^\| `runtimeRead` /m);
});

test('the factory\'s own tests are under Testing the factory', () => {
  assert.match(README, /^## Testing the factory$/m);
  assert.doesNotMatch(README, /^## Checks$/m);
});

test('project history is gone, with a pointer to the design notes', () => {
  assert.doesNotMatch(README, /^Design and plan:/m);
  assert.match(README, /^## History$/m);
  assert.match(README, /docs\/superpowers\//);
});

test('smoke runs say they use a real agent session', () => {
  assert.doesNotMatch(README, /uses? Claude usage/);
  assert.match(README, /runs one real agent session \(uses your Claude plan\)/);
});

test("the README's local row names a server known to work and what a local run shows", () => {
  const row = README.split('\n').find((l) => l.startsWith('| `local` —'));
  assert.match(row, /lemonade/);
  assert.match(row, /Qwen3-Coder-30B-A3B-Instruct-GGUF/);
  assert.match(row, /local, no token counts/);
});

describe('day-to-day', () => {
  const README = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md'), 'utf8');
  const gettingStarted = README.slice(README.indexOf('\n## Getting started\n'), README.indexOf('\n## Use\n'));

  test('Getting started keeps the day-to-day advice', () => {
    assert.match(gettingStarted, /Day to day:/);
    assert.match(gettingStarted, /as clearly as for a colleague/);
    assert.match(gettingStarted, /`agent:explore` when unsure/);
    assert.match(gettingStarted, /pull request \(`agent:done`\) or a stop \(`agent:needs-human`/);
  });
});

describe('diagram direction', () => {
  const README = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md'), 'utf8');
  const mermaid = [...README.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);

  test('the first diagram runs top-down so GitHub\'s zoom buttons sit over empty space', () => {
    assert.match(mermaid[0], /^flowchart TD\n/);
  });
});

describe('factory inbox', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const SKILL = readFileSync(join(ROOT, 'factory-inbox', 'SKILL.md'), 'utf8');
  const headings = [...README.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  const section = (heading) => {
    const start = README.indexOf(`\n## ${heading}\n`);
    assert.ok(start >= 0, heading);
    const end = README.indexOf('\n## ', start + 1);
    return README.slice(start, end < 0 ? undefined : end);
  };

  test('the Factory inbox section comes right after Statistics', () => {
    assert.equal(headings[headings.indexOf('Statistics') + 1], 'Factory inbox');
  });

  test('Factory inbox says where the skill and its settings live', () => {
    const inbox = section('Factory inbox');
    assert.match(inbox, /~\/\.claude\/skills\/factory-inbox\/SKILL\.md/);
    assert.match(inbox, /~\/\.claude\/skills\/factory-inbox\/config\.json/);
    for (const key of ['owner', 'factoryDir', 'notebookId']) assert.match(inbox, new RegExp(`\`${key}\``), key);
    assert.match(inbox, /`null` skips it/);
    assert.match(inbox, /ships with this repo in `factory-inbox\/`/);
    assert.doesNotMatch(inbox, /not shipped/);
  });

  test('Factory inbox says how to install the shipped skill', () => {
    const inbox = section('Factory inbox');
    assert.match(inbox, /ln -s "\$PWD\/factory-inbox" ~\/\.claude\/skills\/factory-inbox/);
    assert.match(inbox, /`factory-inbox\/config\.example\.json`/);
  });

  test('the repo ships the skill with its frontmatter and start phrases', () => {
    const front = SKILL.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(front, 'frontmatter');
    assert.match(front[1], /^name: factory-inbox$/m);
    for (const words of ['factory inbox', 'answer the factory', 'what is the factory waiting for', '/factory-inbox'])
      assert.ok(front[1].includes(words), words);
  });

  test('the shipped skill finds stops with inbox.mjs and acts only on approve', () => {
    assert.ok(SKILL.includes('node <factoryDir>/inbox.mjs'));
    assert.match(SKILL, /oldest first/);
    assert.match(SKILL, /approve \/ edit \/ skip/);
    assert.match(SKILL, /never starts? with 🏭/);
  });

  test('the shipped skill lists only the current target when currentTargetOnly is true', () => {
    assert.ok(SKILL.includes('node <factoryDir>/inbox.mjs --current'));
    assert.match(SKILL, /`currentTargetOnly`/);
    assert.match(SKILL, /Missing means `false`/);
    assert.doesNotMatch(SKILL, /gh search|gh issue view/);
  });

  test('the skill ships an example config and keeps the real one out of git', () => {
    const example = JSON.parse(readFileSync(join(ROOT, 'factory-inbox', 'config.example.json'), 'utf8'));
    assert.deepEqual(Object.keys(example).sort(), ['currentTargetOnly', 'factoryDir', 'notebookId', 'owner']);
    assert.equal(example.notebookId, null);
    assert.equal(example.currentTargetOnly, false);
    const ignored = execFileSync('git', ['check-ignore', 'factory-inbox/config.json'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(ignored.trim(), 'factory-inbox/config.json');
  });

  test('Files lists the factory-inbox folder', () => {
    assert.match(section('Files'), /^- `factory-inbox\/` — /m);
  });

  test('Factory inbox says how it finds the stops', () => {
    assert.match(section('Factory inbox'), /`node inbox\.mjs \[<target> \| --current\]`/);
    assert.match(section('Factory inbox'), /oldest first/);
  });

  test('Factory inbox says nothing happens until you approve an item', () => {
    const inbox = section('Factory inbox');
    assert.match(inbox, /proposed reply, hand fix or relabel/);
    assert.match(inbox, /approve \/ edit \/ skip/);
  });

  test('Factory inbox shows how to start it', () => {
    const inbox = section('Factory inbox');
    assert.match(inbox, /`\/factory-inbox`/);
    for (const words of ['factory inbox', 'answer the factory', 'what is the factory waiting for'])
      assert.ok(inbox.includes(`"${words}"`), words);
  });

  test('Factory inbox says currentTargetOnly works for both skills', () => {
    assert.match(section('Factory inbox'), /`currentTargetOnly: true` makes `\/factory-inbox` and `\/factory-approve-issues` work only on the target/);
  });
});

describe('screenshots and sentence length', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const README = readFileSync(join(root, 'README.md'), 'utf8');
  const section = (heading) => {
    const start = README.indexOf(`\n## ${heading}\n`);
    assert.ok(start >= 0, heading);
    const end = README.indexOf('\n## ', start + 1);
    return README.slice(start, end < 0 ? undefined : end);
  };

  test('the three GitHub screenshots are gone from the README and docs/img/', () => {
    for (const name of ['pull-request', 'stop-comment', 'explore-writeup']) {
      assert.doesNotMatch(README, new RegExp(`docs/img/${name}\\.png`), name);
      assert.equal(existsSync(join(root, 'docs', 'img', `${name}.png`)), false, name);
    }
    for (const name of ['terminal-run', 'stats'])
      assert.ok(existsSync(join(root, 'docs', 'img', `${name}.png`)), name);
  });

  test('Getting started says in one sentence what setup and checks may reach', () => {
    const start = section('Getting started');
    assert.doesNotMatch(start, /score pad's target/);
    assert.match(start, /^ {3}Setup has network, checks have none[^.\n]*--ignore-scripts[^.\n]*\.$/m);
  });

  test('Use keeps the target choice and the lock in one sentence', () => {
    const use = section('Use');
    const line = use.split('\n').find((l) => l.includes('factory.lock'));
    assert.ok(line, 'lock line');
    assert.match(line, /choose a target/);
    assert.match(line, /already running/);
    assert.equal((use.match(/^- /gm) ?? []).length, 3);
  });

  test('Testing the factory leaves the sandbox note to AGENTS.md', () => {
    assert.doesNotMatch(section('Testing the factory'), /inside an agent sandbox \(no nested bwrap/);
  });

  test('Use says the target choice and the lock in one short sentence', () => {
    const line = section('Use').split('\n').find((l) => l.includes('factory.lock'));
    assert.ok(line, 'lock line');
    for (const part of ['choose a target', 'already running (pid <n>)', 'runs/<target>/factory.lock', 'died'])
      assert.ok(line.includes(part), part);
    assert.equal((line.match(/[.!?](\s|$)/g) ?? []).length, 1, line);
    assert.ok(line.length <= 200, `${line.length} characters`);
  });

  test('the Polling, Conflicts, Worktree, Setup and Port bullets are one line each', () => {
    const run = section('How a run works').split('\n');
    for (const name of ['Polling:', 'Conflicts:', 'Worktree:', 'Setup**', 'Port:']) {
      const at = run.findIndex((l) => l.startsWith(`- **${name}`));
      assert.ok(at >= 0, name);
      assert.match(run[at + 1], /^- \*\*/, `${name} is followed by the next bullet`);
    }
    const polling = run.find((l) => l.startsWith('- **Polling:'));
    assert.match(polling, /`pollSec`/);
    assert.match(polling, /`maxParallel`/);
  });

  test('the Git itself bullet has two sentences and keeps what it guards', () => {
    const line = section('Confinement and brakes').split('\n').find((l) => l.includes('**Git itself:**'));
    assert.ok(line, 'Git itself line');
    assert.equal((line.match(/[.!?](\s|$)/g) ?? []).length, 2, line);
    for (const part of ['.git/config', '`origin`', 'replace refs and grafts'])
      assert.ok(line.includes(part), part);
  });
});

describe('length', () => {
  const README = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md'), 'utf8');
  const section = (heading) => {
    const start = README.indexOf(`\n## ${heading}\n`);
    assert.ok(start >= 0, heading);
    const end = README.indexOf('\n## ', start + 1);
    return README.slice(start, end < 0 ? undefined : end);
  };
  const count = (text, re) => (text.match(re) ?? []).length;

  test('the README is at most 300 lines', () => {
    const lines = README.split('\n').length - (README.endsWith('\n') ? 1 : 0);
    assert.ok(lines <= 300, `${lines} lines`);
  });

  test('the terminal screenshot has no text stand-in any more', () => {
    assert.doesNotMatch(README, /Until the screenshot is there/);
    assert.doesNotMatch(README, /```text/);
  });

  test('the gate is explained only under How a run works', () => {
    assert.equal(count(README, /scores how clear the issue is/g), 0);
    assert.equal(count(README, /from 0 to 100/g), 1);
    assert.match(section('How a run works'), /from 0 to 100/);
  });

  test('the auto-merge rules are written out only under How a run works', () => {
    assert.equal(count(README, /gh pr merge --squash --auto/g), 1);
    assert.match(section('How a run works'), /gh pr merge --squash --auto/);
    assert.doesNotMatch(README.slice(0, README.indexOf('## A day with the factory')), /small, simple, cleanly reviewed/);
  });

  test('the brakes are listed only under Confinement and brakes', () => {
    assert.doesNotMatch(section('How a run works'), /Changed workflow files stop the push/);
    assert.match(section('How a run works'), /\*\*Brakes:\*\*.*Confinement and brakes/);
    const brakes = section('Confinement and brakes');
    for (const part of ['attribution lines', 'Co-Authored-By', 'testSupport', '.only', 'draft', 'git ls-remote'])
      assert.ok(brakes.includes(part), part);
  });

  test('the label state diagram and the two stopping words are gone', () => {
    assert.doesNotMatch(README, /stateDiagram-v2/);
    assert.doesNotMatch(README, /Two words for two kinds of stopping/);
    assert.doesNotMatch(section('Use'), /A day with the factory/);
  });

  test('Statistics says what it prints in a few sentences', () => {
    const stats = section('Statistics');
    assert.match(stats, /only reads from GitHub/);
    assert.match(stats, /`other:`/);
    assert.doesNotMatch(stats, /Revert "<title>"/);
  });
});

describe('plain words and real links', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const section = (heading) => {
    const start = README.indexOf(`\n## ${heading}\n`);
    assert.ok(start >= 0, heading);
    const end = README.indexOf('\n## ', start + 1);
    return README.slice(start, end < 0 ? undefined : end);
  };

  test('the README says "stop", and "parked:" only once, under When it stops', () => {
    const parks = [...README.matchAll(/\bpark\w*:?/gi)].map((m) => m[0]);
    assert.deepEqual(parks, ['parked:']);
    assert.match(section('When it stops (`agent:needs-human`)'), /⏸ `parked:`/);
  });

  test('every relative Markdown link points to a file or folder in the repo', () => {
    const links = [...README.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1])
      .filter((href) => !/^([a-z]+:|#)/i.test(href))
      .map((href) => href.split('#')[0]);
    for (const href of links) assert.ok(existsSync(join(ROOT, href)), href);
    for (const path of ['SECURITY.md', '.github/ISSUE_TEMPLATE/agent-task.md', 'LICENSE', 'docs/superpowers/', 'docs/releasing.md'])
      assert.ok(README.includes(`[\`${path}\`](${path})`), path);
  });

  test('the first screen says there is nothing to npm install and has no marketing sentence', () => {
    const firstScreen = README.slice(0, README.indexOf('## Getting started'));
    assert.match(firstScreen, /nothing to `npm install`/);
    assert.doesNotMatch(firstScreen, /strategic work/);
  });
});

test('the targets table documents testFiles and its default', () => {
  assert.equal(config.testFiles, null);
  assert.match(README, /^\| `testFiles` — .*Default `null`: off\..*`\[\['node', \['--test', '\{files\}'\]\]\]` \|$/m);
});

describe('easy to scan', () => {
  const README = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md'), 'utf8');
  const section = (heading) => {
    const start = README.indexOf(`\n## ${heading}\n`);
    assert.ok(start >= 0, heading);
    const end = README.indexOf('\n## ', start + 1);
    return README.slice(start, end < 0 ? undefined : end);
  };

  test('the Auto-merge bullet is followed by exactly six indented conditions', () => {
    const run = section('How a run works').split('\n');
    const at = run.findIndex((l) => l.startsWith('- **Auto-merge:**'));
    assert.ok(at >= 0, 'Auto-merge bullet');
    let n = 0;
    while (run[at + 1 + n]?.startsWith('  - ')) n++;
    assert.equal(n, 6);
    assert.doesNotMatch(run[at + 1 + n], /^\s*- /, 'no seventh condition');
  });

  test('the target example says setup has network and checks have none', () => {
    const lines = section('Getting started').split('\n');
    const setup = lines.find((l) => /^\s+setup: /.test(l));
    const checks = lines.find((l) => /^\s+checks: /.test(l));
    assert.ok(setup && checks, 'setup and checks lines');
    assert.match(setup, /\/\/ with network\b[^\n]*$/);
    assert.match(checks, /\/\/ without network\b[^\n]*$/);
  });

  test('Factory inbox has numbered install steps 1, 2 and 3', () => {
    const inbox = section('Factory inbox');
    for (const n of [1, 2, 3]) assert.match(inbox, new RegExp(`^${n}\\. `, 'm'), `${n}.`);
  });
});
