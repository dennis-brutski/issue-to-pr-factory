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
const testChangeLines = (changes) => changes.map((c) => `- \`${c.file}\` · ${c.test} — ${c.reason}`).join('\n');
const testsChangedSection = (changes) => changes.length ? `## Tests changed\n\n${testChangeLines(changes)}\n\n` : '';

// parts: issueNumber; warnings (why it is a draft); testsThatChange (the issue's list); summary (the agent's);
// notes; testChanges (as the sessions reported them); checks (the text under "## Checks"); footer.
export function render({ issueNumber, warnings = [], testsThatChange = [], summary, notes = [], testChanges = [], checks, footer }) {
  return `${warnings.length ? warning(warnings) : ''}Closes #${issueNumber}\n\n${testsSection(testsThatChange)}## What changed\n\n${summary}\n\n`
    + `${notes.length ? `${list(notes)}\n\n` : ''}${testsChangedSection(testChanges)}## Checks\n\n${checks}\n\n${footer}`;
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
export function addTestChanges(body, changes) {
  if (!changes.length) return body;
  const at = body.indexOf('## Tests changed\n\n');
  if (at >= 0) {
    const end = body.indexOf('\n\n', at + '## Tests changed\n\n'.length);
    return end < 0 ? `${body}\n${testChangeLines(changes)}` : `${body.slice(0, end)}\n${testChangeLines(changes)}${body.slice(end)}`;
  }
  const checks = body.indexOf('## Checks');
  return checks < 0 ? `${body}\n\n${testsChangedSection(changes).trimEnd()}` : `${body.slice(0, checks)}${testsChangedSection(changes)}${body.slice(checks)}`;
}
