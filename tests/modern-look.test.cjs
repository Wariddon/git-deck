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
assert.match(modernJs, /const local=action&&localKinds\.includes\(action\.kind\);/);
assert.match(modernJs, /primary\.hidden=!local\|\|action\.kind!=='conflicts';/, 'Accent button only for conflicts; the action bar has Commit');
// Sourcetree-style action bar: one button per everyday action, with Pull/Push counts.
for (const kind of ['commit', 'pull', 'push', 'fetch', 'branch', 'merge', 'stash', 'tag', 'terminal', 'explorer']) assert.match(modernJs, new RegExp(`${kind}:actionButton\\('${kind}'`), kind);
assert.match(modernCss, /\.modern-tb-sync \{ display: none !important; \}/, 'The single sync button gives way to Pull / Push / Fetch');
assert.match(modernCss, /\.sync-actions > \[data-git-action\],\s*html\.ui-modern body \.sync-actions > \.toolbar-pull-group \{ display: none !important; \}/);
// No local changes: suggestions replace the empty diff area.
assert.match(modernJs, /if\(isModern\(\)&&data&&!\(data\.files\|\|\[\]\)\.length&&!conflictCount\(data\)\)/);
// Commit box under the file list; the file-list resizer is placed after that column, not inside it.
assert.match(modernJs, /const column=el\('div','modern-changes-column'\);groups\.before\(column\);column\.append\(groups,form\);/);
assert.match(web('release-ui.js'), /\(layout\.querySelector\(':scope > \.modern-changes-column'\)\|\|layout\.querySelector\('\.change-groups'\)\)\.after\(handle\)/);
// Unpinned repository list is a drawer (closes on outside click / Esc); pinned stays a column.
assert.match(modernJs, /const syncDrawer=\(\)=>document\.body\.classList\.toggle\('modern-library-drawer',!state\.meta\?\.libraryPinned\);/);
assert.match(modernCss, /body\.workbench-mode\.modern-library-drawer:not\(\.library-collapsed\) \.repos \{/);
assert.doesNotMatch(modernCss, /\.patch-hunk \{[^}]*overflow: hidden/, 'overflow on the hunk card would break its sticky header');
// Branches page: local and remote groups with headings; decorated once per rendered card.
assert.match(modernJs, /card\.dataset\.kind=\/\^Remote branch\/\.test\(detail\)\?'remote':'local';/);
assert.match(modernJs, /decorateHistory\(content\);decorateBranches\(content\);renderRail\(\);/);
// Readable accent: a black accent on the dark theme is inverted, a blue one on light is kept,
// a pale yellow on light is darkened until it reaches at least 3:1 against the surface.
const light = [255, 255, 255], dark = [17, 17, 19];
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
same(modern.readableAccent([17, 17, 17], dark), [228, 228, 231]);
same(modern.readableAccent([9, 105, 218], light), [9, 105, 218]);
const yellow = modern.readableAccent([250, 230, 90], light);
assert(modern.contrast(yellow, light) >= 3, 'pale accent is darkened');
assert(modern.contrast(modern.readableAccent([30, 60, 200], dark), dark) >= 3, 'dark blue accent is lightened on the dark theme');
// "View & tools": both legacy panels live in one menu, and go back for Classic.
assert.match(modernJs, /for\(const node of \[\.\.\.secondary\.children\]\.filter\(node=>node\.tagName!=='SUMMARY'\)\)\{movedTools\.push/);
assert.match(modernJs, /function teardown\(\)\{closePopover\(\);restoreToolbar\(\);restoreToolsPanel\(\);/);
// More menu headings: upper-case labels become sentence case, product names survive, other text is left alone.
assert.equal(modern.sentenceCase('REVIEW & GITLAB'), 'Review & GitLab');
assert.equal(modern.sentenceCase('BRANCH TOOLS'), 'Branch tools');
assert.equal(modern.sentenceCase('Already fine'), 'Already fine');
assert.equal(modern.sentenceCase('เครื่องมือ'), 'เครื่องมือ');
// Toolbar button rules apply to direct toolbar buttons only, not to items inside its menus.
assert.doesNotMatch(modernCss, /html\.ui-modern body \.sync-actions :is\(button, summary\)/);
// Stash page columns fill the width (legacy .42fr/.58fr left a gap).
assert.match(modernCss, /\.stash-layout \{ grid-template-columns: minmax\(280px, 2fr\) minmax\(0, 3fr\) !important;/);
// "Loading …" empty states show a spinner, not an empty-result picture.
assert.match(modernJs, /\/\^Loading\\b\/\.test\(String\(title\)\)\?el\('span','modern-spinner'\)/);
// Layers: header menus above sticky page bars, but the repository drawer and switcher above the header.
const zOf = (pattern) => Number((modernCss.match(pattern) || [])[1]);
const headerZ = zOf(/\.workspace-modal-head \{ position: relative; z-index: (\d+); \}/);
assert(headerZ > 4, 'header menus sit above sticky page toolbars (z-index up to 4)');
assert(zOf(/\.repo-switcher \{ z-index: (\d+) !important; \}/) > headerZ, 'Ctrl+P switcher above the header');
assert(zOf(/modern-library-drawer:not\(\.library-collapsed\) \.repos \{[^}]*z-index: (\d+)/) > headerZ, 'repository drawer above the header');
// Legacy hard-coded colours that were unreadable on the dark theme are re-mapped to theme tokens.
assert.match(modernCss, /:is\(\.settings-check, \.worktree-choice, \.push-options, \.modal label, \.gitlab-result-count\) \{ color: var\(--text-secondary\) !important; \}/);
assert.match(modernCss, /\.patch-selected \{[^}]*background: var\(--surface-subtle\) !important; color: var\(--text-secondary\) !important;/);
assert.match(modernCss, /\.recovery-note \{[^}]*color: var\(--text-secondary\) !important;/);
// Comfort: a type scale on top of the Text size setting, no pure white/black, dark text around 14:1.
assert.match(modernCss, /--fs-lg: calc\(var\(--ui-text-size\) \+ 4px\);/);
assert.match(modernCss, /\.workspace-section-head h3[^{]*\{\s*font-size: var\(--fs-lg\) !important;/);
const token = (block, name) => (modernCss.slice(modernCss.indexOf(block)).match(new RegExp(`${name}: (#[0-9a-f]{6})`)) || [])[1];
const hexLum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
const ratio = (a, b) => { const x = hexLum(a), y = hexLum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
// Dark and Midnight: dimmed, about 10:1 (they were 15-18:1 on near-black and felt heavy).
for (const block of ['html.ui-modern body.theme-dark:not(.theme-midnight) {\n  --canvas: #1c2128', 'html.ui-modern body.theme-midnight {\n  --canvas: #242a35']) {
  const text = token(block, '--text-primary'), surface = token(block, '--surface'), tertiary = token(block, '--text-tertiary');
  const r = ratio(text, surface);
  assert(r >= 8 && r <= 12, `${block.slice(0, 50)}: text contrast ${r.toFixed(1)} should be 8-12:1`);
  assert(ratio(tertiary, surface) >= 4.5, `${block.slice(0, 50)}: captions stay readable (4.5:1)`);
  assert(hexLum(surface) > 0.015, `${block.slice(0, 50)}: surface is a dimmed grey, not near-black`);
}
assert.match(modernCss, /html\.ui-modern body\.theme-dark :is\(\.workspace, \.workspace-modal,/, 'Midnight uses the theme tokens too, not the old hard-coded navy');
for (const block of ['html.ui-modern body:not(.theme-dark):not([data-theme="paper"]) {', 'html.ui-modern body[data-theme="paper"] {']) {
  const text = token(block, '--text-primary'), surface = token(block, '--surface');
  const r = ratio(text, surface);
  assert(r >= 7 && r <= 16, `${block.slice(0, 60)}: text contrast ${r.toFixed(1)} should be readable but not glaring (7-16:1)`);
  assert(!['#ffffff', '#000000'].includes(surface) && !['#ffffff', '#000000'].includes(text), 'no pure white or pure black');
}
// Paper theme is selectable and survives a reload.
assert.match(web('app.js'), /\['system','light','dark','midnight','paper'\]\.includes\(saved\.theme\)/);
assert.equal((web('index.html').match(/data-theme-choice="paper"/g) || []).length, 2, 'Paper appears in both theme menus');
// Plain-language help on the rail, and a Focus toggle.
assert.match(modernJs, /changes:\(\)=>t\('Files you changed but have not committed yet\./);
assert.match(modernJs, /tab==='focus'\?toggleFocus\(\)/);
// The rail's first item shows or hides the repository list.
assert.match(modernJs, /railButton\(\['repos','folder',\(\)=>t\('Repos'\)\]\)/);
// Rail items carry a visible label, not only an icon.
assert.match(modernJs, /el\('span','modern-rail-label',label\(\)\)/);
console.log('PASS: modern look primary action, relative time, initials, ref kinds, icons and wiring');
// Stash and Merge open small dialogs (like Sourcetree) instead of switching pages.
assert.match(modernJs, /stash:actionButton\('stash','stash',t\('Stash'\),[^\n]*openStash\)/);
assert.match(modernJs, /merge:actionButton\('merge','merge',t\('Merge'\),[^\n]*openMerge\)/);
assert.match(modernJs, /runWorkspaceAction\('stash-save',\{message:message\.value\.trim\(\),keepIndex:keep\.checked\},''\)/);
assert.match(modernJs, /runWorkspaceAction\('merge',\{branch:list\.value,mode:mode\.value\},''\)/);
// History: the "Viewing" bar folds into the controls row without piling up copies when it re-renders.
assert.match(modernJs, /head\.querySelectorAll\('\.modern-viewing, :scope > \.modern-moved'\)\.forEach\(node=>node\.remove\(\)\)/);
assert.match(modernCss, /\.history-context\.modern-folded \{ display: none !important; \}/);
console.log('PASS: Stash/Merge dialogs and one-row history header');
// Other pages, Sourcetree density: one-line branches and tags, Remote editor only on Edit, first item opens.
assert.match(modernCss, /#workspace-content \.branch-card > \.workspace-row \{ min-height: 28px !important; padding: 2px 10px 2px 36px !important; \}/, 'Branch icon keeps its own space (the id-level row padding would cover it)');
assert.match(modernCss, /\.tag-row \.tag-info \{ display: grid;/);
assert.match(modernCss, /\.remote-card:not\(\.expanded\) > \.remote-edit \{ display: none !important; \}/);
assert.match(modernJs, /\['\.compare-diff > \.workspace-empty','\.compare-file-list \.compare-file-row'\]/);
assert.match(modernJs, /autoOpened\.add\(empty\);root\.querySelector\(first\)\?\.click\(\);/, 'Each empty panel is opened once (no click loop)');
const appJs = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
assert.match(appJs, /includes\(saved\.filter\)\?saved\.filter:'all';/, 'Sidebar starts on the Branches / Remotes / Tags / Stashes tree');
console.log('PASS: Sourcetree density on Branches, Tags, Remotes, Compare, Stashes and the sidebar');
// Narrow windows: the action bar never slides under More; History's description column shrinks instead of scrolling.
assert.match(modernCss, /\.modern-actions \{ overflow: hidden; \}/);
assert.match(modernCss, /@media \(max-width: 980px\) \{\s*html\.ui-modern body \.modern-act-group:nth-child\(3\) \{ display: none; \}/);
assert.match(appJs, /const defaults=\{subject:220,author:120,date:92\};/, 'Subject column minimum lets the list fit narrower windows');
assert.match(modernCss, /#workspace-content \.recovery-row \.recovery-info \{ display: grid !important; grid-template-columns: 64px minmax\(0, 1fr\) minmax\(0, 320px\) !important;/);
console.log('PASS: narrow-window toolbar and history, one-line reflog');
