'use strict';
// Flow UI: next step first, status sentence, plain requests in Ctrl+K, desk zoom, wiring.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const flow = require('../web/flow-ui.js');
assert.deepEqual(flow.nextActions({}), ['fetch'], 'all clean: fetch');
assert.deepEqual(flow.nextActions({ files: 3, behind: 2, ahead: 1 }), ['commit', 'pull', 'push']);
assert.deepEqual(flow.nextActions({ behind: 4 }), ['pull']);
assert.deepEqual(flow.nextActions({ files: 1, conflicts: 2 }), ['commit'], 'conflicts first: finish the merge');

assert.deepEqual(flow.sentence({ branch: 'main', behind: 29 }).map((p) => p.text), ['main', '29 commits to pull']);
assert.deepEqual(flow.sentence({ branch: 'dev', files: 1, ahead: 1 }).map((p) => p.go), ['branches', 'changes', 'push']);
assert.equal(flow.sentence({ branch: 'main', upstream: 'origin/main' })[1].text, 'clean and up to date with origin/main');
assert.equal(flow.sentence({ conflicts: 1 })[1].kind, 'bad');

assert.deepEqual(flow.parseIntent('fetch all in SCB'), { kind: 'fetch-folder', folder: 'scb' });
assert.deepEqual(flow.parseIntent('ดึง ทุก repo ใน InblackM'), { kind: 'fetch-folder', folder: 'inblackm' });
assert.deepEqual(flow.parseIntent('เปิด txi branch AP2365-3320'), { kind: 'open', name: 'txi', ticket: 'AP2365-3320' });
assert.deepEqual(flow.parseIntent('open crs-webview'), { kind: 'open', name: 'crs-webview', ticket: '' });
assert.deepEqual(flow.parseIntent('ไป ประวัติ'), { kind: 'view', view: 'history' });
assert.deepEqual(flow.parseIntent('go branches'), { kind: 'view', view: 'branches' });
assert.deepEqual(flow.parseIntent('ธีม มืด'), { kind: 'theme', theme: 'dark' });
assert.equal(flow.parseIntent('theme rainbow'), null);
assert.equal(flow.parseIntent('commit'), null, 'ordinary palette searches are left alone');

assert(flow.score('txi-svc-customer-request', 'txi customer') > flow.score('src-svc-customer-request-txi', 'txi customer'), 'a name that starts with the words ranks first');
assert.equal(flow.score('gamedb', 'txi'), 0);
assert.equal(flow.zoomBy(1, 100), 0.9);
assert.equal(flow.zoomBy(2, -100), 2, 'at most 2x');
assert.equal(flow.zoomBy(0.3, 100), 0.3, 'at least 0.3x');

const js = read('web/flow-ui.js');
assert.doesNotMatch(js, /[\u0E00-\u0E7F]/, 'Thai words are escaped in the source');
assert.match(js, /const defaults=\{morph:true,sentence:true,zen:true,lens:false,peek:true\};/, 'the focus lens is off unless chosen');
assert.match(js, /runWorkspaceAction\('pull',\{strategy:state\.meta\.pullStrategy\},typeof syncConfirmation==='function'\?syncConfirmation\('pull'\)/, 'pull from the sentence asks first');
assert.match(js, /F\.addPanel\('desks'/);
const css = read('web/flow-ui.css');
assert.match(css, /body\.gd-flow-sentence #workspace-statusbar > :is\(button:has\(#status-branch\), button:has\(#status-changes\), #status-sync, #status-remote\) \{ display: none !important; \}/);
assert.match(css, /:root body\.gd-flow-morph \.modern-actions button\[data-act\]\.gd-next \{/, 'outranks the Rubik action style');
// Button labels never break inside a button: theme menu choices flow to the next row, Flow is a list of switches,
// action rows wrap whole buttons and a settings block takes its own row (Automation).
assert.match(css, /\.theme-menu :is\(\.look-choice, \.text-size-choice\) > button \{ flex: 1 1 auto; white-space: nowrap; min-width: max-content; \}/);
assert.match(css, /\.theme-menu \.flow-choice > button \{ flex: 1 1 100%;/);
const polish = read('web/polish.css');
assert.match(polish, /:is\(\.cockpit-tools, \.fleet-actions, \.operations-card-actions\) > button \{ white-space: nowrap; \}/);
assert.match(polish, /\.operations-card-actions > :not\(button\) \{ flex: 1 1 100%; \}/);
const html = read('web/index.html');
assert(html.includes('<script src="/flow-ui.js" defer></script>'));
assert(html.includes('<link rel="stylesheet" href="/flow-ui.css">'));
console.log('PASS: flow UI (next step, sentence, plain requests, desks, zen/lens/peek wiring)');
