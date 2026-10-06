const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');

// Git Deck updated while open: reload for web changes, reopen for server changes.
const context = { t: (s) => s, api: async () => ({}), el: () => ({}) };
context.window = context;
vm.runInNewContext(web('update-check.js'), context);
const { decide } = context.GitDeckUpdateCheck;
assert.equal(decide({ web: '1' }, { web: '1', serverStale: false }), '', 'Nothing changed');
assert.equal(decide({ web: '1' }, { web: '2', serverStale: false }), 'web', 'Web files changed: reload');
assert.equal(decide({ web: '1' }, { web: '2', serverStale: true }), 'server', 'Server files changed: reopen wins');
assert.equal(decide(null, { web: '2' }), '');

const server = fs.readFileSync(path.join(__dirname, '../git-dashboard-server.ps1'), 'utf8');
assert.match(server, /'\/api\/version' \{ Write-Json \$context \(Get-GitDeckVersionState\) \}/);
assert.match(server, /\$script:SharedVariableNames = @\([^)]*'ServerStamp'/, 'The GET pool needs the start stamp');
assert.ok(web('index.html').includes('/update-check.js'));
console.log('PASS: update notice (reload for web changes, reopen for server changes)');
