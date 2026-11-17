// Fake-Claude steps and small readers shared by the behaviour tests.
export const ok = (summary) => ({ status: 'complete', summary, detail: '' });
export const gate = (confidence, questions = []) => ({ session: 'gate', output: { confidence, questions } });
export const clean = { session: 'review', output: { verdict: 'clean', findings: [] } };
export const implement = (write, commit, summary = commit) => ({ session: 'implement', write, commit, output: ok(summary) });
export const polls = (f) => f.output().split('0 eligible').length - 1;
export const factoryComments = (w, n) => w.item(n).comments.filter((c) => c.body.startsWith('🏭'));
export const settled = (w, n, label) => () => w.item(n).labels.includes(label) && !w.item(n).labels.includes('agent:in-progress');

// Runs a clear issue to an open pull request; returns [issue, pull request, factory].
export async function toPullRequest(w) {
  const n = w.issue({ labels: ['agent:implement'] });
  w.script(n, [gate(90), implement({ 'src/a.js': 'export const a = 2;\n' }, 'Change a'), clean]);
  const f = w.start();
  await w.until(settled(w, n, 'agent:done'), 20000, 'a pull request');
  return [n, w.pr().number, f];
}
