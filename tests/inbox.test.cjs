const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
global.t = (text, values) => String(text).replace(/\{(\w+)\}/g, (_, key) => values?.[key] ?? '');
const I = require('../web/inbox.js');

const now = Date.parse('2026-10-28T10:00:00Z');
const repo = { name: 'aml-webview', path: 'C:/SCB/aml-webview' };
const items = I.itemsFor(repo, {
  branch: 'development', upstream: 'origin/development', changed: 2, untracked: 0, ahead: 1, behind: 3, upstreamGone: false,
  unpushedBranches: [{ branch: 'release', commits: 1 }], latestTag: '1.2.2', latestTagDate: '2026-10-27T10:00:00Z', latestTagBy: 'other@example.test',
}, { me: 'me@example.test', now });
assert.deepEqual(items.map((i) => `${i.group}:${i.kind}:${i.action}`), ['now:commit:commit', 'now:push:push', 'look:pull:pull', 'look:local:release:branches', 'fyi:tag:1.2.2:tags']);
assert.equal(I.itemsFor(repo, { latestTag: '1.2.2', latestTagDate: '2026-10-27T10:00:00Z', latestTagBy: 'Me@Example.test' }, { me: 'me@example.test', now }).length, 0, 'Your own tag is not news');
assert.equal(I.itemsFor(repo, { latestTag: '1.2.2', latestTagDate: '2026-10-01T10:00:00Z' }, { now }).length, 0, 'Old tags are not news');
const gone = I.itemsFor(repo, { branch: 'feature/x', upstreamGone: true, conflicts: 2, operation: 'merge' }, { now });
assert.deepEqual(gone.map((i) => i.tone), ['bad', 'info']);

// Done hides an item until it changes; snooze hides it until the time passes.
const commit = items[0];
assert.equal(I.visibleItems([commit], { [commit.key]: { doneSig: commit.sig } }, now).length, 0);
assert.equal(I.visibleItems([{ ...commit, sig: '3' }], { [commit.key]: { doneSig: commit.sig } }, now).length, 1, 'Comes back when it changes');
assert.equal(I.visibleItems([commit], { [commit.key]: { snoozeUntil: now + 1000 } }, now).length, 0);
assert.equal(I.visibleItems([commit], { [commit.key]: { snoozeUntil: now - 1000 } }, now).length, 1);
assert.deepEqual(I.sortItems([...items].reverse()).map((i) => i.group), ['now', 'now', 'look', 'look', 'fyi']);
const morning = new Date(I.tomorrowMorning(new Date(2026, 9, 28, 15, 0)));
assert.deepEqual([morning.getDate(), morning.getHours()], [29, 9]);

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
assert.ok(read('web/index.html').indexOf('/inbox.js') < read('web/index.html').indexOf('/cockpit.js'));
assert.match(read('web/cockpit.js'), /'briefing','inbox'/);
console.log('PASS: inbox (items per repository, own tags, done until changed, snooze, order)');
