'use strict';
// Conflict forecast, ask history, time machine, service map, lessons and habits: pure helpers + wiring.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.t = (text, vars) => String(text).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));
const web = (name) => fs.readFileSync(path.join(__dirname, '..', 'web', name), 'utf8');

// Conflict forecast.
const forecast = require('../web/forecast.js');
assert.deepEqual(forecast.workBranches([
  { path: 'C:\\a', pending: { branch: 'feature/AP-1' } }, { path: 'C:\\b', pending: { branch: 'main' } },
  { path: 'C:\\a\\.worktrees\\x', pending: { branch: 'x' } }, { path: 'C:\\c', pending: null },
]), [{ path: 'C:\\a', branch: 'feature/AP-1' }]);
assert.equal(forecast.verdict({ results: [{ base: 'origin/main', found: true, clean: false, files: [{ file: 'a' }, { file: 'b' }] }] }).tone, 'bad');
assert.equal(forecast.verdict({ results: [{ found: true, clean: true, behind: 0 }], others: [{ branch: 'origin/x', author: 'May', clean: false, files: [] }] }).text, 'Will conflict with origin/x (May)');
assert.equal(forecast.verdict({ results: [{ base: 'origin/main', found: true, clean: true, behind: 4 }] }).tone, 'info');
assert.equal(forecast.verdict({ results: [] }).tone, 'ok');

// Ask history: plain words become a search.
const ask = require('../web/ask-history.js');
assert.deepEqual(ask.parseQuestion('ใครแก้ redis.host ใน crs- เดือนนี้'), { term: 'redis.host', mode: 'S', family: 'crs-', repo: '', sinceDays: 31 });
assert.deepEqual(ask.parseQuestion('who changed `timeout: 30s` in lns- 14 days'), { term: 'timeout: 30s', mode: 'S', family: 'lns-', repo: '', sinceDays: 14 });
assert.equal(ask.parseQuestion('who touched findByProxy this week').term, 'findByProxy');
assert.equal(ask.parseQuestion('"host: (cluster|sentinel)"').mode, 'G');
assert.equal(ask.parseQuestion('who changed it').term, 'it');
const scoped = ask.parseQuestion('ใครแก้ wavepay ใน project_bot สัปดาห์นี้', { repos: ['project_bot', 'inblackm'] });
assert.deepEqual([scoped.term, scoped.repo, scoped.sinceDays], ['wavepay', 'project_bot', 7], 'a repository name narrows the search');
assert.equal(ask.sinceDate(0), '');
assert.equal(ask.sinceDate(1, new Date('2026-10-28T12:00:00Z')), '2026-10-27');

// Time machine.
const tm = require('../web/time-machine.js');
assert.equal(tm.summarize({ from: { found: true, commit: 'a', tag: '1.0' }, to: { found: true, commit: 'a', tag: '1.0' } }).kind, 'same');
assert.deepEqual(tm.summarize({ from: { found: true, commit: 'a', tag: '1.0' }, to: { found: true, commit: 'b', tag: '1.1' } }), { kind: 'moved', tagMoved: true });
assert.equal(tm.summarize({ from: { found: false }, to: { found: true, commit: 'b' } }).kind, 'new');
assert.equal(tm.summarize(null).kind, 'missing');
assert.equal(tm.localInput(new Date(2026, 9, 5, 7, 3)), '2026-10-05T07:03');

// Service map: callers point to providers; a removed endpoint that is still called is reported.
const mapHelpers = require('../web/api-map.js');
const smap = require('../web/service-map.js');
const gw = { path: 'C:\\gw', name: 'crs-gateway' }, cust = { path: 'C:\\cust', name: 'crs-customer' }, audit = { path: 'C:\\audit', name: 'crs-audit' };
const before = { provides: [{ method: 'GET', path: '/v1/customers/{id}', file: 'A.java', line: 1 }], calls: [], listens: [{ topic: 'audit', file: 'L.java', line: 3 }], sends: [] };
const results = [
  { repo: gw, surface: { provides: [], calls: [{ path: '/api/v1/customers/{id}', file: 'application.yml', line: 4, via: 'config' }], listens: [], sends: [{ topic: 'audit', file: 'S.java', line: 9 }] } },
  { repo: cust, surface: before },
  { repo: audit, surface: { provides: [], calls: [], listens: [{ topic: 'audit', file: 'L.java', line: 2 }], sends: [] } },
];
const graph = smap.serviceGraph(results, mapHelpers);
assert.deepEqual(graph.edges.map((e) => `${e.from}>${e.to}:${e.http}/${e.kafka}`).sort(), ['C:\\gw>C:\\audit:0/1', 'C:\\gw>C:\\cust:1/1'], 'HTTP and Kafka links between the same pair share one arrow');
assert.equal(graph.nodes.find((n) => n.path === 'C:\\cust').into, 1);
const gone = smap.brokenEndpoints('C:\\cust', before, { provides: [] }, results, mapHelpers);
assert.deepEqual(gone.map((g) => `${g.endpoint}<-${g.callerName}`), ['GET /v1/customers/{id}<-crs-gateway']);
assert.deepEqual(smap.brokenEndpoints('C:\\cust', before, before, results, mapHelpers), []);
const placed = smap.layout([{ path: 'a' }, { path: 'b' }], 400);
assert.deepEqual([placed[0].x, placed[0].y], [200, 60]);

// Lessons: what to look for in notes.
const lessons = require('../web/lessons.js');
assert.deepEqual(lessons.termsFor({ repo: 'src-svc-customer-request', branch: 'feature/AP2365-3319-promptpay', files: ['pom.xml', 'src/main/resources/application-uat.yml', 'src/App.java', 'k8s/configmap-sit.yaml'] }),
  ['src-svc-customer-request', 'src-', 'AP2365-3319', 'pom.xml', 'configmap', 'configmap-sit.yaml']);
assert.deepEqual(lessons.termsFor({ repo: 'ab' }), []);

// Habits: a run of steps repeated on three days becomes a suggestion; one-offs and skipped runs do not.
const recipes = require('../web/recipes.js');
const day = (d, h, m) => new Date(2026, 9, d, h, m).getTime();
const run = (d) => [
  { action: 'branch-switch', path: 'C:\\crs-a', payload: { branch: 'develop' }, at: day(d, 9, 0) },
  { action: 'pull', path: 'C:\\crs-a', payload: {}, at: day(d, 9, 1) },
  { action: 'pull', path: 'C:\\crs-b', payload: {}, at: day(d, 9, 2) },
];
const log = [...run(20), { action: 'push', path: 'C:\\x', payload: {}, at: day(20, 15, 0) }, ...run(21), ...run(22)];
const habit = recipes.findHabit(log);
assert.equal(habit.days, 3); assert.equal(habit.steps.length, 3);
assert.deepEqual(habit.steps.map((s) => s.action), ['branch-switch', 'pull', 'pull']);
assert(!('at' in habit.steps[0]), 'timestamps are not kept in the recipe');
assert.equal(recipes.findHabit(log.slice(0, 7)), null, 'two days is not a habit yet');
const skipped = recipes.findHabit(log, { skip: new Set([habit.key]) });
assert(skipped && skipped.steps.length === 2, 'a skipped run leaves its shorter parts');

// Wiring: panels, nav, icons, scripts and server routes.
const html = web('index.html');
for (const name of ['forecast.js', 'ask-history.js', 'time-machine.js', 'service-map.js', 'lessons.js']) assert(html.includes(`<script src="/${name}" defer></script>`), name);
const cockpit = web('cockpit.js');
for (const id of ['forecast', 'ask-history', 'service-map', 'time-machine', 'lessons']) { assert(cockpit.includes(`'${id}'`), id); assert(web('modern.js').includes(`'${id}':'`), `${id} icon`); }
const server = fs.readFileSync(path.join(__dirname, '..', 'git-dashboard-server.ps1'), 'utf8');
for (const route of ['/api/repo/merge-forecast', '/api/repo/history-find', '/api/repo/moments', '/api/lessons']) assert(server.includes(`'${route}'`), route);
assert.match(server, /\$script:PrefKeys = @\([^)]*'brainFolder'/);
assert.match(web('push-checks.js'), /GitDeckEffectiveConfig\.envImpact\(repo\.path/);
console.log('PASS: conflict forecast, ask history, time machine, service map, lessons, habits and wiring');
