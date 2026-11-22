import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strayDotfiles } from '../lib/dotfiles.mjs';

test('a commit adding a home dotfile at the root is refused', () => {
  assert.deepEqual(strayDotfiles([{ status: 'A', path: '.bashrc' }]), ['.bashrc']);
  assert.deepEqual(strayDotfiles([{ status: 'A', path: '.profile' }]), ['.profile']);
});
test('a commit adding a file in an editor or agent folder at the root is refused', () => {
  const changes = ['.claude/settings.json', '.idea/workspace.xml', '.vscode/settings.json', '.config/gh/hosts.yml'].map((path) => ({ status: 'A', path }));
  assert.deepEqual(strayDotfiles(changes), ['.claude/settings.json', '.idea/workspace.xml', '.vscode/settings.json', '.config/gh/hosts.yml']);
});
test('a rename onto a dotfile counts as adding it', () => {
  assert.deepEqual(strayDotfiles([{ status: 'R', oldPath: 'notes.txt', path: '.zshrc' }]), ['.zshrc']);
});
test('changing an already-tracked dotfile is allowed', () => {
  assert.deepEqual(strayDotfiles([{ status: 'M', path: '.gitignore' }, { status: 'M', path: '.vscode/settings.json' }, { status: 'D', path: '.bashrc' }]), []);
});
test('dotfiles below the root and ordinary project dotfiles are allowed', () => {
  const changes = ['src/.bashrc', 'docs/.idea/x', '.gitignore', '.editorconfig', '.nvmrc'].map((path) => ({ status: 'A', path }));
  assert.deepEqual(strayDotfiles(changes), []);
});
