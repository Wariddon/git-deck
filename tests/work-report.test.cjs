const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');

// Work report: date presets, per-repository ordering, the day timeline and the Markdown export.
const context = { t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) };
context.window = context;
vm.runInNewContext(web('work-report.js'), context);
const report = context.GitDeckWorkReport;
const plain = (value) => JSON.parse(JSON.stringify(value));

const sunday = new Date(2026, 9, 4); // Sunday 4 Oct 2026
assert.deepEqual(plain(report.range('today', sunday)), { since: '2026-10-04', until: '2026-10-04' });
assert.deepEqual(plain(report.range('week', sunday)), { since: '2026-09-28', until: '2026-10-04' }, 'Weeks start on Monday');
assert.deepEqual(plain(report.range('last-week', sunday)), { since: '2026-09-21', until: '2026-09-27' });
assert.deepEqual(plain(report.range('last-month', sunday)), { since: '2026-09-01', until: '2026-09-30' });
assert.deepEqual(plain(report.range('7', sunday)), { since: '2026-09-28', until: '2026-10-04' });

const a = { name: 'api', path: 'C:\\w\\api' }, b = { name: 'web', path: 'C:\\w\\web' }, c = { name: 'quiet', path: 'C:\\w\\quiet' };
const results = [
  { repo: a, commits: [
    { hash: 'a2'.padEnd(40, '0'), date: '2026-10-03T10:00:00+07:00', subject: 'fix | pipe AP2365-3320', ref: 'feature/AP2365-3319', files: 2, added: 5, deleted: 1 },
    { hash: 'a1'.padEnd(40, '0'), date: '2026-10-02T09:00:00+07:00', subject: 'start', ref: 'feature/AP2365-3319', files: 1, added: 1, deleted: 0 }] },
  { repo: b, commits: [{ hash: 'b1'.padEnd(40, '0'), date: '2026-10-01T08:00:00+07:00', subject: 'web first', ref: 'main', files: 3, added: 9, deleted: 2 }] },
  { repo: c, commits: [] },
];
const rows = report.summarize(results);
assert.deepEqual(rows.map((row) => row.repo.name), ['web', 'api'], 'Oldest first, quiet repositories left out');
assert.deepEqual(report.summarize(results, 'newest').map((row) => row.repo.name), ['api', 'web']);
assert.equal(rows[1].count, 2); assert.equal(rows[1].added, 6); assert.equal(rows[1].commits[0].subject, 'start', 'Commits sorted by date');
assert.deepEqual(plain(rows[1].tickets).sort(), ['AP2365-3319', 'AP2365-3320']);
assert.deepEqual(plain(report.timeline(rows).map((d) => [d.date, d.items.length])), [['2026-10-01', 1], ['2026-10-02', 1], ['2026-10-03', 1]]);

const md = report.toMarkdown({ since: '2026-10-01', until: '2026-10-04', author: 'Wariddon', rows });
assert.match(md, /^# Work report 2026-10-01 – 2026-10-04/);
assert.match(md, /\| 1 \| web \| 2026-10-01 08:00 \|/);
assert.match(md, /\| 2 \| api \| .* \| \+6 \/ -1 \|/);
assert.match(md, /- 2026-10-03 10:00 `a2000000` fix \| pipe AP2365-3320 _\(feature\/AP2365-3319\)_/);

assert.ok(web('index.html').includes('/work-report.js'));
assert.match(fs.readFileSync(path.join(__dirname, '../git-dashboard-server.ps1'), 'utf8'), /'\/api\/repo\/activity'/);
console.log('PASS: Work report presets, ordering, timeline and Markdown');
