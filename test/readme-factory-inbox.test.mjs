import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const README = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md'), 'utf8');
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
  assert.match(inbox, /not shipped in this repo/);
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
