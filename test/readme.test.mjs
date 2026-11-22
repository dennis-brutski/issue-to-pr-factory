import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.mjs';

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
    'gateModel', 'simpleModel', 'pollSec', 'autoMerge', 'maxBudgetUsd'])
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
