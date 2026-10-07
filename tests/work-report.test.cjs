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
    { hash: 'a2'.padEnd(40, '0'), date: '2026-10-03T10:00:00+07:00', subject: 'fix | pipe PAY-1235', ref: 'feature/PAY-1234', files: 2, added: 5, deleted: 1 },
    { hash: 'a1'.padEnd(40, '0'), date: '2026-10-02T09:00:00+07:00', subject: 'start', ref: 'feature/PAY-1234', files: 1, added: 1, deleted: 0 }] },
  { repo: b, commits: [{ hash: 'b1'.padEnd(40, '0'), date: '2026-10-01T08:00:00+07:00', subject: 'web first', ref: 'main', files: 3, added: 9, deleted: 2 }] },
  { repo: c, commits: [] },
];
const rows = report.summarize(results);
assert.deepEqual(rows.map((row) => row.repo.name), ['web', 'api'], 'Oldest first, quiet repositories left out');
assert.deepEqual(report.summarize(results, 'newest').map((row) => row.repo.name), ['api', 'web']);
assert.equal(rows[1].count, 2); assert.equal(rows[1].added, 6); assert.equal(rows[1].commits[0].subject, 'start', 'Commits sorted by date');
assert.deepEqual(plain(rows[1].tickets).sort(), ['PAY-1234', 'PAY-1235']);
assert.deepEqual(plain(report.timeline(rows).map((d) => [d.date, d.items.length])), [['2026-10-01', 1], ['2026-10-02', 1], ['2026-10-03', 1]]);

const md = report.toMarkdown({ since: '2026-10-01', until: '2026-10-04', author: 'Wariddon', rows });
assert.match(md, /^# Work report 2026-10-01 – 2026-10-04/);
assert.match(md, /\| 1 \| web \| 2026-10-01 08:00 \|/);
assert.match(md, /\| 2 \| api \| .* \| \+6 \/ -1 \|/);
assert.match(md, /- 2026-10-03 10:00 `a2000000` fix \| pipe PAY-1235 _\(feature\/PAY-1234\)_/);

// Status, tickets, files and CSV.
const status = [{ repo: a, mainline: 'origin/main', commits: [
  { hash: 'c1'.padEnd(40, '0'), date: '2026-10-02T09:00:00+07:00', subject: 'AP-1 part one', ref: 'main', paths: ['src/a.js', 'src/b.js'], pushed: true, merged: true },
  { hash: 'c2'.padEnd(40, '0'), date: '2026-10-03T09:00:00+07:00', subject: 'tidy, "quoted"', ref: 'feature/AP-2', paths: ['src/a.js'], pushed: false, merged: false }] }];
const [srow] = report.summarize(status);
assert.equal(srow.unpushed, 1); assert.equal(srow.unmerged, 1);
assert.deepEqual(plain(srow.hotFiles), [{ file: 'src/a.js', count: 2 }, { file: 'src/b.js', count: 1 }]);
assert.deepEqual(plain(report.byTicket([srow]).map((g) => [g.ticket, g.commits.length])), [['AP-1', 1], ['AP-2', 1]]);
assert.deepEqual(plain(report.byTicket(rows).map((g) => g.ticket)).slice(-1), [''], 'Commits without a ticket come last');
const smd = report.toMarkdown({ since: 's', until: 'u', author: '', rows: [srow] });
assert.match(smd, /1 not pushed, 1 not in origin\/main/);
assert.match(smd, /## By ticket\n\n- \*\*AP-1\*\* \(api\): AP-1 part one/);
assert.match(smd, /Most changed files: `src\/a\.js` \(2\)/);
assert.match(smd, /tidy, "quoted" _\(feature\/AP-2\)_ — not pushed/);
const csv = report.toCsv({ rows: [srow] });
assert.ok(csv.startsWith('﻿date,repository,'), 'BOM so Excel reads Thai');
assert.match(csv, /2026-10-03 09:00,api,feature\/AP-2,c20000000000,"tidy, ""quoted""",AP-2,,,,no,no,/);

assert.ok(web('index.html').includes('/work-report.js'));
assert.match(fs.readFileSync(path.join(__dirname, '../git-dashboard-server.ps1'), 'utf8'), /'\/api\/repo\/activity'/);
console.log('PASS: Work report presets, ordering, timeline and Markdown');
