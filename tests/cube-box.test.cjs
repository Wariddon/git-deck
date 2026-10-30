'use strict';
// Cube shape: the program is a 3D box. Turn order, outline for the window cut, shading and wiring.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const box = require('../web/cube-box.js');

assert.equal(box.neighbour('changes', 'changes', 'right'), 'history');
assert.equal(box.neighbour('changes', 'changes', 'left'), 'stash');
assert.equal(box.neighbour('stash', 'stash', 'right'), 'changes');
assert.equal(box.neighbour('branches', 'branches', 'up'), 'today');
assert.equal(box.neighbour('history', 'history', 'down'), 'repos');
assert.equal(box.neighbour('today', 'branches', 'down'), 'branches', 'top returns to the side you came from');
assert.equal(box.neighbour('repos', 'history', 'up'), 'history');
assert.equal(box.neighbour('today', 'branches', 'up'), '', 'nothing above the top');
assert.equal(box.near(350, 0), 360, 'the short way round');
assert.equal(box.near(-100, -90), -90);
assert.equal(box.faceOfTab('tags'), 'stash');
assert.equal(box.faceOfTab('compare'), '', 'other views stay on the side you are on');
assert.equal(box.faceOfDashboard('fleet'), 'repos');
assert.equal(box.faceOfDashboard('inbox'), 'today');

// Facing a side at the working distance, the outline is exactly the window.
const S = 900;
const flat = box.hull(box.corners(0, 0, -S / 2, S, box.PERSPECTIVE * S, S / 2, S / 2));
assert.equal(flat.length, 4, 'one face seen: four corners');
for (const [x, y] of flat) assert(Math.abs(x) < 0.01 || Math.abs(x - S) < 0.01, `x ${x}`), assert(Math.abs(y) < 0.01 || Math.abs(y - S) < 0.01, `y ${y}`);
// Held, the outline is a six-sided shape inside the window at any angle.
for (const [rx, ry] of [[-24, -34], [-85, 200], [60, 45], [-35, 45]]) {
  const outline = box.hull(box.corners(rx, ry, box.fitZ(rx, ry, S), S, box.PERSPECTIVE * S, S / 2, S / 2));
  assert(outline.length >= 4 && outline.length <= 6, `outline of ${outline.length}`);
  for (const [x, y] of outline) assert(x >= 0 && x <= S && y >= 0 && y <= S, `(${x}, ${y}) at ${rx}/${ry}`);
}
assert(box.fitZ(-24, -34, S) > -2.2 * S, 'held as close as it fits, large enough to read');
assert.equal(box.shade([0, 0, 1], 0, 0), 0, 'the side facing you is not darkened');
assert(box.shade([1, 0, 0], -24, -34) > box.shade([0, 0, 1], -24, -34), 'a side turned away is darker');

const js = read('web/cube-box.js');
assert.match(js, /post\(`box:poly:/, 'the window is cut to the outline');
assert.match(js, /post\('box:round'\)/);
assert.match(js, /function setFlat\(on\)/, 'at rest no transform remains');
assert.match(js, /const nav=el\('nav','gd-box-nav'\)/, 'a side bar is always visible');
assert.match(js, /actions:w\?\[\{label:t\('Fetch'\)/, 'the held cube can fetch, pull and push');
assert.doesNotMatch(js, /gd-box-turn/, 'nothing pops up over the scrollbar at the window edge');
const css = read('web/cube-box.css');
assert.match(css, /body\.gd-box-flat \.gd-box-real \{ transform: none !important;/);
assert.match(css, /body\.gd-box-on:not\(\.gd-box-flat\) \.gd-box-real \* \{ -webkit-app-region: no-drag !important;/, 'a moving cube does not drag the window');
const launcher = read('launcher/GitDeckLauncher.cs');
assert.match(launcher, /SetWindowRgn\(Handle, CreatePolygonRgn\(points, points\.Length \/ 2, 2\), true\)/);
assert.match(launcher, /message == "box:off"/);
assert.match(launcher, /Point\? place = ReadBoxPlace\(\);/, 'the cube starts where it was left, without a full-window flash');
assert.match(launcher, /boxSizing \|\| !IsHandleCreated/, 'a resize in progress is not saved as the place');
assert.match(launcher, /boxPlace \?\? new Point/, 'the first start is centred');
assert.match(css, /html\.gd-hosted body\.gd-box-on \.gd-box-nav \{ -webkit-app-region: drag;/, 'the side bar moves the window');
assert.match(launcher, /boxOn && IsHandleCreated && WindowState == FormWindowState\.Maximized\) SetWindowRgn\(Handle, IntPtr\.Zero, true\)/, 'the full window has no cut');
assert.match(read('web/appearance.js'), /const shapes=\['cube','rubik','soft','square'\];const defaultShape='cube';/);
const html = read('web/index.html');
assert(html.includes('<script src="/cube-box.js" defer></script>'));
assert(!fs.existsSync(path.join(__dirname, '..', 'web', 'cube-shell.js')), 'the 3x3 shell is gone');
console.log('PASS: cube box (turn order, outline, shading, window cut, wiring)');
