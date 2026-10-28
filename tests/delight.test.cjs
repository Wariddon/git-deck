'use strict';
// Close the day, time saved, production celebration, predicted commands, ticket resume, history
// replay and repository weather: pure helpers and wiring.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.t = (text, vars) => String(text).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));
const web = (name) => fs.readFileSync(path.join(__dirname, '..', 'web', name), 'utf8');

// Time saved and close the day.
const day = require('../web/day-close.js');
const now = new Date(2026, 9, 28, 18, 0);
let log = day.addSaving({}, 'conflict-forecast', 1, now);
log = day.addSaving(log, 'recipe-step', 3, now);
log = day.addSaving(log, 'quick-undo', 1, new Date(2026, 9, 27, 10, 0));
log = day.addSaving(log, 'made-up', 5, now);
log = day.addSaving({ '2026-07-01': { 'quick-undo': 9 }, ...log }, 'lesson', 1, now);
assert(!log['2026-07-01'], 'older than 60 days is dropped');
assert.equal(day.savedSince(log, '2026-10-28').minutes, 20 + 3 + 3);
assert.equal(day.savedSince(log, '2026-10-26').byKind['quick-undo'].minutes, 5);
assert.equal(day.weekStart(new Date(2026, 9, 28)), '2026-10-26', 'weeks start on Monday');
assert.equal(day.weekStart(new Date(2026, 10, 1)), '2026-10-26', 'Sunday belongs to the week before');
const left = day.leftBehind([
  { path: 'C:\\w\\api', pending: { branch: 'feature/x', changed: 2, ahead: 1, unpushedBranches: [{ branch: 'spike', commits: 3 }] } },
  { path: 'C:\\w\\.worktrees\\t', pending: { branch: 'x', changed: 5 } }, { path: 'C:\\w\\ok', pending: { branch: 'main' } },
]);
assert.deepEqual(left.map((item) => item.kind), ['commit', 'push', 'branch']);
const plan = day.tomorrowPlan({ left, tickets: [{ key: 'AP-1', minutes: 90, note: 'retest SIT' }] });
assert.match(plan, /^Tomorrow:\n- AP-1: retest SIT\n- api: 2 file\(s\) not committed on feature\/x/);
assert.equal(day.tomorrowPlan({}), 'Tomorrow:\n- (write the plan)');

// Production celebration: only a production-like environment reached by every repository.
const lanes = require('../web/lanes.js');
assert.equal(lanes.reachedProd([{ id: 'env:prd', state: 'done' }]), true);
assert.equal(lanes.reachedProd([{ id: 'env:prod', state: 'part' }, { id: 'env:uat', state: 'done' }]), false);
assert.equal(lanes.reachedProd([{ id: 'tagged', state: 'done' }]), false);

// Predicted commands: what you do around this time on two or more days, not just done.
const recipes = require('../web/recipes.js');
const at = (d, h, m) => new Date(2026, 9, d, h, m).getTime();
const actions = [
  { action: 'pull', path: 'C:\\crs-a', payload: {}, at: at(24, 9, 5) }, { action: 'pull', path: 'C:\\crs-a', payload: {}, at: at(25, 9, 20) },
  { action: 'pull', path: 'C:\\crs-a', payload: {}, at: at(26, 8, 40) }, { action: 'push', path: 'C:\\crs-a', payload: {}, at: at(26, 17, 0) },
  { action: 'fetch', path: 'C:\\b', payload: {}, at: at(25, 9, 0) },
];
const predicted = recipes.predictNext(actions, at(28, 9, 0));
assert.deepEqual(predicted.map((p) => `${p.step.action}:${p.days}`), ['pull:3'], 'push at 17:00 and a one-day fetch are not suggested at 9:00');
assert.deepEqual(recipes.predictNext([...actions, { action: 'pull', path: 'C:\\crs-a', payload: {}, at: at(28, 8, 30) }], at(28, 9, 0)), [], 'already done this morning');

// Ticket resume: newest contexts first, at most 30 kept.
const time = require('../web/ticket-time.js');
const contexts = Object.fromEntries(Array.from({ length: 35 }, (_, i) => [`T-${i + 1}`, { at: i, repo: 'r' }]));
assert.equal(Object.keys(time.trimContexts(contexts)).length, 30);
assert(!('T-1' in time.trimContexts(contexts)), 'oldest dropped');
assert.deepEqual(time.recentTickets(contexts, 'T-35', 2).map((item) => item.key), ['T-34', 'T-33']);

// History replay: lanes like a graph, labels without HEAD noise.
const replay = require('../web/replay.js');
// newest first: m (merge of a and b) <- a <- base ; b <- base
const lanesOf = replay.assignLanes([
  { fullHash: 'm', parents: ['a', 'b'] }, { fullHash: 'b', parents: ['base'] }, { fullHash: 'a', parents: ['base'] }, { fullHash: 'base', parents: [] },
]);
assert.equal(lanesOf.get('m'), 0); assert.equal(lanesOf.get('a'), 0); assert.equal(lanesOf.get('b'), 1); assert.equal(lanesOf.get('base'), 0);
assert.deepEqual(replay.labels('HEAD -> main, origin/main, origin/HEAD, tag: 1.2.0'), ['main', 'origin/main', '🏷 1.2.0']);

// Repository weather.
const weather = require('../web/weather.js');
assert.equal(weather.weatherFor({ branch: 'main' }).level, 'sun');
assert.equal(weather.weatherFor({ branch: 'main', behind: 3 }).level, 'cloud');
assert.equal(weather.weatherFor({ branch: 'x', behind: 40 }).level, 'rain');
assert.equal(weather.weatherFor({ branch: 'x' }, { tone: 'bad', text: 'Will conflict' }).level, 'storm');
assert.equal(weather.weatherFor({ branch: 'x', operation: 'rebase', conflicts: 2 }).icon, '⛈');
assert.equal(weather.weatherFor(null).level, 'unknown');
assert.equal(weather.familySky([{ name: 'a-x', w: { level: 'unknown' } }, { name: 'a-y', w: { level: 'sun' } }]).level, 'sun', 'unchecked repositories do not cloud the sky');
assert.equal(weather.familySky([{ name: 'a-x', w: { level: 'unknown' } }]).level, 'unknown');
const sky = weather.familySky([{ name: 'crs-a', w: { level: 'sun' } }, { name: 'crs-b', w: { level: 'storm' } }, { name: 'crs-c', w: { level: 'sun' } }]);
assert.deepEqual([sky.level, sky.worst, sky.where], ['storm', 'storm', ['crs-b']]);
assert.equal(weather.familyOf('crs-webview'), 'crs-'); assert.equal(weather.familyOf('hiring'), 'hiring');

// Wiring.
const html = web('index.html');
for (const name of ['day-close.js', 'replay.js', 'weather.js']) assert(html.includes(`<script src="/${name}" defer></script>`), name);
for (const id of ['day-close', 'weather', 'replay']) { assert(web('cockpit.js').includes(`'${id}'`), id); assert(web('modern.js').includes(`'${id}':'`), `${id} icon`); }
for (const [file, kind] of [['forecast.js', 'conflict-forecast'], ['quick-undo.js', 'quick-undo'], ['recipes.js', 'recipe-step'], ['push-checks.js', 'env-impact'], ['ticket-time.js', 'ticket-resume']]) assert(web(file).includes(`'${kind}'`), `${file} reports ${kind}`);
assert.match(web('ux.css'), /prefers-reduced-motion: reduce[^}]*replay/);
console.log('PASS: close the day, time saved, celebration, predicted commands, ticket resume, replay lanes, weather');
