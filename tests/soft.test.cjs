'use strict';
// Soft shape, sliding highlight, openings and greeting: pure helpers, settings and wiring.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.t = (text, vars) => String(text).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));
const web = (name) => fs.readFileSync(path.join(__dirname, '..', 'web', name), 'utf8');

// Sliding highlight: the stretch covers the old and the new item.
const soft = require('../web/soft.js');
assert.deepEqual(soft.union({ left: 0, top: 100, width: 60, height: 40 }, { left: 0, top: 10, width: 60, height: 40 }), { left: 0, top: 10, width: 60, height: 130 });
assert.deepEqual(soft.union(null, { left: 5, top: 5, width: 1, height: 1 }), { left: 5, top: 5, width: 1, height: 1 });

// Openings: time of day, greeting and star clusters.
const entrance = require('../web/entrance.js');
assert.deepEqual([4, 5, 11, 12, 16, 17, 21, 22].map(entrance.daypart), ['night', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'night']);
assert.equal(entrance.greeting('morning', 'Wariddon Rattanamalee'), 'Good morning, Wariddon');
assert.equal(entrance.greeting('night', ''), 'Working late');
// Cube: each face one colour; one red or amber sticker per repository that needs you, never on the mark.
const solved = entrance.cubeStickers([]);
for (const [face, color] of Object.entries(entrance.cubeColors)) assert.deepEqual(solved[face], Array(9).fill(color), face);
const marked = entrance.cubeStickers(['storm', 'rain', 'sun', 'cloud', 'storm']);
const all = Object.values(marked).flat();
assert.equal(all.filter((c) => c === '#f85149').length, 2, 'two storms');
assert.equal(all.filter((c) => c === '#f2b84b').length, 1, 'one rain');
assert.equal(marked.front[4], entrance.cubeColors.front, 'the Git Deck mark stays green');
assert.equal(Object.values(entrance.cubeStickers(Array(40).fill('storm'))).flat().filter((c) => c === '#f85149').length, 16, 'at most 16 marks');
const sky = entrance.constellation(['crs-a', 'crs-b', 'crs-c', 'lns-a', 'hiring'], 800, 600);
assert.equal(sky.stars.length, 5);
assert.deepEqual(sky.labels.map((l) => l.family), ['crs-', 'lns-', '·']);
for (const star of sky.stars) assert(star.x > 0 && star.x < 800 && star.y > 0 && star.y < 600, `${star.name} on screen`);
const crs = sky.stars.filter((s) => s.family === 'crs-'); const lns = sky.stars.find((s) => s.family === 'lns-');
assert(Math.hypot(crs[0].x - crs[1].x, crs[0].y - crs[1].y) < Math.hypot(crs[0].x - lns.x, crs[0].y - lns.y), 'a family stays together');

// Settings: Shape (Soft default) and Opening (Logo default) in the Appearance menu.
const appearance = web('appearance.js');
assert.match(appearance, /const shapes=\['rubik','soft','square'\];const defaultShape='rubik';/);
assert.match(appearance, /const openings=\['cube','logo','stars','command','off'\];const defaultOpening='cube';/);
assert.match(appearance, /root\.classList\.toggle\('gd-soft',shape==='soft'\|\|shape==='rubik'\)/);
assert.match(appearance, /label:t\('Preview'\).*GitDeckEntrance\?\.preview\?\.\(\)/, 'Opening has a Preview');
assert.match(web('entrance.js'), /function preview\(chosen=mode\(\)\)/);
assert.match(web('mini.css'), /corner-shape: squircle/, 'Mini mode shares the soft corners');

// Every Soft rule needs html.gd-soft (Square keeps the old look), and motion respects reduced motion.
const css = web('soft.css');
const rules = css.split('\n').filter((line) => /^html\.[^{]*\{/.test(line));
for (const line of rules) assert(/gd-soft|data-daypart|gd-hosted/.test(line), `scoped: ${line.slice(0, 70)}`);
assert.match(css, /@supports \(corner-shape: squircle\)/);
// Consistency pass: the highlight is anchored at the container origin; no stripe borders on rounded tone
// cards (an inner shadow follows the corner); flat Dashboard menu; one floating shadow.
assert.match(css, /\.gd-liquid \{ position: absolute; top: 0; left: 0;/);
assert.match(css, /:is\(\.gd-card, \.forecast-card[^)]*\) \{\s*border-left-width: 0 !important; box-shadow: inset 3px 0 0 var\(--tone/);
assert.match(css, /\.operations-tabs button \{ border: 0 !important; background: transparent !important;/);
assert.match(css, /\.modern-rail-item::before \{ display: none !important; \}/);
assert.doesNotMatch(web('soft.js'), /repo-tabs/, 'tabs keep their own marker');
assert.match(css, /prefers-reduced-motion: reduce\) \{ \.gd-liquid/);
assert.match(web('entrance.js'), /still\(\)/);

// Wiring: stylesheet last, opening right after the splash controller, highlight deferred.
const html = web('index.html');
assert(html.indexOf('href="/soft.css"') > html.indexOf('href="/ux.css"'), 'soft.css after ux.css');
assert.match(html, /<script id="startup-controller" src="\/startup\.js"><\/script>\n  <script src="\/entrance\.js"><\/script>/);
assert(html.includes('<script src="/soft.js" defer></script>'));
assert.match(web('weather.js'), /window\.GitDeckWeather=helpers;/);
console.log('PASS: soft shape scoping, sliding highlight, openings (time of day, greeting, stars) and settings');
