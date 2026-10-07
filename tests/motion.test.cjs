const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');

// Loading feedback: a top bar while waiting for the server, never for background polls,
// and it always goes away again (even when a request fails).
const node = () => ({ id: '', className: '', dataset: {}, isConnected: true, children: [], classList: { add() {}, remove() {}, contains: () => false }, setAttribute() {}, append() {}, hasAttribute: () => false });
const calls = [];
const context = {
  setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {}, Promise,
  MutationObserver: class { observe() {} },
  api: async (p) => { calls.push(p); if (p === '/api/fail') throw new Error('boom'); return { ok: true }; },
};
const bar = node(); const classes = new Set();
bar.classList = { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), contains: (c) => classes.has(c) };
context.document = { body: node(), createElement: (tag) => (tag === 'div' && !bar.created ? Object.assign(bar, { created: true }) : node()), getElementById: () => null, addEventListener() {} };
context.window = context;
vm.runInNewContext(web('motion.js'), context);
const motion = context.GitDeckMotion;
assert.ok(motion.isQuiet('/api/version'), 'Update check is background');
assert.ok(motion.isQuiet('/api/jobs'), 'Job queue polling is background');
assert.ok(motion.isQuiet('/api/action', { body: '{"action":"ui-state-save"}' }), 'Saving UI state is background');
assert.ok(!motion.isQuiet('/api/repo/pending?path=x'));

(async () => {
  await context.api('/api/repo/pending?path=x');
  assert.ok(!classes.has('on') || classes.has('done'), 'Bar finishes after the request');
  await assert.rejects(context.api('/api/fail'));
  assert.ok(!classes.has('on') || classes.has('done'), 'A failed request also ends the bar');
  await context.api('/api/version');
  assert.deepEqual(calls, ['/api/repo/pending?path=x', '/api/fail', '/api/version']);

  assert.ok(web('index.html').includes('<link rel="stylesheet" href="/motion.css">'));
  assert.ok(web('index.html').includes('<script src="/motion.js" defer></script>'));
  assert.ok(web('motion.css').includes('@media (prefers-reduced-motion: reduce)'), 'Motion respects reduced motion');
  // The Dashboard shows placeholder rows and a progress meter while checking; rows fade in once.
  assert.match(web('multi-repo.js'), /if\(checking&&!results\.length\)\{out\.replaceChildren\(skeleton\(/);
  assert.match(web('multi-repo.js'), /if\(!seenRows\.has\(key\)\)\{seenRows\.add\(key\);tr\.classList\.add\('gd-enter'\);\}/);
  console.log('PASS: loading bar, skeletons and motion');
})().catch((error) => { console.error(error); process.exit(1); });

// Finishing touches: slim scrollbars, branch filters that wrap instead of "Overvi...", dialogs above a blurred page.
{
  const polish = web('polish.css');
  assert.match(polish, /::-webkit-scrollbar-button \{ display: none/, 'No arrow buttons on scrollbars');
  assert.match(polish, /\.ref-filter-tabs \{ display: grid !important; grid-template-columns: repeat\(auto-fit, minmax\(62px, 1fr\)\)/, 'Branch filters wrap instead of truncating');
  assert.match(polish, /\.backdrop:not\(\.hidden\):not\(#operations-backdrop\) \{[^}]*backdrop-filter: blur/, 'Dialogs blur the page behind them');
  assert.match(polish, /\.commit-action-block \{ display: flex !important; flex-direction: row !important; flex-wrap: wrap;/, 'Commit note under the button takes one line');
  assert.match(polish, /\.commit-assist \.recent-messages \{[^}]*max-width: 100%/, 'Recent messages stays inside the commit box');
  assert.match(polish, /:is\(\.search, \.repo-switcher-search, \.tree-search, \.operations-search, \.command-palette-search, #gd-framed-field\) input \{ border-color: transparent !important; box-shadow: none !important; \}/, 'Framed search boxes glow as a whole, not a box inside a box');
  assert.match(web('app.js'), /node\.closest\('\.workspace-row'\)\?\.classList\.toggle\('selected',node===label\)/, 'The open stash is marked');
  assert.match(polish, /\.stash-layout \.workspace-row\.selected,/, 'The open stash is highlighted');
  // Readiness check: one row per check with its own classes (readiness-row belongs to Compare/Push checks).
  assert.match(web('release-ui.js'), /el\('div','gd-check-row '\+\(ok\?'is-ok':optional\?'is-optional':'is-warn'\)\)/, 'Readiness rows carry their status');
  assert.ok(!/readiness-row/.test(web('release-ui.js')), 'Readiness dialog does not reuse the Compare/Push row class');
  assert.match(polish, /\.gd-check-row\.is-ok \.gd-check-mark \{/, 'Ready checks get a green mark');
  // Repository list header: Theme, Help, Operations, Refresh and the search box share the theme surfaces.
  assert.match(polish, /\.workspace > header :is\(\.theme-picker > summary, \.help-menu > summary, \.btn\) \{[^}]*background: var\(--surface\) !important;/, 'Header buttons use the theme surface');
  assert.match(polish, /\.workspace > header \.search kbd \{[^}]*background: var\(--surface-subtle\) !important;/, 'Ctrl K key follows the theme');
  // Dark themes: the history View popover is no longer white; its checkboxes are not stretched to 70px.
  assert.match(polish, /body\.theme-dark \.history-options-body \{[^}]*background: var\(--surface\) !important;/, 'View popover follows the dark surface');
  assert.match(web('modern.css'), /\.history-controls input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\) \{ min-width: 70px !important; \}/, 'Search min-width does not stretch checkboxes');
  // Repository list page: no leftover alerts without an open repository; cards stack branch/status below.
  assert.match(polish, /body:not\(\.workbench-mode\) \.repo-alerts \{ display: none !important; \}/, 'Alerts hide when no repository is open');
  assert.match(polish, /#repo-list \.repo > :is\(\.repo-main, \.repo-meta\) \{ grid-column: 1 \/ -1 !important;/, 'Repository card rows span the card');
  // Dashboard table: small lines wrap inside their cell instead of running into the next column.
  assert.match(polish, /\.multi-repo-table\.pending-table td small \{ white-space: normal !important;/, 'Small lines wrap in Dashboard cells');
  console.log('PASS: polish layer');
}
