export const config = {
  owner: 'dennis-brutski',
  repo: 'dennis-brutski/gin-rummy-score-pad',
  baseBranch: 'master',
  remoteUrl: null, // null = https://github.com/<repo>.git
  runDir: null, // null = the factory folder
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
