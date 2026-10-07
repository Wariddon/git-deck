const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');

// Multi-repository helpers: pending labels, switch plans, cleanup reasons, ticket prefix, GitLab news.
const context = { t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)), api: () => {}, el: () => ({}) };
context.window = context;
vm.runInNewContext(web('multi-repo.js'), context);
const m = context.GitDeckMultiRepo;
const plain = (value) => JSON.parse(JSON.stringify(value));

const clean = { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, changed: 0, untracked: 0, conflicts: 0, operation: '', unpushedBranches: [], stashes: [], mergedBranches: [] };
assert.deepEqual(plain(m.pendingLabels(clean)), [], 'A tidy repository has nothing pending');
const busy = { ...clean, branch: 'feature/x', upstream: '', changed: 2, untracked: 1, unpushedBranches: [{ branch: 'fix/y', commits: 3 }], stashes: [{}], mergedBranches: ['old'], behind: 4 };
assert.deepEqual(plain(m.pendingLabels(busy).map((l) => l.text)), ['3 uncommitted file(s)', 'Branch not published', 'fix/y: 3 not pushed', '4 to pull', '1 stash(es)', '1 merged branch(es) to delete']);
assert.equal(m.pendingLabels({ ...clean, operation: 'merge', conflicts: 2 })[0].tone, 'bad');

// One-click fixes per repository.
assert.deepEqual(plain(m.pendingActions(clean)), []);
assert.deepEqual(plain(m.pendingActions(busy)), ['commit', 'publish', 'pull', 'stashes', 'cleanup']);
assert.deepEqual(plain(m.pendingActions({ ...clean, ahead: 2 })), ['push']);
assert.deepEqual(plain(m.pendingActions({ ...clean, operation: 'merge', conflicts: 1, ahead: 1, behind: 1 })), ['resolve'], 'No push or pull during a merge');
assert.deepEqual(plain(m.pendingActions(null)), []);

// Pending table numbers and filter chips.
const counts = m.pendingCounts({ ...busy, unpushedBranches: [{ branch: 'a', commits: 3 }, { branch: 'b', commits: 2 }] });
assert.deepEqual([counts.changes, counts.push, counts.pull, counts.stashes, counts.localOnly, counts.localOnlyCommits, counts.merged, counts.unpublished], [3, 0, 4, 1, 2, 5, 1, 1]);
assert.equal(m.pendingCounts(null).score, 0);
assert.ok(m.pendingCounts({ ...clean, operation: 'merge', conflicts: 1 }).score > m.pendingCounts(busy).score, 'Unfinished merges sort first');
const item = (p, error = '') => ({ pending: p, counts: m.pendingCounts(p), error });
assert.equal(m.pendingMatches(item(clean), 'any'), false, 'A tidy repository is not pending');
assert.equal(m.pendingMatches(item(clean), 'all'), true);
assert.equal(m.pendingMatches(item(busy), 'pull'), true);
assert.equal(m.pendingMatches(item(busy), 'push'), false);
assert.equal(m.pendingMatches(item(busy), 'unpublished'), true);
assert.equal(m.pendingMatches(item(null, 'boom'), 'problems'), true, 'Errors show under Conflicts / errors');
assert.equal(m.pendingMatches(item(null, 'boom'), 'any'), true);

// What to do, most urgent first, in plain words.
assert.deepEqual(plain(m.nextSteps(item(clean))), []);
const steps = m.nextSteps(item(busy)).map((s) => s.text);
assert.deepEqual(plain(steps), ['Commit or stash 3 changed file(s)', 'Publish this branch to the remote', 'Pull 4 new commit(s)', '1 branch(es) exist only on this computer: push or delete them', 'Review 1 stash(es)', 'Delete 1 merged branch(es)']);
assert.equal(m.nextSteps(item({ ...clean, operation: 'rebase', conflicts: 2 }))[0].text, 'Resolve 2 conflict(s), then finish the rebase');
assert.match(m.nextSteps(item(null, 'not a git repository'))[0].text, /^Could not check: not a git repository/);

// A failed push says why in one line, not "To C:/...remote.git".
const rejected = 'To C:/w/remote.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to \'C:/w/remote.git\'';
assert.equal(m.explainError(rejected), '! [rejected]        main -> main (fetch first)');
assert.equal(m.explainError('fatal: not a git repository'), 'fatal: not a git repository');
const failed = { ...item(clean), actionError: { kind: 'push', reason: 'rejected', raw: rejected } };
assert.equal(m.nextSteps(failed)[0].text, 'Push failed: rejected');
assert.equal(m.pendingMatches(failed, 'problems'), true, 'A failed push shows under Fix these first');

// Several names in the filter, in the order typed; tag filter; ages.
assert.deepEqual(plain(m.parseTerms(' crs-svc, lns  tonson,,')), ['crs-svc', 'lns', 'tonson']);
const repoItem = (name, p = {}) => ({ repo: { name }, pending: { branch: 'main', ...p } });
const typed = m.parseTerms('tonson, lns, crs');
assert.equal(m.termRank(repoItem('crs-svc-common'), typed), 2);
assert.equal(m.termRank(repoItem('lns'), typed), 1, 'Exact name');
assert.equal(m.termRank(repoItem('lns-deployment-2'), typed), 1);
assert.equal(m.termRank(repoItem('other'), typed), -1);
assert.equal(m.termRank(repoItem('api', { latestTag: 'v2.1.0' }), m.parseTerms('v2.1')), 0, 'Tags are searchable');
assert.equal(m.tagMatches(repoItem('a', { latestTag: 'v1', commitsSinceTag: 3 }), 'since'), true);
assert.equal(m.tagMatches(repoItem('a', { latestTag: 'v1', commitsSinceTag: 0 }), 'since'), false);
assert.equal(m.tagMatches(repoItem('a', { latestTag: '' }), 'untagged'), true);
assert.equal(m.tagMatches(repoItem('a', { latestTag: 'v1' }), 'tagged'), true);
assert.equal(m.ageOf('2026-10-01T00:00:00Z', Date.parse('2026-10-05T12:00:00Z')), '4 days ago');
assert.equal(m.ageOf('2026-10-05T00:00:00Z', Date.parse('2026-10-05T12:00:00Z')), 'today');
assert.equal(m.ageOf(new Date(2026, 9, 5, 22, 0).toISOString(), new Date(2026, 9, 6, 9, 0).getTime()), 'yesterday', 'Calendar days, not 24-hour blocks');

// Dates are shown as real dates, with the age next to them.
assert.equal(m.dayOf('2026-10-03T09:15:00+07:00'), '2026-10-03');
assert.equal(m.dayOf(''), '');
assert.equal(m.whenOf('2026-10-01T00:00:00Z', Date.parse('2026-10-05T12:00:00Z')), '2026-10-01 · 4 days ago');
assert.match(web('multi-repo.js'), /t\('Repository'\),t\('Branch'\),t\('Latest tag'\),t\('Last commit'\),t\('What to do'\)/);
// The Dashboard is a page in the work area (rail and toolbar stay), not a window over the screen.
assert.match(web('multi-repo.js'), /function setUpDashboardPage\(/);
assert.ok(web('features.css').includes('body.dashboard-page-open #operations-backdrop{display:none !important}'));
assert.ok(web('features.css').includes('.workbench-body>.operations-modal{position:absolute;'));
assert.match(web('modern.js'), /tab==='all-repos'\?dashboard:!dashboard&&tab===state\.workspaceTab/, 'All repos is lit while the Dashboard page is open');

const found = (o) => ({ local: false, remote: '', current: 'main', dirty: false, ...o });
assert.equal(m.switchPlan('feature/a', found({ current: 'feature/a' })).kind, 'none');
assert.deepEqual(plain(m.switchPlan('feature/a', found({ local: true })).payload), { branch: 'feature/a', localChanges: 'stash' });
assert.deepEqual(plain(m.switchPlan('feature/a', found({ remote: 'origin/feature/a' }), { localChanges: 'carry' }).payload), { branch: 'origin/feature/a', localChanges: 'carry' });
assert.equal(m.switchPlan('feature/a', found({})).kind, 'skip', 'Missing branches are not created unless asked');
assert.equal(m.switchPlan('feature/a', found({}), { create: true }).action, 'branch-create');
assert.equal(m.switchPlan('feature/a', found({ local: true, dirty: true }), { localChanges: '' }).kind, 'skip', 'Dirty repositories are skipped when asked');

const now = Date.parse('2026-10-05T00:00:00Z');
assert.deepEqual(plain(m.cleanupReasons({ merged: true, date: '2026-10-01T00:00:00Z' }, now)), ['merged']);
assert.deepEqual(plain(m.cleanupReasons({ gone: true, date: '2026-01-01T00:00:00Z' }, now)), ['gone', 'old']);
assert.deepEqual(plain(m.cleanupReasons({ merged: true, protected: true, date: '2020-01-01' }, now)), [], 'Protected branches are never suggested');
assert.deepEqual(plain(m.cleanupReasons({ merged: true, current: true, date: '2020-01-01' }, now)), []);

assert.equal(m.ticketPrefix('feature/AP2365-3319-login'), 'AP2365-3319: ');
assert.equal(m.ticketPrefix('main'), '');

const first = m.gitlabNews(undefined, { pipelines: [{ id: 1, status: 'failed', ref: 'main' }], mergeRequests: [{ iid: 7, user_notes_count: 2, title: 'Login' }] });
assert.equal(first.news.length, 0, 'The first look only records');
const later = m.gitlabNews(first.next, { pipelines: [{ id: 1, status: 'failed' }, { id: 2, status: 'failed', ref: 'feature/x' }], mergeRequests: [{ iid: 7, user_notes_count: 3, title: 'Login' }, { iid: 8, user_notes_count: 1, title: 'New' }] });
assert.deepEqual(plain(later.news.map((n) => n.text)), ['Pipeline #2 failed on feature/x', 'New comment on !7 Login']);

assert.ok(web('index.html').includes('/multi-repo.js'));
// The Pending table fits the window: headers wrap, buttons stack.
assert.ok(web('features.css').includes('.multi-repo-table.pending-table th{white-space:normal !important;'));
// Column names stay in view while the table scrolls; long tags are cut instead of covering the next column.
assert.ok(web('features.css').includes('.multi-repo-table.pending-table tr:first-child th{position:sticky;top:0;'));
assert.ok(web('features.css').includes('.multi-repo-table.pending-table td.pending-tag-cell .pending-tag-badge{display:block;max-width:150px;overflow:hidden;text-overflow:ellipsis;'));
// Columns can be dragged wider to read long names; widths are remembered, double-click resets.
assert.match(web('multi-repo.js'), /function sizeColumns\(grid\)/);
assert.match(web('multi-repo.js'), /gitdeck\.pendingColumns/);
assert.ok(web('features.css').includes('.pending-col-grip{position:absolute;'));
// The resize cursor never sticks: the drag ends on release anywhere, cancel, lost capture or window blur,
// even when the table is redrawn under the mouse while results arrive.
for (const type of ["'pointerup'", "'pointercancel'", "'blur'"]) assert.ok(web('multi-repo.js').includes(type), type);
assert.ok(web('multi-repo.js').includes("window.addEventListener('pointermove',move,true)"));
assert.ok(web('multi-repo.js').includes("grip.addEventListener('lostpointercapture',end)"));
// Easy to find: All repos and Report sit on the left rail under Repos.
assert.match(web('modern.js'), /railButton\(\['all-repos','repos',\(\)=>t\('All repos'\)\]\),railButton\(\['report','report',\(\)=>t\('Report'\)\]\)/);
assert.match(web('modern.js'), /'all-repos':\(state\.repos\|\|\[\]\)\.filter\(/, 'All repos shows how many repositories need attention');
// Primary buttons keep white text in every theme, even inside dialogs.
assert.match(web('modern.css'), /:is\(button\.primary, \.btn\.primary, #push-submit\):not\(#gd-none\) \{ color: var\(--accent-contrast, #fff\); \}/);
// Windows opened from the drawer sit above it, and the drawer closes; Midnight has no light leftovers.
assert.match(web('modern.css'), /\.backdrop:not\(#push-backdrop\)[^{]*\{ z-index: 150; \}/);
assert.match(web('modern.js'), /backdrop'\)&&!change\.target\.classList\.contains\('hidden'\)\)\)closeDrawer\(\)/);
assert.match(web('modern.css'), /body\.theme-dark :is\(\.scan-locations, \.gitlab-search, \.modal-actions\)/);
for (const route of ['/api/repo/pending', '/api/repo/branch-cleanup', '/api/repo/search', '/api/repo/find-branch']) assert.ok(fs.readFileSync(path.join(__dirname, '../git-dashboard-server.ps1'), 'utf8').includes(`'${route}'`), route);
console.log('PASS: multi-repository pending labels, switch plans, cleanup, ticket prefix and GitLab news');

// Searching a name finds the repository even when it has nothing pending (only a new tag, say):
// the default "Anything pending" filter steps aside while terms are typed, and By task lists them.
{
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../web/multi-repo.js'), 'utf8');
  require('node:assert/strict').match(source, /const activeFilter=\(\)=>filter==='any'&&parseTerms\(search\.value\)\.length\?'all':filter;/);
  require('node:assert/strict').match(source, /if\(terms\.length&&tidy\)\{/);
  require('node:assert/strict').match(source, /t\('Checked \{total\} repositories',\{total:results\.length\}\)/);
  console.log('PASS: search shows repositories with nothing pending; summary says all were checked');
}
