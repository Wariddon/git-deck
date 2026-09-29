const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);

const context = {
  t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => k in vars ? String(vars[k]) : m),
  state: { workspaceTab: 'changes' },
  workingFileContextItems: () => [{ label: 'Open' }],
  runWorkspaceAction: async () => ({}),
  document: { getElementById: () => null },
};
context.window = context;
vm.runInNewContext(web('file-actions.js'), context);
const { ignorePatterns, recentMessages } = context.GitDeckFileActions;

// Ignore choices: the file itself, its extension, its folder (Sourcetree's Ignore dialog).
same(ignorePatterns('src/app/debug.log').map((o) => o.pattern), ['/src/app/debug.log', '*.log', '/src/app/']);
same(ignorePatterns('notes.md').map((o) => o.pattern), ['/notes.md', '*.md']);
same(ignorePatterns('output/').map((o) => o.pattern), ['/output/']);

// Recent messages: mine only, no duplicates, no merges or git's own stash commits.
const data = {
  settings: { userName: 'Dev' },
  history: [
    { author: 'Dev', subject: 'feat: login' },
    { author: 'Someone', subject: 'fix: theirs' },
    { author: 'Dev', subject: 'On feature/x: wip' },
    { author: 'Dev', subject: 'index on feature/x: abc feat' },
    { author: 'Dev', subject: 'WIP on main: abc' },
    { author: 'Dev', subject: 'Merge branch main' },
    { author: 'Dev', subject: 'feat: login' },
    { author: 'dev', subject: 'docs: readme' },
  ],
};
same(recentMessages(data), ['feat: login', 'docs: readme']);

// Working-file menu: untracked files get Recycle Bin (never a permanent delete); conflicts get mine/theirs.
const labels = (file) => context.workingFileContextItems(file, false, null, null).filter((i) => i.label).map((i) => i.label);
assert(labels({ path: 'new.txt', status: '??' }).includes('Move to Recycle Bin…'));
assert(!labels({ path: 'app.txt', status: ' M' }).includes('Move to Recycle Bin…'));
assert(labels({ path: 'app.txt', status: ' M' }).includes('Stop tracking (keep the file)'));
assert(labels({ path: 'app.txt', status: 'UU' }).includes('Resolve using mine'));
assert(labels({ path: 'app.txt', status: 'UU' }).includes('Resolve using theirs'));

// Server guards: never a permanent delete, runnable files from history are not opened.
const parity = fs.readFileSync(path.join(__dirname, '../lib/GitDeck.Parity.ps1'), 'utf8');
assert.match(parity, /RecycleOption\]::SendToRecycleBin/);
assert.doesNotMatch(parity, /Remove-Item/);
assert.match(parity, /if \(Test-GitDeckRunnableFile \$saved\)/);
console.log('PASS: ignore choices, recent messages, working-file menu, recycle-only removal, runnable files not opened');
