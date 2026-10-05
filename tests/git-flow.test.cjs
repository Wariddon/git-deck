const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');

// Git-flow plans: the steps Sourcetree's Git-flow runs, as plain Git Deck actions.
const context = { t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)), api: () => {}, releaseDialog: () => {} };
context.window = context;
vm.runInNewContext(web('git-flow.js'), context);
const flow = context.GitDeckGitFlow;
const data = { branches: [{ name: 'master' }, { name: 'develop' }] };
const steps = (plan) => JSON.parse(JSON.stringify(plan.steps.map((s) => [s.action, s.payload])));

assert.equal(flow.production(data), 'master');
assert.equal(flow.production({ branches: [{ name: 'main' }, { name: 'master' }] }), 'main');
assert.equal(flow.kindOf('hotfix/1.0.1'), 'hotfix');
assert.equal(flow.kindOf('topic/x'), null);

assert.deepEqual(steps(flow.planStart('feature', 'login', data)), [['branch-create-at', { branch: 'feature/login', commit: 'develop' }], ['branch-switch', { branch: 'feature/login' }]]);
assert.deepEqual(steps(flow.planStart('hotfix', '1.0.1', data))[0], ['branch-create-at', { branch: 'hotfix/1.0.1', commit: 'master' }], 'Hotfixes start from production');

assert.deepEqual(steps(flow.planFinish('feature/login', data)), [
  ['branch-switch', { branch: 'develop' }], ['merge', { branch: 'feature/login', mode: 'no-ff' }], ['branch-delete', { branch: 'feature/login' }]]);
const release = steps(flow.planFinish('release/1.2.0', data, { deleteBranch: false }));
assert.deepEqual(release.map((s) => s[0]), ['branch-switch', 'merge', 'tag-create', 'branch-switch', 'merge'], 'Release: master, tag, back to develop, keep the branch');
assert.equal(release[2][1].tag, '1.2.0');
assert.equal(release[0][1].branch, 'master');

assert.ok(web('index.html').includes('/git-flow.js'));
assert.match(web('modern.js'), /gitflow:actionButton\('gitflow','flow',t\('Git-flow'\)/);
console.log('PASS: Git-flow init / start / finish plans and the toolbar button');
