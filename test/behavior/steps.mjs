// Fake-Claude steps and small readers shared by the behaviour tests.
export const ok = (summary) => ({ status: 'complete', summary, detail: '' });
export const gate = (confidence, questions = []) => ({ session: 'gate', output: { confidence, questions } });
export const clean = { session: 'review', output: { verdict: 'clean', findings: [] } };
export const implement = (write, commit, summary = commit) => ({ session: 'implement', write, commit, output: ok(summary) });
export const polls = (f) => f.output().split('0 eligible').length - 1;
export const factoryComments = (w, n) => w.item(n).comments.filter((c) => c.body.startsWith('🏭'));
export const settled = (w, n, label) => () => w.item(n).labels.includes(label) && !w.item(n).labels.includes('agent:in-progress');
