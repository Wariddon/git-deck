const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const A = require('../web/api-map.js');

assert.equal(A.normalizePath('/v1/Case/{id}/'), '/v1/case/{}');
assert.ok(A.callMatches('/gw/v1/svc-customer-request/case/create-request', '/v1/svc-customer-request/case/create-request'), 'A gateway prefix is fine');
assert.ok(A.callMatches('/v1/case/${caseId}', '/v1/case/{id}'));
assert.ok(!A.callMatches('/v1/case', '/case'), 'One segment is too loose');
const src = { name: 'src-svc' }, txi = { name: 'txi-svc' }, web = { name: 'src-web' };
const results = [
  { repo: src, surface: { provides: [{ method: 'POST', path: '/v1/svc/case/create', file: 'A.java', line: 10 }], calls: [{ path: '/v2/customerServices/promptPay/findByProxy', file: 'application.yml', line: 96, via: 'config' }], listens: [{ topic: '${app.kafka.topic}', resolved: 'case-created', file: 'L.java', line: 5 }], sends: [] } },
  { repo: txi, surface: { provides: [], calls: [{ path: '/sales-services/v1/customerServices/promptPay/findByProxy', file: 'application.yml', line: 50, via: 'config' }], listens: [], sends: [{ topic: 'case-created', file: 'P.java', line: 9 }] } },
  { repo: web, surface: { provides: [], calls: [{ path: '/api/v1/svc/case/create', file: 'Client.java', line: 3, via: 'feign' }], listens: [], sends: [] } },
];
const map = A.buildMap(results);
assert.equal(map.endpoints[0].callers[0].repo, web, 'The web app calls the service through a prefix');
assert.equal(map.outside.length, 2, 'EAPI calls are provided outside the folder');
const drift = A.versionDrift(results);
assert.equal(drift.length, 1);
assert.equal(drift[0].operation, 'promptpay/findbyproxy');
assert.deepEqual(drift[0].variants.map((v) => v.repos[0]).sort(), ['src-svc', 'txi-svc']);
const kafka = A.topics(results);
assert.equal(kafka[0].topic, 'case-created');
assert.equal(kafka[0].producers[0].repo, txi);
assert.equal(kafka[0].consumers[0].repo, src);

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
assert.ok(read('web/index.html').indexOf('/api-map.js') < read('web/index.html').indexOf('/cockpit.js'));
assert.ok(read('git-dashboard-server.ps1').includes("'/api/repo/api-surface'"));
console.log('PASS: API map (paths, prefix matching, outside calls, version drift, Kafka topics)');
