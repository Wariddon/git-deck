'use strict';
// Mini mode: next items from the shared Pending snapshot, recent changes, snapshot updates, wiring.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.t = (text, vars) => String(text).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));
const inbox = require('../web/inbox.js');
const { nextItems, recordChange, withPending, nameOf } = require('../web/mini.js');
const web = (name) => fs.readFileSync(path.join(__dirname, '..', 'web', name), 'utf8');

assert.equal(nameOf('C:\\SCB\\crs-webview'), 'crs-webview');
assert.equal(nameOf('/home/me/repo/'), 'repo');

const snapshot = { at: 1, items: [
  { path: 'C:\\w\\api', pending: { branch: 'main', behind: 2 } },
  { path: 'C:\\w\\web', pending: { branch: 'feat', ahead: 1, changed: 3 } },
  { path: 'C:\\w\\.worktrees\\x', pending: { branch: 'x', ahead: 4 } },
  { path: 'C:\\w\\lib', pending: { branch: 'main', conflicts: 2, operation: 'rebase' } },
] };
const items = nextItems(snapshot, {}, { helpers: inbox, now: 1e12 });
assert.deepEqual(items.map((item) => `${item.repo.name}:${item.kind}`), ['lib:conflict', 'web:commit', 'web:push', 'api:pull'], 'urgent first, worktrees skipped');
assert.equal(nextItems(snapshot, {}, { helpers: inbox, now: 1e12, limit: 2 }).length, 2);
const doneState = { [items[0].key]: { doneSig: items[0].sig } };
assert.equal(nextItems(snapshot, doneState, { helpers: inbox, now: 1e12 })[0].kind, 'commit', 'Done items stay hidden (shared with the Inbox)');
assert.deepEqual(nextItems(null, {}, { helpers: inbox }), []);

let changes = recordChange([], { path: 'C:\\a', at: 1 });
changes = recordChange(changes, { path: 'C:\\b', at: 2 });
changes = recordChange(changes, { path: 'c:\\A', at: 3 });
assert.deepEqual(changes.map((item) => item.at), [3, 2], 'a repeat moves to the top, once');
assert.equal(Array.from({ length: 12 }, (_, i) => i).reduce((list, i) => recordChange(list, { path: 'p' + i, at: i }), []).length, 8);

const updated = withPending(snapshot, 'c:\\W\\API', { branch: 'main' });
assert.equal(updated.items.length, 4);
assert.deepEqual(updated.items.at(-1), { path: 'c:\\W\\API', pending: { branch: 'main' } });
assert.equal(withPending(snapshot, 'C:\\w\\api', null).items.length, 3);

// Wiring: CSP-safe page (no inline script/style), the launcher and the bridge.
const html = web('mini.html');
assert.doesNotMatch(html, /<script>|<style|style="/);
for (const src of ['/i18n.js', '/inbox.js', '/mini.js']) assert(html.includes(`<script src="${src}"></script>`), src);
assert.match(web('inbox.js'), /window\.GitDeckInboxHelpers=helpers;/);
assert.match(web('ux.js'), /window\.open\('\/mini\.html','gitdeck-mini','width=400,height=640'\)/);
assert.match(web('ux.js'), /window\.GitDeckMiniBridge=\{/);
console.log('PASS: mini mode next items, recent changes, snapshot update and wiring');
