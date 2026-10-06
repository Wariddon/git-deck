const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');

// Alert bar: what is wrong with the open repository, most serious first.
const context = { t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)), showActionFeedback: () => {}, el: () => ({}), state: {} };
context.window = context;
vm.runInNewContext(web('alerts.js'), context);
const { repoAlerts } = context.GitDeckAlerts;
const ids = (data) => JSON.parse(JSON.stringify(repoAlerts(data).map((a) => a.id)));

assert.deepEqual(ids({ branch: 'main', sync: { ahead: 0, behind: 0 }, stashes: [] }), [], 'A healthy repository shows nothing');
assert.deepEqual(ids({ branch: 'main', operation: { active: true, type: 'merge', conflicts: ['a.txt', 'b.txt'] } }), ['conflicts']);
assert.match(repoAlerts({ branch: 'main', operation: { active: true, type: 'merge', conflicts: ['a', 'b'] } })[0].title, /merge stopped: 2 file\(s\) conflict/);
assert.deepEqual(ids({ branch: 'main', operation: { active: true, type: 'rebase', conflicts: [] } }), ['operation']);
assert.deepEqual(ids({ branch: '', head: 'abc' }), ['detached']);
assert.deepEqual(ids({ branch: 'main', sync: { ahead: 2, behind: 3, upstream: 'origin/main' } }), ['diverged'], 'Diverged: push would be rejected');
assert.deepEqual(ids({ branch: 'main', sync: { ahead: 2, behind: 0 } }), [], 'Only ahead is normal');
const parked = repoAlerts({ branch: 'main', stashes: [{ ref: 'stash@{0}', message: 'On main: Saved by Git Deck before merge' }, { ref: 'stash@{1}', message: 'On main: wip' }] });
assert.equal(parked[0].id, 'parked');
assert.equal(parked[0].stash, 'stash@{0}');
assert.match(parked[0].detail, /^"Saved by Git Deck before merge"/);
assert.deepEqual(ids({ branch: 'main', stashes: [{ ref: 'stash@{0}', message: 'On main: gitdeck: switch to dev' }] }), ['parked']);
assert.deepEqual(ids({ branch: 'main', stashes: [{ ref: 'stash@{0}', message: 'On main: my own wip' }] }), [], 'Your own stashes are not alerts');

assert.ok(web('index.html').includes('/alerts.js'));
assert.match(web('features.css'), /\.error-spotlight\{position:fixed;top:64px/);
console.log('PASS: repository alerts (conflicts, unfinished operation, detached, diverged, parked changes) and error spotlight');
