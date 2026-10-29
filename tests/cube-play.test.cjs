'use strict';
// Rubik play: keyboard and swipe twists, tilt, today's cube and the fleet cube.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.t = (text, vars) => String(text).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// Twists: neighbours wrap around; swipes need clear sideways travel; tilt stays small.
const play = require('../web/cube-play.js');
const order = ['changes', 'history', 'branches'];
assert.equal(play.neighbour(order, 'history', 1), 'branches');
assert.equal(play.neighbour(order, 'branches', 1), 'changes', 'wraps around');
assert.equal(play.neighbour(order, 'changes', -1), 'branches');
assert.equal(play.neighbour(order, 'unknown', 1), 'changes');
assert.equal(play.neighbour([], 'x', 1), '');
assert.equal(play.isSwipe(200, 20), true);
assert.equal(play.isSwipe(200, 120), false, 'diagonal is not a swipe');
assert.equal(play.isSwipe(60, 0), false, 'too short');
assert.deepEqual(play.tilt(100, 50, 100, 100), { rx: 0, ry: 4 }, 'right edge tilts right');
assert.deepEqual(play.tilt(50, 0, 100, 100), { rx: 4, ry: 0 }, 'top edge tilts back');
assert.deepEqual(play.tilt(10, 10, 0, 0), { rx: 0, ry: 0 });
const js = read('web/cube-play.js');
assert.match(js, /event\.ctrlKey\|\|!event\.altKey/, 'Ctrl+Alt only');
assert.match(js, /typing\(event\.target\)/, 'never while typing');
assert.match(js, /workspaceTabs\.has\(tab\)/, 'only real workspace views are faces');
assert.match(js, /window\.GitDeckAppearance\?\.sound==='on'/, 'sound only when chosen');

// Today's cube: a new day starts from what is open; done items turn stickers green.
const day = require('../web/day-cube.js');
let record = day.track(null, ['a', 'b', 'c'], '2026-10-29');
assert.deepEqual(day.progress(record, ['a', 'b', 'c']), { total: 3, solved: 0, done: false });
record = day.track(record, ['b', 'd'], '2026-10-29');
assert.deepEqual(day.progress(record, ['b', 'd']), { total: 4, solved: 2, done: false }, 'new work joins the scramble');
assert.deepEqual(day.progress(record, []), { total: 4, solved: 4, done: true });
assert.deepEqual(day.track(record, ['z'], '2026-10-30').seen, ['z'], 'next day starts fresh');
assert.equal(day.stickers(4, 2).filter((c) => c === '#3fb950').length, 5, 'about half green, centre first');
assert.equal(day.stickers(4, 2)[4], '#3fb950');
assert.equal(day.stickers(0, 0).every((c) => c === '#3fb950'), true, 'nothing open: solved');
assert.equal(day.stickers(5, 0).includes('#3fb950'), false);

// Fleet cube: six largest families, grids that fit, overflow counted.
const fleet = require('../web/fleet-cube.js');
const names = [...Array.from({ length: 10 }, (_, i) => `crs-${i}`), ...Array.from({ length: 40 }, (_, i) => `lns-${String(i).padStart(2, '0')}`), 'hiring', 'aml-a', 'aml-b'];
const familyOf = (n) => (n.indexOf('-') > 0 ? n.slice(0, n.indexOf('-') + 1) : n);
const faces = fleet.cubeFaces(names, familyOf);
assert.deepEqual(faces.map((f) => f.family), ['lns-', 'crs-', 'aml-', 'hiring']);
assert.deepEqual([faces[0].size, faces[0].members.length, faces[0].hidden], [6, 36, 4]);
assert.deepEqual([faces[1].size, faces[2].size], [4, 2]);
assert.equal(fleet.cubeFaces(Array.from({ length: 9 }, (_, i) => `f${i}-x`), familyOf).length, 6, 'at most six faces');
assert.equal(fleet.faceAngles.length, 6);

// Wiring.
const html = read('web/index.html');
for (const name of ['cube-play.js', 'day-cube.js', 'fleet-cube.js']) assert(html.includes(`<script src="/${name}" defer></script>`), name);
assert(read('web/cockpit.js').includes("'fleet-cube'"));
assert.match(read('web/rubik.js'), /dispatchEvent\(new CustomEvent\('gitdeck:turn'/);
assert.match(read('web/appearance.js'), /const sounds=\['off','on'\];const defaultSound='off';/);
assert.match(read('web/rubik.css'), /:not\(\.fleet-cube-face \*\):not\(\.day-cube-mini\)/, 'cube stickers keep their colours');
console.log('PASS: cube twists (keys, swipe), tilt, sound setting, today\'s cube and fleet cube');
