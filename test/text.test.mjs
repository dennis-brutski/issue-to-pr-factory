import { test } from 'node:test';
import assert from 'node:assert/strict';
import { same, fence, list, agentText } from '../lib/text.mjs';

test('same ignores case', () => assert.equal(same('Dennis', 'dennis'), true));

test('same treats null as empty', () => assert.equal(same(null, ''), true));

test('same tells different logins apart', () => assert.equal(same('dennis', 'denis'), false));

test('fence turns a fence inside the text into quotes', () =>
  assert.equal(fence('a\n```\nb'), "```\na\n'''\nb\n```"));

test('list of nothing is empty', () => assert.equal(list([]), ''));

test('list puts each item on a bullet line', () => assert.equal(list(['a', 'b']), '- a\n- b'));

// agentText: what an agent wrote, made safe to post on GitHub.
const ZW = '\u200B';

test('agentText replaces a GitHub token', () => {
  const token = 'gh' + 'p_' + 'a'.repeat(36);
  assert.equal(agentText(`Used ${token} here.`), 'Used (removed: looks like a secret) here.');
});

test('agentText replaces a private key line', () =>
  assert.equal(agentText('a\n-----BEGIN RSA ' + 'PRIVATE KEY-----\nb'), 'a\n(removed: looks like a secret)\nb'));

test('agentText shows an image as text, so GitHub fetches nothing', () =>
  assert.equal(agentText('see ![x](https://e.example/a)'), 'see !\\[x](https://e.example/a)'));

test('agentText turns an HTML image tag into text', () =>
  assert.doesNotMatch(agentText('<img src="https://e.example/a"> <IMG src=x>'), /<img/i));

test('agentText breaks a mention', () =>
  assert.equal(agentText('ask @someone or @org/team'), `ask @${ZW}someone or @${ZW}org/team`));

test('agentText leaves an email address as it is', () => assert.equal(agentText('a@b.example'), 'a@b.example'));

test('agentText breaks a closing keyword before its issue number, in any case', () =>
  assert.equal(agentText('Fixes #3, closed #4, RESOLVES: #5, fix o/r#6'), `Fixes ${ZW}#3, closed ${ZW}#4, RESOLVES: ${ZW}#5, fix o/r${ZW}#6`));

test('agentText breaks a closing keyword before an issue link', () =>
  assert.equal(agentText('closes https://github.com/o/r/issues/7'), `closes ${ZW}https://github.com/o/r/issues/7`));

test('agentText breaks a closing keyword wrapped in emphasis or followed by a bare colon', () =>
  assert.equal(agentText('**Fixes** #9, _Fixes_ #9, Fixes:#9'), `**Fixes** ${ZW}#9, _Fixes_ ${ZW}#9, Fixes:${ZW}#9`));

test('agentText breaks a closing keyword with empty inline HTML before its issue number', () =>
  assert.equal(agentText('Fixes <b></b>#9'), `Fixes <b></b>${ZW}#9`));

test('agentText leaves a word that only ends in a closing keyword', () => assert.equal(agentText('prefix #3'), 'prefix #3'));

test('agentText leaves an issue number without a closing keyword', () => assert.equal(agentText('see #3'), 'see #3'));

test('agentText turns a lone carriage return into a line break', () => assert.equal(agentText('a\rb\r\nc'), 'a\nb\r\nc'));

test('agentText leaves plain text unchanged', () => {
  const text = 'Add `agentText` to lib/text.mjs.\n\n- one\n- two (see #12)';
  assert.equal(agentText(text), text);
});

test('agentText of nothing is empty', () => assert.equal(agentText(undefined), ''));
