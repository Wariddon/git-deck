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
