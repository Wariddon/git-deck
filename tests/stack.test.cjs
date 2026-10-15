const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const S = require('../web/stack.js');

const branches = [
  { name: 'feature/PAY-1-api', target: 'develop', subject: 'API' },
  { name: 'feature/PAY-1-ui', target: 'feature/PAY-1-api', subject: 'UI' },
];
const text = S.stackDescription(branches, 1);
assert.match(text, /^Part 2 of 2 of a stacked change\./);
assert.match(text, /- 1\. `feature\/PAY-1-api` → `develop` — API/);
assert.match(text, /➡️ 2\. `feature\/PAY-1-ui` → `feature\/PAY-1-api` — UI/);

const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');
const html = web('index.html');
assert.ok(html.indexOf('/stack.js') > html.indexOf('/release-ui.js'), 'stack.js needs releaseDialog');
const server = fs.readFileSync(path.join(__dirname, '../git-dashboard-server.ps1'), 'utf8');
for (const route of ["'/api/repo/stack'", "'stack-restack'", "'stack-push'"]) assert.ok(server.includes(route), route);
console.log('PASS: stacked merge request descriptions and wiring');
