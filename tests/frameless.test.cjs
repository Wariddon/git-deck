'use strict';
// Frameless window: GitDeck.exe hosts the page in WebView2 without a title bar, falls back to the Edge
// app window, builds and packages the WebView2 files; the page draws the window buttons and drag areas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.t = (text) => text;
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const frame = require('../web/window-frame.js');
assert.deepEqual(frame.actions, { minimize: 'window:minimize', maximize: 'window:maximize', close: 'window:close' });
assert.equal(frame.stateFrom('window:maximized'), 'maximized');
assert.equal(frame.stateFrom('window:restored'), 'restored');
assert.equal(frame.stateFrom('anything else'), '');

const launcher = read('launcher/GitDeckLauncher.cs');
for (const message of ['window:minimize', 'window:maximize', 'window:close', 'window:state', 'window:maximized', 'window:restored']) assert(launcher.includes(`"${message}"`), `launcher handles ${message}`);
assert.match(launcher, /if \(Hosted\.Available\(AppDomain\.CurrentDomain\.BaseDirectory\)\) \{ hostedUrl = url; return null; \}/, 'frameless only when available');
assert.match(launcher, /bool appWindow = OpenAppWindow\(args\);/, 'Edge app window stays the fallback');
assert.match(launcher, /m\.Msg == WM_NCCALCSIZE && m\.WParam != IntPtr\.Zero/, 'title bar removed, borders kept');
assert.match(launcher, /IsNonClientRegionSupportEnabled = true/, 'page areas can move the window');
assert.match(launcher, /core\.NavigationStarting \+= \(s, a\) => \{ if \(!Local\(a\.Uri\)\) \{ a\.Cancel = true; OpenOutside\(a\.Uri\); \} \};/, 'other sites open in the browser');
assert.match(launcher, /parsed\.Scheme != Uri\.UriSchemeHttp && parsed\.Scheme != Uri\.UriSchemeHttps && parsed\.Scheme != Uri\.UriSchemeMailto/, 'only web and mail links leave the app');
assert.match(launcher, /MethodImplOptions\.NoInlining\)\]\s*private static string RuntimeVersion/, 'missing WebView2 files cannot stop the launcher');

const build = read('Build-GitDeck.ps1');
assert.match(build, /\/reference:\$\(Join-Path \$webview 'Microsoft\.Web\.WebView2\.Core\.dll'\)/);
for (const file of ['Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll', 'LICENSE.txt']) assert(fs.existsSync(path.join(__dirname, '..', 'launcher', 'webview2', file)), `launcher/webview2/${file}`);
assert.match(read('.gitignore'), /^\/Microsoft\.Web\.WebView2\.\*\.dll$/m);
assert.match(read('.gitignore'), /^\/WebView2Loader\.dll$/m);
assert.match(read('launcher/Ensure-GitDeckExe.ps1'), /WebView2Loader\.dll/, 'rebuilt when the WebView2 files are missing');
assert.match(read('Build-Release.ps1'), /'Microsoft\.Web\.WebView2\.Core\.dll','Microsoft\.Web\.WebView2\.WinForms\.dll','WebView2Loader\.dll'/, 'packaged');

const css = read('web/soft.css');
assert.match(css, /html\.gd-hosted :is\(\.repo-tabs[^)]*\) \{ -webkit-app-region: drag; app-region: drag; \}/);
assert.match(css, /:is\(button, a, input[^)]*\) \{ -webkit-app-region: no-drag; app-region: no-drag; \}/);
assert(read('web/index.html').includes('<script src="/window-frame.js" defer></script>'));
const reveal = require('../web/window-frame.js');
assert.equal(reveal.revealBy(100, 200, 50, 300), 0, 'already visible');
assert.equal(reveal.revealBy(250, 350, 50, 300), 50, 'hidden under the pinned buttons on the right');
assert.equal(reveal.revealBy(10, 90, 50, 300), -40, 'hidden on the left');
assert.equal(reveal.revealBy(0, 500, 50, 300), -50, 'wider than the space: show its start');
const polish = read('web/polish.css');
assert.match(polish, /\.gd-ticket-chip\[hidden\] \{ display: none; \}/, 'a hidden chip draws nothing');
assert.match(polish, /\.modern-rail \{ overflow: hidden auto;/, 'the rail scrolls instead of squeezing');
assert.match(polish, /#workspace-statusbar > \.status-spacer \{[^}]*background: transparent !important/, 'the gap is not a button');
assert.match(polish, /@media \(max-width: 760px\) \{\s+html\.ui-modern body \.workspace-modal-head \{ grid-template-rows: auto auto !important;/, 'the second toolbar row grows instead of covering the rail');
assert.match(polish, /\.modern-history-head \{ flex-direction: row !important;/, 'no blank block above the commit list');
assert.match(read('web/window-frame.js'), /splash&&splash\.open\?splash/, 'the start-up screen has window buttons too');
assert.match(polish, /html\.gd-hosted #repo-tabs > \.gd-window-controls \{ position: sticky; right: 0;/, 'the window buttons stay in reach when the tabs overflow');
assert.match(polish, /html\.gd-hosted #repo-tabs > \.repo-tab-add \{ right: var\(--gd-win-w\); \}/, 'the pinned tab buttons make room for them');
console.log('PASS: frameless window (WebView2 host, fallback, build and package, window buttons and drag areas)');

// Scrolling in the top bar: the wheel scrolls the tab row and action bar sideways; scroll boxes are no-drag.
{
  const frame = require('../web/window-frame.js');
  const box = { scrollWidth: 900, clientWidth: 600, scrollLeft: 250 };
  assert.equal(frame.sideways(0, 100, box), 50, 'stops at the end');
  assert.equal(frame.sideways(0, -100, { ...box, scrollLeft: 30 }), -30, 'stops at the start');
  assert.equal(frame.sideways(80, 10, box), 0, 'a sideways swipe scrolls on its own');
  assert.equal(frame.sideways(0, 100, { scrollWidth: 600, clientWidth: 600, scrollLeft: 0 }), 0, 'nothing to scroll');
  const softCss = fs.readFileSync(path.join(__dirname, '..', 'web', 'soft.css'), 'utf8');
  assert.match(softCss, /html\.gd-hosted \.gd-scrolls, html\.gd-hosted \.gd-scrolls \* \{ -webkit-app-region: no-drag; app-region: no-drag; \}/);
  console.log('PASS: top bar scrolling (wheel sideways, scroll boxes are no-drag)');
}
