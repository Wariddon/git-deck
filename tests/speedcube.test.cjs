'use strict';
// Speedcube extras: status stickers on tabs, Ctrl+Alt moves, quick faces, dragging the cube edges,
// speedrun times, fleet cube by folder and activity, white plastic, narrow windows.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const speed = require('../web/speedcube.js');
assert.equal(speed.tabSticker({}), 'clean');
assert.equal(speed.tabSticker({ changes: 3, behind: 2 }), 'work', 'work to commit comes before pulling');
assert.equal(speed.tabSticker({ behind: 2, ahead: 1 }), 'pull');
assert.equal(speed.tabSticker({ ahead: 1 }), 'push');
assert.equal(speed.tabSticker({ changes: 1, conflicts: 1 }), 'conflict');
assert.deepEqual(speed.parseMoves('fpu'), ['fetch', 'pull', 'push']);
assert.deepEqual(speed.parseMoves('FXP'), ['fetch', 'pull'], 'unknown letters are ignored');
assert.equal(speed.parseMoves('FFFFFFFF').length, 6, 'at most six moves');

const play = require('../web/cube-play.js');
const order = ['changes', 'history', 'branches'];
assert.equal(play.quickFace(order, '2'), 'history');
assert.equal(play.quickFace(order, '5'), '');
assert.equal(play.quickFace(order, '0'), '');

const room = require('../web/cube-room.js');
assert.deepEqual(room.dragTurn(40), { angle: 10, turn: false });
assert.deepEqual(room.dragTurn(400), { angle: 35, turn: true }, 'leans at most 35 degrees');
assert.deepEqual(room.dragTurn(-50), { angle: 0, turn: false }, 'the wrong way does nothing');

const day = require('../web/day-cube.js');
const now = Date.parse('2026-10-29T12:00:00');
const times = [['2026-10-20', 900e3], ['2026-10-25', 600e3], ['2026-10-26', 1200e3], ['2026-10-27', 300e3], ['2026-10-28', 700e3], ['2026-10-29', 500e3]].map(([d, ms]) => ({ day: d, ms }));
assert.deepEqual(day.solveStats(times, '2026-10-29', now), { today: 500e3, best: 300e3, ao5: 660e3 });
assert.deepEqual(day.solveStats([], '2026-10-29', now), { today: 0, best: 0, ao5: 0 });
assert.equal(day.clock(65000), '1:05');
assert.equal(day.clock(3725000), '1:02:05');

const fleet = require('../web/fleet-cube.js');
assert.equal(fleet.folderOf('C:\\SCB\\crs-webview'), 'SCB');
assert.equal(fleet.folderOf('C:/InblackM/git/gamedb'), 'git');
assert.equal(fleet.heat('940d24d 2026-10-29 fix', now), 3);
assert.equal(fleet.heat('940d24d 2026-10-25 fix', now), 2);
assert.equal(fleet.heat('940d24d 2026-10-10 fix', now), 1);
assert.equal(fleet.heat('940d24d 2025-01-01 fix', now), 0);
assert.equal(fleet.heat('', now), 0);

const appearance = read('web/appearance.js');
assert.match(appearance, /const plastics=\['black','white'\];const defaultPlastic='black';/);
assert.match(appearance, /root\.classList\.toggle\('gd-plastic-white',plastic==='white'\)/);
assert.match(read('web/rubik.js'), /gd-plastic-white'\)\)\{document\.body\.classList\.remove\('theme-dark'/, 'white plastic uses the light palette');
const css = read('web/rubik.css');
assert.match(css, /html\.gd-rubik \.repo-tab\[data-sticker="conflict"\] \.gd-tab-sticker \{ background: var\(--st-red\); \}/);
assert.match(css, /@media \(max-width: 1440px\)/, 'narrow windows keep the sticker row on one line');
assert.match(css, /var\(--gd-groove, #0a0c10\)/, 'cube edge grooves follow the plastic');
assert(read('web/index.html').includes('<script src="/speedcube.js" defer></script>'));
console.log('PASS: speedcube (tab stickers, moves, quick faces, edge drag, speedrun, fleet folders and heat, white plastic)');
