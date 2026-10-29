'use strict';
// Cube home: a real 3x3x3 cube (quarter turns, moves, solving back), drag-to-twist choice, doors, wiring.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const cube = require('../web/cube-shell.js');
assert.deepEqual(cube.rotate('x', 1, [0, 1, 0]), [0, 0, 1], 'CSS rotateX(+90deg): down turns towards you');
assert.deepEqual(cube.rotate('y', 1, [1, 0, 0]), [0, 0, -1]);
assert.deepEqual(cube.rotate('z', 1, [1, 0, 0]), [0, 1, 0]);
let pieces = cube.solved();
assert.equal(pieces.length, 26, 'every visible piece of a 3x3x3 cube');
assert(cube.isSolved(pieces));
const sequence = ['R', "U'", 'F', 'L', "D'", 'B'];
for (const move of sequence) pieces = cube.apply(pieces, move);
assert(!cube.isSolved(pieces), 'six twists scramble it');
assert.equal(new Set(pieces.map((p) => p.pos.join())).size, 26, 'no two pieces in one place');
for (const move of [...sequence].reverse()) pieces = cube.apply(pieces, cube.inverse(move));
assert(cube.isSolved(pieces), 'the inverse moves solve it again');
let four = cube.solved();
for (let i = 0; i < 4; i++) four = cube.apply(four, 'U');
assert(cube.isSolved(four), 'four quarter turns come back home');
const centres = cube.apply(cube.solved(), 'F').filter((p) => p.home.filter((v) => v).length === 1);
assert(centres.every((p) => p.pos.join() === p.home.join()), 'outer twists never move a centre: every door stays on its face');
assert.equal(cube.inverse("R'"), 'R');

// Drag across the front face's top-right sticker, looking straight on: a sideways drag turns the top row (y).
const flat = (v) => [v[0], v[1]];
const sideways = cube.pickTwist([1, -1, 1], [0, 0, 1], [1, 0], flat);
assert.equal(sideways.axis, 'y'); assert.equal(sideways.layer, -1);
const downwards = cube.pickTwist([1, -1, 1], [0, 0, 1], [0, 1], flat);
assert.equal(downwards.axis, 'x'); assert.equal(downwards.layer, 1);
assert.equal(cube.pickTwist([0, 0, 1], [0, 0, 1], [1, 0], flat), null, 'a drag on a door does not twist the middle layers');

const js = read('web/cube-shell.js');
assert.doesNotMatch(js, /[฀-๿]/);
assert.match(js, /const on=\(\)=>layout==='cube'&&root\.classList\.contains\('gd-rubik'\)/, 'only with the Rubik shape');
assert.match(js, /if\(on\(\)\)show\(\);/, 'Git Deck opens as the cube');
assert.match(js, /const expand=button\(t\('Expand'\)/, 'Expand goes back to the full window');
assert.match(js, /backButton\.title=t\('Shrink to the cube \(Esc\)'\)/);
assert.match(read('web/entrance.js'), /const mode=\(\)=>cubeHome\(\)\?'off'/, 'no opening animation on top of the cube');
const css = read('web/cube-shell.css');
assert.match(css, /\.gd-piece \{[^}]*transform-style: preserve-3d;/);
assert.match(read('web/rubik.css'), /:not\(\.gd-home \*\) \{/, 'the cube home keeps its own buttons');
const html = read('web/index.html');
assert(html.includes('<script src="/cube-shell.js" defer></script>'));
assert(html.includes('<link rel="stylesheet" href="/cube-shell.css">'));
console.log('PASS: cube home (real 3x3x3 turns, solve back, drag-to-twist, doors, expand/shrink, wiring)');
