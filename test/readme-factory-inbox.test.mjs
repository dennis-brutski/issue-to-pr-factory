import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('the shipped skill finds stops with gh search and acts only on approve', () => {
  assert.ok(SKILL.includes('gh search issues "label:agent:needs-human" --state open --owner <owner>'));
  assert.match(SKILL, /oldest first/);
  assert.match(SKILL, /approve \/ edit \/ skip/);
  assert.match(SKILL, /never starts? with 🏭/);
  assert.doesNotMatch(SKILL, /inbox\.mjs|npm run inbox/);
});

test('the skill ships an example config and keeps the real one out of git', () => {
  const example = JSON.parse(readFileSync(join(ROOT, 'factory-inbox', 'config.example.json'), 'utf8'));
  assert.deepEqual(Object.keys(example).sort(), ['factoryDir', 'notebookId', 'owner']);
  assert.equal(example.notebookId, null);
  const ignored = execFileSync('git', ['check-ignore', 'factory-inbox/config.json'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(ignored.trim(), 'factory-inbox/config.json');
});

test('Files lists the factory-inbox folder', () => {
  assert.match(section('Files'), /^- `factory-inbox\/` — /m);
});

test('Factory inbox says how it finds the stops', () => {
  assert.match(section('Factory inbox'),
    /gh search issues "label:agent:needs-human" --state open --owner <owner>/);
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

test('Factory inbox mentions no inbox.mjs or npm run inbox', () => {
  assert.doesNotMatch(README, /inbox\.mjs/);
  assert.doesNotMatch(README, /npm run inbox/);
});
