// A made-up web app target the tests use: npm setup, unit and e2e checks, Playwright.
export default {
  repo: 'example/web-app',
  baseBranch: 'master',
  protectedFiles: ['playwright.config.js', 'package.json', 'package-lock.json'],
  testDirs: ['test/', 'e2e/'],
  setup: [['npm', ['ci']]],
  checks: [['npm', ['test']], ['npm', ['run', 'e2e']]],
  env: { E2E_PORT: '{port}', PW_CHROMIUM_NO_SANDBOX: '1', npm_config_cache: '{runDir}/npm-cache' },
  sandboxRead: ['~/.cache/ms-playwright'],
  setupWrite: ['{runDir}/npm-cache'], // its own cache: setup runs unreviewed code, ~/.npm is used unconfined
};
