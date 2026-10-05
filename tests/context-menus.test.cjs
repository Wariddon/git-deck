const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');

// Right-click menus carry Sourcetree's full set of actions (commit, branch, remote branch, tag, stash, remote).
const calls = [];
const context = {
  t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)),
  state: { meta: { pullStrategy: 'merge' }, workspace: { branch: 'main', remotes: [{ name: 'origin', fetchUrl: 'https://example.test/r.git' }], remoteBranches: [{ name: 'origin/main' }, { name: 'origin/dev' }], stashes: [{ ref: 'stash@{0}', message: 'wip' }] } },
  showContextMenu: () => {},
  runWorkspaceAction: (...args) => { calls.push(args); return Promise.resolve({}); },
  commitContextItems: () => [{ label: 'Checkout' }, { separator: true }, { label: 'Cherry-pick' }, { separator: true }, { label: 'Copy SHA' }],
  branchOperationContextItems: (data, branch, kind) => kind === 'remote' ? [{ label: 'Checkout dev…' }, { label: 'Pull origin/dev into current' }, { label: 'Diff' }] : [{ label: 'Checkout' }, { label: `Delete local branch ${branch.name}` }],
  tagContextItems: () => [{ label: 'Checkout v1 (detached)…' }],
  selectWorkspaceTab: () => {},
  document: { getElementById: () => null },
  prompt: () => 'feature/new',
};
context.window = context;
vm.runInNewContext(web('context-menus.js'), context);
const labels = (items) => JSON.parse(JSON.stringify(items.filter((item) => item && !item.separator).map((item) => item.label)));
const run = (items, start) => items.find((item) => item && item.label && item.label.startsWith(start)).run();

// Commit: merge / rebase next to checkout, then patch, ZIP and copies.
const commit = context.commitContextItems({ hash: 'abc1234', fullHash: 'abc1234def', subject: 'feat: x' });
assert.deepEqual(labels(commit), ['Checkout', 'Merge into main…', 'Rebase main onto this commit…', 'Cherry-pick', 'Create patch…', 'Archive as ZIP…', 'Copy SHA', 'Copy full SHA', 'Copy commit message']);
run(commit, 'Merge into'); assert.deepEqual(JSON.parse(JSON.stringify(calls.pop().slice(0, 2))), ['merge', { branch: 'abc1234def', mode: 'default' }]);
run(commit, 'Create patch'); assert.deepEqual(JSON.parse(JSON.stringify(calls.pop().slice(0, 2))), ['patch-export', { commit: 'abc1234def' }]);

// Local branch: history, tracking, force delete right after delete, new branch / tag / ZIP.
const local = context.branchOperationContextItems(context.state.workspace, { name: 'dev', upstream: '' }, 'local');
assert.deepEqual(labels(local), ['View history', 'Track remote branch…', 'Checkout', 'Delete local branch dev', 'Force delete dev…', 'New branch from here…', 'New tag here…', 'Archive as ZIP…']);
const current = context.branchOperationContextItems(context.state.workspace, { name: 'main', upstream: 'origin/main', current: true }, 'local');
assert.ok(labels(current).includes('Pull origin/main') && labels(current).includes('Stop tracking origin/main'));
assert.equal(current.find((item) => item && /^Force delete/.test(item.label)).disabled, true, 'The current branch cannot be force-deleted');
run(local, 'Force delete'); assert.deepEqual(JSON.parse(JSON.stringify(calls.pop().slice(0, 2))), ['branch-delete', { branch: 'dev', force: true }]);

// Remote branch: merge and rebase onto it, prune its remote.
const remote = context.branchOperationContextItems(context.state.workspace, { name: 'origin/dev' }, 'remote');
assert.ok(['Merge origin/dev into current', 'Rebase current onto origin/dev', 'Prune origin'].every((label) => labels(remote).includes(label)));

// Tag, stash, remote.
assert.ok(labels(context.tagContextItems(context.state.workspace, { name: 'v1', hash: 'abc' })).includes('New branch from tag…'));
assert.deepEqual(labels(context.GitDeckContextMenus.stashItems({ ref: 'stash@{0}', message: 'wip' })), ['Apply stash', 'Pop stash', 'Show changes', 'Copy stash name', 'Copy message', 'Delete stash…']);
assert.deepEqual(labels(context.GitDeckContextMenus.remoteItems('origin')), ['Fetch origin', 'Prune origin', 'Open in browser', 'Copy URL', 'Edit URL…', 'Remove origin…']);

// The menu is placed by its measured size, so it stays inside the window.
assert.match(web('app.js'), /const width=menu\.offsetWidth\|\|285;const height=menu\.offsetHeight\|\|/);
assert.ok(web('index.html').indexOf('/context-menus.js') > web('index.html').indexOf('/file-actions.js'));
console.log('PASS: Sourcetree-style right-click menus for commits, branches, tags, stashes and remotes');
// Custom actions join the commit, file, branch and repository-tab menus, with a way to manage them.
const custom = web('custom-actions.js');
for (const [fn, target] of [['commitContextItems', 'commit'], ['workingFileContextItems', 'file'], ['branchOperationContextItems', 'branch'], ['repositoryTabContextItems', 'repo']]) {
  const line = custom.split('\n').find((text) => text.includes(`${fn}=function`)) || '';
  assert.ok(line.includes(`items('${target}'`), fn);
}
assert.ok(web('index.html').indexOf('/custom-actions.js') > web('index.html').indexOf('/context-menus.js'));
console.log('PASS: custom actions in every right-click menu');
