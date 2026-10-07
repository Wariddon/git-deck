const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');
const I = require('../web/integrations.js');

// Environments are ordered from development to production.
assert.deepEqual(I.sortEnvs(['prod', 'uat', 'dev', 'sit2', 'sit', 'default', 'dev']), ['default', 'dev', 'sit', 'sit2', 'uat', 'prod']);

// A deployed service maps to its repository by name, never by a short accidental match.
const repos = [{ name: 'billing-svc', path: 'C:/r/billing-svc' }, { name: 'ledger', path: 'C:/r/ledger' }, { name: 'api', path: 'C:/r/api' }];
assert.equal(I.matchRepo('billing-svc', repos).name, 'billing-svc');
assert.equal(I.matchRepo('Billing-Svc', repos).name, 'billing-svc');
assert.equal(I.matchRepo('ledger-worker', repos).name, 'ledger');
assert.equal(I.matchRepo('payment-gateway', repos), null, 'api is too short to match by part');

// Deploy entries become one row per service with the tags of each environment.
const entries = [
  { env: 'dev', service: 'billing-svc', tag: '1.5.0-poc03', file: 'k8s/dev/b.yaml', line: 4 },
  { env: 'uat', service: 'billing-svc', tag: '1.4.5', file: 'helm/values-uat.yaml', line: 3 },
  { env: 'uat', service: 'billing-svc', tag: '1.4.5', file: 'helm/values-uat-2.yaml', line: 3 },
  { env: 'prod', service: 'ledger', tag: 'v2.0.1', file: 'overlays/prod/k.yaml', line: 5 },
];
const rows = I.deployRows(entries);
assert.equal(rows.length, 2);
assert.deepEqual(rows[0].envs.uat.map((item) => item.tag), ['1.4.5'], 'The same tag twice is shown once');
assert.equal(rows[0].envs.uat[0].more, true);

// Ticket view: environments that run a tag containing the ticket.
const cache = { entries: entries.map(({ env, service, tag }) => ({ env, service, tag })) };
assert.deepEqual(I.deployedIn(cache, repos[0], ['1.5.0-poc03', '1.4.5']), ['dev', 'uat']);
assert.deepEqual(I.deployedIn(cache, repos[0], ['1.4.2']), []);
assert.deepEqual(I.deployedIn(null, repos[0], ['1.4.5']), []);

// Dependencies: only versions are compared; "(managed)" does not count as a different version.
const pom = (pairs) => new Map(Object.entries(pairs));
const deps = I.dependencyRows([
  { repo: repos[0], map: pom({ 'parent.org.springframework.boot:spring-boot-starter-parent': '3.4.1', 'dependency.org.apache.kafka:kafka-clients': '3.7.0', 'property.java.version': '21', 'property.sonar.host': 'x', 'project.version': '1' }) },
  { repo: repos[1], map: pom({ 'parent.org.springframework.boot:spring-boot-starter-parent': '3.3.5', 'dependency.org.apache.kafka:kafka-clients': '(managed)', 'property.java.version': '21' }) },
]);
assert.equal(deps[0].key, 'parent.org.springframework.boot:spring-boot-starter-parent', 'Different versions first');
assert.equal(deps[0].distinct, 2);
assert.equal(deps.find((item) => item.key === 'dependency.org.apache.kafka:kafka-clients').distinct, 1);
assert.ok(!deps.some((item) => item.key === 'property.sonar.host' || item.key === 'project.version'), 'Only versions');

// Notifications: repositories with more commits to pull than before.
const before = new Map([['C:/r/billing-svc', 1], ['C:/r/ledger', 0]]);
assert.deepEqual(I.newlyBehind(before, [{ path: 'C:/r/billing-svc', name: 'billing-svc', behind: 3 }, { path: 'C:/r/ledger', name: 'ledger', behind: 0 }]).map((item) => item.count), [2]);

// Wiring: loaded after fleet.js, server routes and actions exist, icons for the More menu.
const html = web('index.html');
assert.ok(html.indexOf('/integrations.js') > html.indexOf('/fleet.js'), 'integrations.js loads after fleet.js');
assert.match(html, /data-workspace-quick="open-idea"/);
const server = fs.readFileSync(path.join(__dirname, '../git-dashboard-server.ps1'), 'utf8');
for (const route of ["'/api/repo/deploy-map'", "'/api/repo/mrs'", "'/api/editors'", "'/api/repo/latest-tag'", "'notify-toast'", "'open-editor'", "'open-idea'"]) assert.ok(server.includes(route), route);
assert.match(web('modern.js'), /releases:'cloud','merge-requests':'merge',dependencies:'tools'/);
assert.match(web('fleet.js'), /GitDeckIntegrations\?\.deployedIn/);
assert.match(web('integrations.js'), /not verified live deployments/);
assert.match(web('fleet.js'), /t\('Configured in Git'\)/);
assert.doesNotMatch(web('fleet.js'), /t\('Deployed to'\)/, 'Git configuration must not claim runtime deployment');
console.log('PASS: releases by environment, merge requests, dependency versions, notifications and editors');
