'use strict';
// Quick undo, review mode, recipes, ticket time and lane stages: pure helpers and wiring.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.t = (text, vars) => String(text).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));
const web = (name) => fs.readFileSync(path.join(__dirname, '..', 'web', name), 'utf8');

// Quick undo: only the entry this action just wrote, still at the top and undoable.
const undo = require('../web/quick-undo.js');
const now = Date.parse('2026-10-28T10:00:30');
const timeline = [
  { id: 'a', path: 'C:\\w\\api', action: 'commit', status: 'latest', createdAt: '2026-10-28 10:00:20' },
  { id: 'b', path: 'C:\\w\\web', action: 'pull', status: 'moved', createdAt: '2026-10-28 10:00:25' },
];
assert.equal(undo.undoCandidate(timeline, 'c:\\W\\API', 'commit', now)?.id, 'a');
assert.equal(undo.undoCandidate(timeline, 'C:\\w\\api', 'merge', now), null, 'other action');
assert.equal(undo.undoCandidate(timeline, 'C:\\w\\web', 'pull', now), null, 'not undoable any more');
assert.equal(undo.undoCandidate(timeline, 'C:\\w\\api', 'commit', now + 120000), null, 'too old');
assert(!undo.undoable.has('push') && !undo.undoable.has('tag-create'), 'remote changes are never offered');

// Review mode: risk order and ticks.
const review = require('../web/review-mode.js');
const ordered = review.reviewOrder([
  { path: 'README.md', status: 'M' }, { path: 'src/main/java/App.java', status: 'M' },
  { path: 'src/test/java/AppTest.java', status: 'A' }, { path: 'pom.xml', status: 'M' },
  { path: 'src/main/resources/application-uat.yml', status: 'M' }, { path: 'db/migration/V2__x.sql', status: 'A' },
]).map((file) => file.path);
assert.deepEqual(ordered.slice(0, 3), ['db/migration/V2__x.sql', 'src/main/resources/application-uat.yml', 'pom.xml']);
assert.deepEqual(ordered.slice(-2), ['README.md', 'src/test/java/AppTest.java']);
let ticks = review.tick({}, 'h1', 'pom.xml', true);
ticks = review.tick(ticks, 'h1', 'a.yml', true);
ticks = review.tick(ticks, 'h1', 'pom.xml', false);
assert.deepEqual(ticks.h1.paths, ['a.yml']);
assert.equal(Object.keys(Array.from({ length: 5 }, (_, i) => i).reduce((s, i) => review.tick(s, 'h' + i, 'f', true, 3), {})).length, 3);

// Recipes: only replayable actions; names replace older ones.
const recipes = require('../web/recipes.js');
assert.deepEqual(recipes.captureStep({ action: 'pull', path: 'C:\\w\\api', strategy: 'ff-only' }), { action: 'pull', path: 'C:\\w\\api', payload: { strategy: 'ff-only' } });
for (const action of ['commit', 'reset-commit', 'discard-file']) assert.equal(recipes.captureStep({ action, path: 'C:\\w' }), null, action);
assert.equal(recipes.describeStep({ action: 'branch-switch', path: 'C:\\w\\api', payload: { branch: 'main' } }), 'api · branch-switch main');
let list = recipes.addRecipe([], 'Morning', [{ action: 'pull', path: 'x', payload: {} }]);
list = recipes.addRecipe(list, 'Morning', [{ action: 'fetch', path: 'x', payload: {} }]);
assert.equal(list.length, 1); assert.equal(list[0].steps[0].action, 'fetch');
assert.equal(recipes.addRecipe(list, '  ', [{}]).length, 1, 'no empty names');

// Ticket time.
const time = require('../web/ticket-time.js');
assert.equal(time.keyOf('feature/AP2365-3320-promptpay'), 'AP2365-3320');
const day = new Date('2026-10-28T10:00:00');
let log = time.addMinutes({ '2026-07-01': { OLD: 5 } }, 'AP2365-3320', 1, day);
log = time.addMinutes(log, 'AP2365-3320', 1, day);
log = time.addMinutes(log, 'CRS-1', 1, new Date('2026-10-27T10:00:00'));
assert(!log['2026-07-01'], 'older than 60 days is dropped');
assert.deepEqual(time.totals(log, '2026-10-27'), [{ key: 'AP2365-3320', minutes: 2 }, { key: 'CRS-1', minutes: 1 }]);
assert.deepEqual(time.totals(log, '2026-10-28'), [{ key: 'AP2365-3320', minutes: 2 }]);
assert.equal(time.duration(83), '1h 23m'); assert.equal(time.duration(7), '7m');
assert.match(web('standup.js'), /time:window\.GitDeckTicketTime\?\.since\?\.\(since\)\|\|\[\]/);

// Lane stages: branch → pushed → merged → tagged → environments in deploy order.
const lanes = require('../web/lanes.js');
const stages = lanes.laneStages([
  { journey: { pushed: true, merged: ['main'], firstTag: { name: '1.0' }, environments: [{ env: 'dev', contains: true }, { env: 'uat', contains: false }] } },
  { journey: { pushed: true, merged: [], firstTag: null, environments: [{ env: 'dev', contains: false }] } },
]);
assert.deepEqual(stages.map((s) => `${s.id}:${s.state}`), ['branch:done', 'pushed:done', 'merged:part', 'tagged:part', 'env:dev:part', 'env:uat:todo']);

// Wiring.
const html = web('index.html');
for (const name of ['quick-undo.js', 'review-mode.js', 'recipes.js', 'ticket-time.js']) assert(html.includes(`<script src="/${name}" defer></script>`), name);
console.log('PASS: quick undo, review order and ticks, recipes, ticket time, lane stages');
