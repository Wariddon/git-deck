const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const B = require('../web/briefing.js');

// Production behind: compared with the nearest lower environment (uat before sit before dev).
const drift = B.releaseDrift([
  { service: 'billing', env: 'prod', tag: 'v1.4.2' }, { service: 'billing', env: 'uat', tag: 'v1.4.5' }, { service: 'billing', env: 'dev', tag: 'v1.5.0' },
  { service: 'ledger', env: 'prod', tag: 'v2.0.1' }, { service: 'ledger', env: 'uat2', tag: 'v2.0.1' },
  { service: 'api', env: 'prod', tag: 'v3' }, { service: 'api', env: 'sit', tag: 'v4' },
  { service: 'docs', env: 'dev', tag: 'v9' },
]);
assert.deepEqual(drift.map((item) => `${item.service}:${item.prod}<${item.env}:${item.tag}`), ['api:v3<sit:v4', 'billing:v1.4.2<uat:v1.4.5']);
assert.deepEqual(B.releaseDrift(null), []);
assert.equal(B.dayOf(new Date(2026, 9, 5)), '2026-10-05');

const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');
assert.ok(web('index.html').indexOf('/briefing.js') < web('index.html').indexOf('/cockpit.js'));
assert.ok(fs.readFileSync(path.join(__dirname, '../git-dashboard-server.ps1'), 'utf8').includes("'/api/repo/recent-tags'"));
console.log('PASS: Today briefing (production behind, day key, wiring)');
// Today: to do from the repository cache, this week and ready-to-tag from the last Pending check.
{
  const B2 = require('../web/briefing.js');
  const now = Date.parse('2026-10-20T12:00:00Z');
  const repos = [
    { name: 'a', path: 'C:/r/a', changes: 2, ahead: 0, behind: 0, branch: 'dev' },
    { name: 'b', path: 'C:/r/b', changes: 0, ahead: 1, behind: 0 },
    { name: 'c', path: 'C:/r/c', changes: 0, ahead: 0, behind: 3 },
    { name: 'd', path: 'C:/r/d', changes: 0, ahead: 0, behind: 0 },
  ];
  const snapshot = { items: [
    { path: 'C:/r/d', pending: { lastCommitDate: '2026-10-19T09:00:00Z', commitsSinceTag: 1, latestTag: '1.2.9', upstream: 'origin/x' } },
    { path: 'C:/r/a', pending: { lastCommitDate: '2026-10-18T09:00:00Z', commitsSinceTag: 2, upstream: 'origin/dev', changed: 2 } },
    { path: 'C:/r/c', pending: { lastCommitDate: '2026-09-01T09:00:00Z' } },
  ] };
  const plan = B2.todayPlan(repos, snapshot, now);
  assert.deepEqual([plan.commit, plan.push, plan.pull].map((list) => list.map((repo) => repo.name)), [['a'], ['b'], ['c']]);
  assert.deepEqual(plan.week.map((item) => item.repo.name), ['d', 'a'], 'This week, newest first');
  assert.deepEqual(plan.tag.map((item) => item.repo.name), ['d'], 'Clean and pushed with commits after the tag');
}
