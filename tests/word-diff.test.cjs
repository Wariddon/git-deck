const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');

// Word-level diff: only the words that changed between a removed and an added line are marked.
const context = {};
context.window = context;
vm.runInNewContext(web('word-diff.js'), context);
const { changedRanges, tokenize } = context.GitDeckWordDiff;
const plain = (value) => JSON.parse(JSON.stringify(value));
const pick = (text, ranges) => plain(ranges).map(([s, e]) => text.slice(s, e));

assert.deepEqual(plain(tokenize('a.b(c, 12)')), ['a', '.', 'b', '(', 'c', ',', ' ', '12', ')']);
let r = changedRanges('const total = price * 2;', 'const total = price * 3;');
assert.deepEqual(pick('const total = price * 2;', r.before), ['2']);
assert.deepEqual(pick('const total = price * 3;', r.after), ['3']);
r = changedRanges('return user.name;', 'return user.fullName ?? user.name;');
assert.deepEqual(pick('return user.name;', r.before), [], 'A pure insertion leaves the old line unmarked');
assert.deepEqual(pick('return user.fullName ?? user.name;', r.after), ['fullName ?? user.']);
r = changedRanges('ข้อความ เดิม', 'ข้อความ ใหม่');
assert.deepEqual(pick('ข้อความ ใหม่', r.after), ['ใหม่'], 'Thai words are tokens too');
assert.equal(changedRanges('import x from "y";', '}'), null, 'Unrelated lines are not word-highlighted');
assert.equal(changedRanges('a '.repeat(400), 'b '.repeat(400)), null, 'Very long lines are skipped');

assert.ok(web('index.html').includes('/word-diff.js'));
assert.match(web('features.css'), /\.diff-add \.diff-word\{/);
console.log('PASS: word-level diff ranges, Thai tokens, long and unrelated lines');
