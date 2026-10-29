'use strict';
// Power tools (client): siblings, graves, tombs, save point ids, ticket keys, blast radius, wiring.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const power = require('../web/power.js');
const mapHelpers = require('../web/api-map.js');
assert.equal(power.stem('src-svc-customer-request'), 'svc-customer-request');
const repos = ['src-svc-customer-request', 'txi-svc-customer-request', 'src-web-staff', 'ucis-svc-customer-request', 'gamedb'].map((name) => ({ name, path: `C:/SCB/${name}` }));
const family = (name) => name.split('-')[0] + '-';
assert.deepEqual(power.siblings('src-svc-customer-request', repos, family).map((r) => r.name), ['txi-svc-customer-request', 'ucis-svc-customer-request', 'src-web-staff'], 'same stem first, then the family');
assert.deepEqual(power.siblings('gamedb', repos, family), []);

const now = Date.parse('2026-10-29T12:00:00Z');
const graves = power.graves([
  { name: 'main', remote: false, protected: true, merged: true, date: '2020-01-01' },
  { name: 'feature/done', remote: false, merged: true, date: '2026-10-28' },
  { name: 'feature/gone', remote: false, gone: true, date: '2026-10-28' },
  { name: 'feature/old', remote: false, date: '2026-05-01' },
  { name: 'feature/active', remote: false, date: '2026-10-27' },
  { name: 'origin/x', remote: true, merged: true, date: '2020-01-01' },
  { name: 'wip', remote: false, current: true, merged: true, date: '2020-01-01' },
  { name: 'development', remote: false, merged: true, date: '2020-01-01' },
  { name: 'release/1.2', remote: false, merged: true, date: '2020-01-01' },
  { name: 'test/082026', remote: false, merged: true, date: '2020-01-01' },
], now);
assert.deepEqual(graves.map((g) => `${g.name}:${g.why}`), ['feature/done:merged', 'feature/gone:gone', 'feature/old:idle'], 'never protected, current, remote or long-lived (development, release/*, test/*)');
assert.deepEqual(power.freshTombs([{ at: '2026-10-25T00:00:00Z' }, { at: '2026-10-01T00:00:00Z' }], now).length, 1, 'tombs last 7 days');
assert.equal(power.pointId(new Date(2026, 9, 29, 14, 30, 5)), 'sp-20261029-143005');
assert(power.isTicket('AP2365-3320') && !power.isTicket('hello') && !power.isTicket('ap2365-3320'));

const own = { provides: [{ method: 'POST', path: '/v1/proxy', file: 'src/Controller.java' }, { method: 'GET', path: '/v2/other', file: 'src/Other.java' }], sends: [{ topic: 'customer.updated', file: 'src/Producer.java' }] };
const others = [
  { repo: { name: 'txi-web', path: 'C:/SCB/txi-web' }, surface: { calls: [{ path: '/api/v1/proxy', file: 'a.ts', line: 3 }], listens: [] } },
  { repo: { name: 'audit', path: 'C:/SCB/audit' }, surface: { calls: [], listens: [{ topic: 'customer.updated', file: 'L.java', line: 9 }] } },
  { repo: { name: 'calm', path: 'C:/SCB/calm' }, surface: { calls: [{ path: '/v2/other', file: 'c.ts', line: 1 }], listens: [] } },
];
const result = power.blast(['src\\Controller.java', 'src/Producer.java'], own, others, mapHelpers);
assert.deepEqual(result.hits.map((hit) => `${hit.repo.name}:${hit.kind}`), ['txi-web:http', 'audit:kafka'], 'only what the changed files provide');

const js = read('web/power.js');
assert.doesNotMatch(js, /[\u0E00-\u0E7F]/);
assert.match(js, /action:'sibling-patch-check'/);
assert.match(js, /stage:false/, 'sibling apply never stages or commits by itself');
assert.match(js, /const safety=await createPoint\(/, 'loading a save point saves the current state first');
assert.match(js, /action:'branch-create-at',path:tomb\.path,branch:tomb\.branch,commit:tomb\.hash/, 'revive restores the exact commit');
assert.match(js, /event\.ctrlKey&&event\.altKey&&!event\.shiftKey&&event\.key==='Backspace'/);
assert.match(read('web/effective-config.js'), /async function lineage\(repoPath,key/);
assert.doesNotMatch(read('web/effective-config.js'), /window\.GitDeckEffectiveConfig=helpers;/, 'the last export keeps envImpact (Push dialog) and lineage');
const launcher = read('launcher/GitDeckLauncher.cs');
assert.match(launcher, /AddClipboardFormatListener\(Handle\)/);
assert.match(launcher, /if \(m\.Msg == 0x031D\) \{ OnClipboard\(\); return; \}/);
assert.match(launcher, /if \(text\.Length > 24\) return;/, 'only short text is looked at');
const server = read('git-dashboard-server.ps1');
for (const action of ['savepoint-create', 'savepoint-load', 'savepoint-drop', 'sibling-patch-check', 'sibling-patch-apply']) assert(server.includes(`'${action}' {`), action);
assert(server.includes("'/api/journal/recent'") && server.includes("'/api/repo/commit-patch'"));
assert(read('web/index.html').includes('<script src="/power.js" defer></script>'));
console.log('PASS: power tools client (siblings, graves, save points, ticket radar, blast radius, wiring)');
