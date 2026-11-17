// The factory itself. Everything that confines or checks the agents is protected:
// a change there is still built, but arrives as a draft for Dennis to read.
export default {
  repo: 'dennis-brutski/issue-to-pr-factory',
  baseBranch: 'main',
  setup: [],
  checks: [['npm', ['test']]],
  testDirs: ['test/'],
  protectedFiles: ['lib/agent.mjs', 'lib/brakes.mjs', 'lib/checks.mjs', 'lib/confine.mjs', 'lib/eligibility.mjs',
    'prompts/_rules.md', 'config.mjs', 'package.json'],
  protectedDirs: ['targets/', 'smoke/'],
};
