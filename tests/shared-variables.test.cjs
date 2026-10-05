const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');

// GET requests run in a RunspacePool that only receives the variables named in
// $script:SharedVariableNames. A lib setting missing from that list is $null there
// (custom actions once failed to load this way).
const server = fs.readFileSync(path.join(root, 'git-dashboard-server.ps1'), 'utf8');
const shared = new Set([...server.match(/\$script:SharedVariableNames = @\(([^)]*)\)/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]));
const runtimeOnly = new Set(['EventClients', 'EverHadClient', 'LastActivityAt', 'PendingChanges', 'PendingRequests', 'PooledHandler', 'RepoWatchers']);
for (const file of fs.readdirSync(path.join(root, 'lib')).filter((name) => name.endsWith('.ps1'))) {
  const source = fs.readFileSync(path.join(root, 'lib', file), 'utf8');
  for (const [, name] of source.matchAll(/^\$script:(\w+)\s*=/gm)) {
    if (runtimeOnly.has(name)) continue;
    assert.ok(shared.has(name), `lib/${file}: $script:${name} must be listed in $script:SharedVariableNames`);
  }
}
console.log('PASS: lib settings reach the GET request pool');
