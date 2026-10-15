const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const T = require('../web/timeline.js');

// The same action in several repositories within two minutes is one batch; the same repository twice is not.
const items = [
  { action: 'pull', path: 'A', createdAt: '2026-10-15 10:05:30' },
  { action: 'pull', path: 'B', createdAt: '2026-10-15 10:05:00' },
  { action: 'pull', path: 'A', createdAt: '2026-10-15 10:04:50' },
  { action: 'commit', path: 'C', createdAt: '2026-10-15 10:04:00' },
  { action: 'commit', path: 'D', createdAt: '2026-10-14 18:00:00' },
];
const batches = T.batches(items);
assert.deepEqual(batches.map((batch) => `${batch.action}:${batch.items.map((item) => item.path).join('')}:${batch.day}`), ['pull:AB:2026-10-15', 'pull:A:2026-10-15', 'commit:C:2026-10-15', 'commit:D:2026-10-14']);

const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');
assert.ok(web('index.html').indexOf('/timeline.js') < web('index.html').indexOf('/cockpit.js'));
assert.match(web('cockpit.js'), /\['timeline','jobs','automation'\]/);
const server = fs.readFileSync(path.join(__dirname, '../git-dashboard-server.ps1'), 'utf8');
assert.ok(server.includes("'/api/timeline'") && server.includes("'timeline-restore'"));
assert.match(server, /\$tracked = @\('timeline-restore','absorb',/, 'Going back is journaled, so it can be undone');
console.log('PASS: undo timeline batches and wiring');
