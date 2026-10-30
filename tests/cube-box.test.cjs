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

// Facing a side at the working distance, the outline is exactly the window, whatever its shape.
for (const [W, H] of [[900, 900], [1400, 820]]) {
  const flat = box.hull(box.corners(0, 0, -W / 2, W, H, W, box.PERSPECTIVE * Math.max(W, H), W / 2, H / 2));
  assert.equal(flat.length, 4, 'one face seen: four corners');
  for (const [x, y] of flat) assert(Math.abs(x) < 0.01 || Math.abs(x - W) < 0.01, `x ${x}`), assert(Math.abs(y) < 0.01 || Math.abs(y - H) < 0.01, `y ${y}`);
}
// Held, it is a true cube inside the window at any angle, in a square or a wide window.
for (const [W, H] of [[900, 900], [1400, 820]]) for (const [rx, ry] of [[-24, -34], [-85, 200], [60, 45], [-35, 45]]) {
  const S = Math.min(W, H);
  const outline = box.hull(box.corners(rx, ry, box.fitZ(rx, ry, S, W, H), S, S, S, box.PERSPECTIVE * Math.max(W, H), W / 2, H / 2));
  assert(outline.length >= 4 && outline.length <= 6, `outline of ${outline.length}`);
  for (const [x, y] of outline) assert(x >= 0 && x <= W && y >= 0 && y <= H, `(${x}, ${y}) at ${rx}/${ry} in ${W}x${H}`);
}
assert(box.fitZ(-24, -34, 900) > -2.2 * 900, 'held as close as it fits, large enough to read');
assert.equal(box.shade([0, 0, 1], 0, 0), 0, 'the side facing you is not darkened');
assert(box.shade([1, 0, 0], -24, -34) > box.shade([0, 0, 1], -24, -34), 'a side turned away is darker');

const js = read('web/cube-box.js');
assert.match(js, /post\(`box:poly:/, 'the window is cut to the outline');
assert.match(js, /post\('box:round'\)/);
assert.match(js, /function setFlat\(on\)/, 'at rest no transform remains');
assert.match(js, /const nav=el\('nav','gd-box-nav'\)/, 'a side bar is always visible');
assert.match(js, /actions:w\?\[\{label:t\('Fetch'\)/, 'the held cube can fetch, pull and push');
assert.doesNotMatch(js, /gd-box-turn/, 'nothing pops up over the scrollbar at the window edge');
assert.match(js, /const grips=Object\.entries\(\{n:12,s:15,w:10,e:11,nw:13,ne:14,sw:16,se:17\}\)/, 'every edge and corner resizes');
const css = read('web/cube-box.css');
assert.match(css, /body\.gd-box-flat \.gd-box-real \{ transform: none !important;/);
assert.match(css, /body\.gd-box-on:not\(\.gd-box-flat\) \.gd-box-real \* \{ -webkit-app-region: no-drag !important;/, 'a moving cube does not drag the window');
const launcher = read('launcher/GitDeckLauncher.cs');
assert.match(launcher, /SetWindowRgn\(Handle, CreatePolygonRgn\(points, points\.Length \/ 2, 2\), true\)/);
assert.match(launcher, /message == "box:off"/);
assert.match(launcher, /boxBounds = ReadBoxBounds\(\);/, 'it starts where and as big as it was left, without a full-window flash');
assert.match(launcher, /message\.StartsWith\(\"box:size:\"/, 'edges and corners hand the press to Windows to resize');
assert.match(launcher, /Place\(boxBounds \?\? FirstBounds\(\)\)/, 'the first start has a useful size');
assert.match(js, /event\.target===nav&&event\.button===0&&!maxed\)\{event\.preventDefault\(\);post\('box:drag'\)/, 'the empty part of the side bar moves the window');
assert.match(launcher, /if \(WindowState == FormWindowState\.Maximized\) SetWindowRgn\(Handle, IntPtr\.Zero, true\);/, 'a maximized window has no cut');
assert.match(read('web/appearance.js'), /const shapes=\['cube','rubik','soft','square'\];const defaultShape='cube';/);
const html = read('web/index.html');
assert(html.includes('<script src="/cube-box.js" defer></script>'));
assert(!fs.existsSync(path.join(__dirname, '..', 'web', 'cube-shell.js')), 'the 3x3 shell is gone');
console.log('PASS: cube box (turn order, outline, shading, window cut, wiring)');
