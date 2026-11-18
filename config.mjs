// Shared defaults. Each target (targets/<name>.mjs) sets repo and baseBranch and overrides the rest.
export const config = {
  owner: 'dennis-brutski', // your GitHub login: only your labels and comments count, and gh must be logged in as you
  ownerName: 'Dennis', // what the prompts call you
  remoteUrl: null, // null = https://github.com/<repo>.git
  runDir: null, // null = runs/<target>
  setup: [], // [cmd, [args]] run before the first agent session, confined, with network
  checks: [], // [cmd, [args]] run before every push, confined, without network
  env: {}, // for setup, checks and agent sessions; '{port}' becomes the run's port, '{runDir}' its run folder
  runtimeRead: ['~/.nvm'], // home folders everything may read (the Node install)
  sandboxRead: [], // extra home folders agents, setup and checks may read
  setupWrite: [], // caches setup may write ('{runDir}/…' keeps them per target, never your own)
  protectedFiles: [], protectedDirs: [], testDirs: [],
  pollSec: 300,
  maxParallel: 2,
  confidenceThreshold: 70,
  maxTurns: 150,
  sessionTimeoutMin: 45,
  checkTimeoutMin: 15,
  model: 'opus', // explicit: agents ignore ~/.claude/settings.json, and the CLI default (Fable) needs usage credits on Pro
  triggers: { explore: 'agent:explore', implement: 'agent:implement', review: 'agent:review', merge: 'agent:merge' },
  states: { inProgress: 'agent:in-progress', needsHuman: 'agent:needs-human', done: 'agent:done' },
  branchPattern: /^factory\/issue-(\d+)$/,
};
