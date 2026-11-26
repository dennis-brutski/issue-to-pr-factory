// The pull request body: the factory writes it, and the review and merge stages read parts of it back.
// Only this module builds or reads it. No I/O.

// The paths a body lists under a "## <heading>" section: each bullet's first backticked text.
// The section ends at the next "## " heading. Issue bodies are read with it too.
export function listedPaths(body, heading) {
  const lines = (body ?? '').split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${heading}\\s*$`, 'i').test(l.trim()));
  if (start < 0) return [];
  const paths = [];
  for (const l of lines.slice(start + 1)) {
    if (/^##\s/.test(l)) break;
    const m = /^\s*[-*]\s.*?`([^`]+)`/.exec(l);
    if (m) paths.push(m[1]);
  }
  return paths;
}

const list = (items) => items.map((v) => `- ${v}`).join('\n');
// Every line quoted: a warning may hold agent text, which must not start a line above "Closes #n".
const warning = (warnings) => `> ⚠ This pull request changes files you should check:\n${warnings.map((v) => `> - ${String(v).replace(/\r?\n/g, '\n>   ')}`).join('\n')}\n\n`;
// Between "Closes #n" and "## What changed", where parse reads it.
const testsSection = (paths) => paths.length ? `## Tests that change\n\n${paths.map((t) => `- \`${t}\``).join('\n')}\n\n` : '';
const testChangeLine = (c) => `- \`${c.file}\` · ${c.test} — ${c.reason}`;
const testChangeLines = (changes) => changes.map(testChangeLine).join('\n');
const testsChangedSection = (changes) => changes.length ? `## Tests changed\n\n${testChangeLines(changes)}\n\n` : '';
// Agent text: a later line is indented so it stays inside its bullet and cannot start a heading.
const findingsSection = (findings) => findings.length
  ? `## Review findings after the fix\n\n${findings.map((v) => `- ${String(v).replace(/\r?\n/g, '\n  ')}`).join('\n')}\n\n` : '';

// parts: issueNumber; warnings (why it is a draft); testsThatChange (the issue's list); summary (the agent's);
// notes; testChanges (as the sessions reported them); reviewFindingsAfterFix (a note, not a draft);
// checks (the text under "## Checks"); footer.
export function render({ issueNumber, warnings = [], testsThatChange = [], summary, notes = [], testChanges = [], reviewFindingsAfterFix = [], checks, footer }) {
  return `${warnings.length ? warning(warnings) : ''}Closes #${issueNumber}\n\n${testsSection(testsThatChange)}## What changed\n\n${summary}\n\n`
    + `${notes.length ? `${list(notes)}\n\n` : ''}${testsChangedSection(testChanges)}${findingsSection(reviewFindingsAfterFix)}## Checks\n\n${checks}\n\n${footer}`;
}

// What the factory reads back. testsThatChange comes only from its own part, from the "Closes #n" line
// to "## What changed": the warning above it and the summary below it hold agent text, which must not add to it.
export function parse(body) {
  const lines = (body ?? '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^Closes #\d+$/.test(l));
  if (start < 0) return { issueNumber: null, testsThatChange: [] };
  const issueNumber = Number(lines[start].slice('Closes #'.length));
  const end = lines.findIndex((l, i) => i > start && /^## What changed$/.test(l));
  if (end < 0) return { issueNumber, testsThatChange: [] };
  return { issueNumber, testsThatChange: listedPaths(lines.slice(start + 1, end).join('\n'), 'Tests that change') };
}

// The body with more test changes: added to its section, or a new section before the checks.
// Read by lines, like parse: a body edited in GitHub's web editor comes back with CRLF line endings, which it keeps.
export function addTestChanges(body, changes) {
  if (!changes.length) return body;
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);
  const added = changes.map(testChangeLine);
  const at = lines.findIndex((l) => l === '## Tests changed');
  if (at >= 0) {
    const end = lines.findIndex((l, i) => i > at + 1 && l === '');
    lines.splice(end < 0 ? lines.length : end, 0, ...added);
  } else {
    const checks = lines.findIndex((l) => l.startsWith('## Checks'));
    if (checks < 0) lines.push('', '## Tests changed', '', ...added);
    else lines.splice(checks, 0, '## Tests changed', '', ...added, '');
  }
  return lines.join(eol);
}
