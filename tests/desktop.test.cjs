'use strict';
// Desktop powers and the cube room: launcher commands, tray, hotkey, taskbar number and Jump List;
// sticker sets; the cube's side faces.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.t = (text, vars) => String(text).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const bridge = require('../web/desktop-bridge.js');
assert.deepEqual(bridge.parseCommand('palette:open'), { kind: 'do', task: 'palette' });
assert.deepEqual(bridge.parseCommand('do:day-close'), { kind: 'do', task: 'day-close' });
assert.equal(bridge.parseCommand('do:format-disk'), null, 'only known tasks');
assert.deepEqual(bridge.parseCommand('open:C:/SCB/crs-webview'), { kind: 'open', path: 'C:/SCB/crs-webview' });
assert.equal(bridge.parseCommand('open:'), null);
assert.equal(bridge.jumpLines([{ name: 'a\tb', path: 'C:/x\n' }, { name: 'c', path: '' }]), 'a b\tC:/x', 'names and paths cannot break the lines');

const launcher = read('launcher/GitDeckLauncher.cs');
assert.match(launcher, /RegisterHotKey\(Handle, 1, 0x0008 \| 0x0004 \| 0x4000, 0x47\)/, 'Win+Shift+G');
assert.match(launcher, /RegisterHotKey\(Handle, 1, 0x0002 \| 0x0001 \| 0x4000, 0x47\)/, 'Ctrl+Alt+G when Windows has Win+Shift+G');
assert.match(launcher, /if \(m\.Msg == 0x004A\)/, 'commands from another GitDeck.exe');
assert.match(launcher, /data\.Data == \(IntPtr\)0x47444B/, 'only Git Deck commands are accepted');
assert.match(launcher, /private static readonly string\[\] Actions = \{ "today", "mini", "day-close", "dashboard", "palette" \};/);
assert.match(launcher, /menu\.Items\.Add\("Quit Git Deck"/, 'tray Quit');
assert.match(launcher, /a\.Cancel = true; Hide\(\);/, 'closing keeps it in the tray');
assert.match(launcher, /taskbar\.SetOverlayIcon\(window, next/, 'taskbar number');
assert.match(launcher, /list\.AppendCategory\("Recent repositories"/, 'Jump List recent repositories');
assert.match(launcher, /Link\(exe, "--do today", "Today"\)/, 'Jump List tasks');
assert.match(launcher, /!Directory\.Exists\(parts\[1\]\)/, 'only existing folders in the Jump List');

const room = require('../web/cube-room.js');
const e = room.edges({ left: 100, top: 50, width: 300, height: 200 }, 10);
assert.deepEqual(e.top, [[100, 50], [110, 40], [410, 40], [400, 50]]);
assert.deepEqual(e.right, [[400, 50], [410, 40], [410, 240], [400, 250]]);
assert.equal(room.isColor('#0b6e47'), true); assert.equal(room.isColor('red'), false);

const appearance = read('web/appearance.js');
assert.match(appearance, /const stickerSets=\['classic','neon','pastel','mono','songkran','newyear','custom'\];const defaultStickers='classic';/);
const css = read('web/rubik.css');
for (const set of ['neon', 'pastel', 'mono', 'songkran', 'newyear']) assert.match(css, new RegExp(`html\.gd-rubik\.gd-st-${set} \{ --st-red:`), set);
assert.match(css, /\[data-tab="changes"\] svg \{ color: var\(--st-red\); \}/, 'rail follows the sticker set');
assert.match(read('web/rubik.js'), /var\(--st-\$\{faceSlots\[view\]\}, \$\{faceColor\(view\)\}\)/);
const html = read('web/index.html');
for (const name of ['desktop-bridge.js', 'cube-room.js']) assert(html.includes(`<script src="/${name}" defer></script>`), name);
console.log('PASS: desktop commands, tray, hotkey, taskbar number, Jump List, sticker sets, cube room edges');
