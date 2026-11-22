import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strayDotfiles } from '../lib/dotfiles.mjs';

test('adding a file in a folder the base already tracks is allowed', () => {
  const onBase = new Set(['.vscode/', '.vscode/settings.json', '.claude/', '.claude/skills/', '.claude/skills/a/SKILL.md']);
  const changes = ['.vscode/extensions.json', '.claude/skills/b/SKILL.md'].map((path) => ({ status: 'A', path }));
  assert.deepEqual(strayDotfiles(changes, onBase), []);
});
test('a folder the base does not track is still refused when another one is tracked', () => {
  const onBase = new Set(['.vscode/', '.vscode/settings.json']);
  const changes = ['.vscode/extensions.json', '.idea/workspace.xml', '.bashrc'].map((path) => ({ status: 'A', path }));
  assert.deepEqual(strayDotfiles(changes, onBase), ['.idea/workspace.xml', '.bashrc']);
});
