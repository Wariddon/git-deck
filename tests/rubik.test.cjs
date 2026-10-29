'use strict';
// Rubik shape: which way the cube turns, sticker colours per view, the turn's safety rules and wiring.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const rubik = require('../web/rubik.js');
const order = ['changes', 'history', 'branches', 'stashes', 'tags'];
assert.equal(rubik.direction(order, 'changes', 'branches'), 'next', 'later in the menu comes in from the right');
assert.equal(rubik.direction(order, 'tags', 'history'), 'prev');
assert.equal(rubik.direction(order, 'history', 'history'), 'next');
assert.equal(rubik.direction(order, 'unknown', 'history'), 'next');
assert.equal(rubik.faceColor('changes'), '#e5534b');
assert.equal(rubik.faceColor('history'), '#2f81f7');
assert.equal(rubik.faceColor('something-else'), '#6e7781');

const js = read('web/rubik.js');
for (const fn of ['selectWorkspaceTab', 'openWorkspace', 'switchOperationsView', 'showOperationsCenter', 'hideOperationsCenter', 'applyAppearance'])
  assert.match(js, new RegExp(`${fn}=function`), `${fn} goes through the cube`);
assert.match(js, /if\(!rubik\(\)\|\|still\(\)\|\|!canTurn\(\)\|\|turning\|\|!old\|\|!old\.offsetParent\)return update\(\);/, 'no turn without Rubik, with reduced motion, without View Transitions or while turning');
assert.match(js, /transition\.skipTransition\(\)/, 'a window that is not painting switches at once');
assert.match(js, /if\(waiting\(\)\)return pending\.then\(\(\)=>selectWorkspaceTab\(tab,\.\.\.rest\)\);/, 'switches during a turn wait for it');
assert.match(js, /document\.body\.classList\.add\('theme-dark','theme-focus'\)/, 'Rubik keeps the dark plastic palette');

const css = read('web/rubik.css');
for (const way of ['next', 'prev', 'up', 'down']) {
  assert.match(css, new RegExp(`\\[data-turn="${way}"\\]::view-transition-old\\(gd-face\\) \\{ animation-name: gd-face-out-${way}; \\}`));
  assert.match(css, new RegExp(`@keyframes gd-face-in-${way}`));
}
assert.match(css, /prefers-reduced-motion: reduce\) \{ html\.gd-rubik::view-transition-old\(gd-face\)/);
for (const line of css.split('\n').filter((l) => /^html[.:[]/.test(l))) assert(/gd-rubik/.test(line), `scoped to Rubik: ${line.slice(0, 60)}`);

const appearance = read('web/appearance.js');
assert.match(appearance, /const shapes=\['rubik','soft','square'\];const defaultShape='rubik';/);
assert.match(appearance, /root\.classList\.toggle\('gd-rubik',shape==='rubik'\)/);
const html = read('web/index.html');
assert(html.indexOf('href="/rubik.css"') > html.indexOf('href="/soft.css"'), 'rubik.css after soft.css');
assert(html.includes('<script src="/rubik.js" defer></script>'));
console.log('PASS: Rubik shape (turn direction, sticker colours, safe turns, dark plastic, wiring)');
