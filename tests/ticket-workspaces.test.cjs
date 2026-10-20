const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const W = require('../web/ticket-workspaces.js');

assert.equal(W.ticketKey(' pay-12 '), 'PAY-12');
assert.ok(W.validKey('PAY-12') && !W.validKey('PAY') && !W.validKey('PAY-12 x'));
const prompt = W.defaultPrompt('PAY-12', ['billing', 'ledger'], 'Fix rounding');
assert.match(prompt, /^Ticket PAY-12: Fix rounding\./);
assert.match(prompt, /feature\/PAY-12 \(the same ticket also has worktrees in: billing, ledger\)/);
assert.match(prompt, /Do not push\./);
const groups = W.groupWorkspaces([
  { key: 'PAY-2', mainName: 'ledger' }, { key: '', mainName: 'tools' }, { key: 'PAY-2', mainName: 'billing' }, { key: 'PAY-1', mainName: 'x' },
]);
assert.deepEqual(groups.map((group) => `${group.key}:${group.items.map((item) => item.mainName).join('+')}`), ['PAY-1:x', 'PAY-2:billing+ledger', ':tools']);

const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');
const html = web('index.html');
assert.ok(html.indexOf('/ticket-workspaces.js') > html.indexOf('/fleet.js') && html.indexOf('/ticket-workspaces.js') < html.indexOf('/cockpit.js'));
assert.ok(((id) => require('../web/cockpit.js').intentGroups.flatMap(([, ids]) => ids).concat(require('../web/cockpit.js').moreViews).includes(id))('ticket-workspaces'), 'In the Dashboard menu');
const server = fs.readFileSync(path.join(__dirname, '../git-dashboard-server.ps1'), 'utf8');
for (const route of ["'/api/agents'", "'/api/ticket-workspaces'", "'ticket-workspace-create'", "'agent-start'"]) assert.ok(server.includes(route), route);
console.log('PASS: ticket workspaces (keys, first prompt, grouping, wiring)');
