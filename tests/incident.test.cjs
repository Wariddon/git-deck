const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const I = require('../web/incident.js');
const a = { name: 'crs-a', path: 'C:/a' }, d = { name: 'deploy', path: 'C:/d' };
const list = I.mergeTimeline([
  { kind: 'commit', repo: a, hash: 'h1', date: '2026-10-20T09:00:00+07:00', text: 'fix' },
  { kind: 'commit', repo: a, hash: 'h1', date: '2026-10-20T09:00:00+07:00', text: 'fix (other branch)' },
  { kind: 'deploy', repo: d, hash: 'h2', date: '2026-10-20T11:00:00+07:00', text: 'bump uat' },
  { kind: 'tag', repo: a, tag: '1.2.10', date: '2026-10-20T10:00:00+07:00', text: '1.2.10' },
  { kind: 'commit', repo: a, hash: 'h0', date: '2026-10-17T09:00:00+07:00', text: 'too early' },
], '2026-10-19T00:00:00+07:00', '2026-10-21T00:00:00+07:00');
assert.deepEqual(list.map((item) => item.text), ['bump uat', '1.2.10', 'fix'], 'Newest first, window applied, duplicates once');
assert.deepEqual(I.deployFiles(['README.md', 'manifestvalues/uat/lns-app-configuration/x.yml', 'overlays/uat/kustomization.yaml']), ['manifestvalues/uat/lns-app-configuration/x.yml', 'overlays/uat/kustomization.yaml']);
assert.equal(I.local(new Date(2026, 9, 20, 9, 5)), '2026-10-20T09:05');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
assert.ok(read('web/index.html').indexOf('/incident.js') < read('web/index.html').indexOf('/cockpit.js'));
assert.match(read('web/cockpit.js'), /'incident'/);
console.log('PASS: incident timeline (window, newest first, duplicates once, deploy files)');
