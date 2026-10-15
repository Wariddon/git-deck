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
