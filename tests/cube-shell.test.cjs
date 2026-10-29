'use strict';
// The living cube: the window is the cube's front face (grooves), the top and right faces recede in 3D,
// views change by twisting slices, Git moves twist, zoom-out cube, wiring.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const cube = require('../web/cube-shell.js');
assert.equal(cube.nextView('changes'), 'history');
assert.equal(cube.nextView('compare'), 'changes', 'round the cube');
assert.equal(cube.nextView('settings'), 'history', 'a view that is not a face counts as the first');
assert.deepEqual(cube.movesFor('commit'), [['row', 1, 'y', -1]], 'a commit turns the middle row');
assert.deepEqual(cube.movesFor('pull-ref'), [['row', 0, 'x', 1]], 'a pull turns the top row down');
assert.deepEqual(cube.movesFor('push'), [['row', 0, 'x', -1]]);
assert.equal(cube.movesFor('merge').length, 2, 'a merge turns both side columns');
assert.deepEqual(cube.movesFor('fetch'), [], 'not every action is a twist');
assert.equal(cube.slice('row', 0), 'inset(0.000% 0 66.667% 0)');
assert.equal(cube.slice('col', 2), 'inset(0 0.000% 0 66.667%)');

const js = read('web/cube-shell.js');
assert.doesNotMatch(js, /[฀-๿]/);
assert.match(js, /const on=\(\)=>layout==='cube'&&root\.classList\.contains\('gd-rubik'\)/, 'only with the Rubik shape');
assert.match(js, /if\(result&&on\(\)\)twistSlices\(movesFor\(action\),'round'\)/, 'a move plays only after the action succeeded');
assert.match(js, /copy\.querySelectorAll\('\[id\]'\)\.forEach\(node=>node\.removeAttribute\('id'\)\)/, 'slice copies carry no duplicate ids');
assert.match(read('web/rubik.js'), /document\.body\.classList\.contains\('gd-living'\)\)return update\(\);/, 'the flat Rubik turn steps aside for the living cube');
const css = read('web/cube-shell.css');
assert.doesNotMatch(css, /\.grid \{[^}]*perspective:/, 'no perspective on the page grid (it would trap fixed popups)');
assert.match(css, /\.gd-lc-top \{[^}]*perspective\(1600px\)[^}]*rotateX\(90deg\)/, 'the top face carries its own perspective');
assert.match(css, /\.gd-lc-right \{[^}]*perspective\(1600px\)[^}]*rotateY\(90deg\)/);
assert.match(css, /body\.gd-living \.gd-cube-edge \{ display: none !important; \}/);
const html = read('web/index.html');
assert(html.includes('<script src="/cube-shell.js" defer></script>'));
assert(html.includes('<link rel="stylesheet" href="/cube-shell.css">'));
console.log('PASS: living cube (front face grooves, 3D side faces, slice twists, git moves, zoom-out, wiring)');
