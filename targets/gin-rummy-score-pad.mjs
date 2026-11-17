// The Gin Rummy Score Pad PWA.
export default {
  repo: 'dennis-brutski/gin-rummy-score-pad',
  baseBranch: 'master',
  protectedFiles: ['playwright.config.js', 'package.json', 'package-lock.json'],
  testDirs: ['test/', 'e2e/'],
  setup: [['npm', ['ci']]],
  checks: [['npm', ['test']], ['npm', ['run', 'e2e']]],
  env: { E2E_PORT: '{port}', PW_CHROMIUM_NO_SANDBOX: '1' },
  sandboxRead: ['~/.cache/ms-playwright'],
  setupWrite: ['~/.npm'],
};
