const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const U = require('../web/ux.js');
const M = require('../web/fleet-map.js');

// Notification center: newest first, repeats folded, capped.
let list = U.pushNotice([], { text: 'pushed', error: false, at: 1 });
list = U.pushNotice(list, { text: 'pushed', error: false, at: 2 });
list = U.pushNotice(list, { text: 'failed', error: true, at: 3 });
assert.deepEqual(list.map((item) => [item.text, item.count]), [['failed', 1], ['pushed', 2]]);
assert.equal(U.pushNotice(Array.from({ length: 60 }, (_, i) => ({ text: String(i) })), { text: 'x' }, 50).length, 50);
// Ticket mode: repositories with a branch or commit for the ticket.
assert.deepEqual([...U.ticketRepos([{ path: 'C:/A', branches: [{}] }, { path: 'C:/B', branches: [], commits: [] }, { path: 'C:/C', commits: [{}] }])], ['c:/a', 'c:/c']);

// Fleet map: states and family groups (single repositories last, under Others).
const now = Date.parse('2026-10-20T00:00:00Z');
assert.equal(M.tileState({ branch: 'main', upstream: 'origin/main', changed: 1 }, { now }), 'warn');
assert.equal(M.tileState({ branch: 'main', upstream: 'origin/main', conflicts: 2 }, { now }), 'bad');
assert.equal(M.tileState({ branch: 'main', upstream: 'origin/main', behind: 3 }, { now }), 'info');
assert.equal(M.tileState({ branch: 'main', upstream: 'origin/main', lastCommitDate: '2026-01-01T00:00:00Z' }, { now }), 'stale');
assert.equal(M.tileState({ branch: 'feature/x', upstream: '' }, { now }), 'warn', 'Branch not published');
assert.equal(M.tileState(null, { error: 'boom' }), 'bad');
assert.equal(M.tileState(null), 'muted');
const groups = M.groupFamilies(['aml-a', 'aml-b', 'crs-x', 'deployment'].map((name) => ({ repo: { name } })));
assert.deepEqual(groups.map((group) => [group.family, group.items.length]), [['aml', 2], ['', 2]]);

const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');
const html = web('index.html');
for (const file of ['/ux.js', '/fleet-map.js']) assert.ok(html.includes(file), file);
assert.ok(html.indexOf('/fleet-map.js') < html.indexOf('/cockpit.js'), 'Fleet map registers before the menu is grouped');
assert.match(web('cockpit.js'), /'fleet-map'/);
assert.match(web('live-refresh.js'), /gitdeck:live/);
assert.match(web('ux.css'), /:lang\(th\) body \{ --modern-font: "Segoe UI", "Leelawadee UI"/);
console.log('PASS: UX (notifications, ticket mode, fleet map states and families, wiring, Thai font)');
