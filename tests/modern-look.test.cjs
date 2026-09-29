const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');

// Classic look: modern.js loads but adds nothing.
const context = {
  t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => k in vars ? String(vars[k]) : m),
  state: { workspace: null, workspaceRepo: null, workspaceTab: 'history' },
  selectWorkspaceTab: () => {}, renderWorkspaceStatus: () => {}, workspaceEmpty: () => ({ prepend() { throw new Error('Classic must not be decorated'); }, append() {} }),
  document: { readyState: 'complete', documentElement: { classList: { contains: () => false } }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} },
  setTimeout, setInterval: () => 0,
};
context.window = context;
vm.runInNewContext(web('icons.js'), context);
vm.runInNewContext(web('modern.js'), context);
const modern = context.GitDeckModern;
assert.ok(modern, 'modern.js exposes its pure helpers');
context.workspaceEmpty('No stashes', '');

// Smart primary action: conflicts > commit staged > review > pull > push > publish > fetch.
const kind = (data) => modern.primaryAction(data).kind;
const base = { branch: 'main', files: [], sync: { upstream: 'origin/main', ahead: 0, behind: 0 }, remotes: [{ name: 'origin' }] };
assert.equal(modern.primaryAction(null), null);
assert.equal(kind(base), 'fetch');
assert.equal(kind({ ...base, sync: { ...base.sync, ahead: 2 } }), 'push');
assert.equal(modern.primaryAction({ ...base, sync: { ...base.sync, ahead: 2 } }).label, 'Push 2');
assert.equal(kind({ ...base, sync: { ...base.sync, ahead: 2, behind: 1 } }), 'pull', 'Pull before push when diverged');
assert.equal(kind({ ...base, files: [{ staged: false }] }), 'review');
assert.equal(modern.primaryAction({ ...base, files: [{ staged: true }, { staged: false }] }).label, 'Commit 1');
assert.equal(kind({ ...base, files: [{ staged: true }], operation: { active: true, conflicts: ['a.txt'] } }), 'conflicts');
assert.equal(kind({ ...base, sync: {} }), 'push', 'A branch without upstream offers Publish');
assert.equal(modern.primaryAction({ ...base, sync: {} }).label, 'Publish branch');
assert.equal(kind({ ...base, sync: {}, remotes: [] }), 'fetch', 'No remote: nothing to publish');

// Relative time, initials, ref chip kinds.
const now = Date.parse('2026-09-29T12:00:00Z');
const ago = (seconds) => modern.relativeTime(new Date(now - seconds * 1000), now);
assert.equal(ago(20), 'just now');
assert.equal(ago(5 * 60), '5m ago');
assert.equal(ago(3 * 3600), '3h ago');
assert.equal(ago(2 * 86400), '2d ago');
assert.equal(ago(90 * 86400), '3mo ago');
assert.equal(ago(800 * 86400), '2y ago');
assert.equal(modern.initials('Wariddon Rattanamalee'), 'WR');
assert.equal(modern.initials('dev'), 'D');
assert.equal(modern.initials('first.last'), 'FL');
context.state.workspace = { remotes: [{ name: 'origin' }] };
assert.equal(modern.refKind('HEAD -> main'), 'head');
assert.equal(modern.refKind('tag: v1.0'), 'tag');
assert.equal(modern.refKind('origin/main'), 'remote');
assert.equal(modern.refKind('feature/login'), 'local', 'A slash alone does not make a ref remote');
assert.equal(modern.refKind('refs/stash'), 'stash');

// Icons are local, stroke-only and cover everything modern.js asks for.
const names = new Set(context.GitDeckIcons.names);
for (const [, name] of web('modern.js').matchAll(/icon\('([a-z]+)'/g)) assert(names.has(name), `icon ${name} exists`);
for (const [, name] of web('modern.js').matchAll(/\['[a-z-]+','([a-z]+)',/g)) assert(names.has(name), `rail icon ${name} exists`);
assert.doesNotMatch(web('icons.js').replaceAll('http://www.w3.org/2000/svg', ''), /https?:\/\//, 'icons are bundled, never fetched');

// Wiring: loaded after the add-ons it wraps; history rows carry a machine-readable time.
const html = web('index.html');
assert(html.indexOf('/icons.js') < html.indexOf('/modern.js'));
assert(html.indexOf('/clean-layout.js') < html.indexOf('/modern.js'));
assert.match(web('app.js'), /if\(item\.time\)date\.dateTime=new Date\(item\.time\*1000\)\.toISOString\(\);/);
assert.match(fs.readFileSync(path.join(__dirname, '../git-dashboard-server.ps1'), 'utf8'), /%D%x1f%at'\)/);
// Everything added is marked for removal when switching to Classic.
assert.match(web('modern.js'), /function teardown\(\)\{closePopover\(\);restoreToolbar\(\);.*document\.querySelectorAll\('\.modern-made'\)\.forEach\(node=>node\.remove\(\)\)/);
// One sync button (GitHub Desktop pattern): its label follows the branch; the accent button is only for local work.
const modernJs = web('modern.js'), modernCss = web('modern.css');
const sync = (data) => modern.syncAction(data, now);
assert.equal(sync({ ...base, remotes: [] }), null, 'No remote: no sync button');
assert.equal(sync({ ...base, sync: { ...base.sync, behind: 3, ahead: 1 } }).label, 'Pull origin');
assert.equal(sync({ ...base, sync: { ...base.sync, behind: 3 } }).badge, '↓3');
assert.equal(sync({ ...base, sync: { ...base.sync, ahead: 2 } }).label, 'Push origin');
assert.equal(sync({ ...base, sync: { upstream: 'upstream/main', ahead: 2 } }).label, 'Push upstream', 'Remote name comes from the upstream');
assert.equal(sync({ ...base, sync: {} }).label, 'Publish branch');
assert.equal(sync({ ...base, lastFetchAt: new Date(now - 5 * 60000).toISOString() }).caption, 'Last fetched 5m ago');
assert.equal(sync(base).caption, 'Not fetched yet');
assert.match(modernJs, /const local=action&&localKinds\.includes\(action\.kind\);primary\.hidden=!local;/);
assert.match(modernCss, /\.sync-actions > \[data-git-action\],\s*html\.ui-modern body \.sync-actions > \.toolbar-pull-group \{ display: none !important; \}/);
// No local changes: suggestions replace the empty diff area.
assert.match(modernJs, /if\(isModern\(\)&&data&&!\(data\.files\|\|\[\]\)\.length&&!conflictCount\(data\)\)/);
// Commit box under the file list; the file-list resizer is placed after that column, not inside it.
assert.match(modernJs, /const column=el\('div','modern-changes-column'\);groups\.before\(column\);column\.append\(groups,form\);/);
assert.match(web('release-ui.js'), /\(layout\.querySelector\(':scope > \.modern-changes-column'\)\|\|layout\.querySelector\('\.change-groups'\)\)\.after\(handle\)/);
// The rail's first item shows or hides the repository list.
assert.match(modernJs, /railButton\(\['repos','folder',\(\)=>t\('Repos'\)\]\)/);
// Rail items carry a visible label, not only an icon.
assert.match(modernJs, /el\('span','modern-rail-label',label\(\)\)/);
console.log('PASS: modern look primary action, relative time, initials, ref kinds, icons and wiring');
