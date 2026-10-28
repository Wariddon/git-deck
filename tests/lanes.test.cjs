const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
global.t = (text, values) => String(text).replace(/\{(\w+)\}/g, (_, key) => values?.[key] ?? '');
const L = require('../web/lanes.js');

assert.equal(L.keyOf('feature/AP2365-3320-promptpay'), 'AP2365-3320');
assert.equal(L.keyOf('feature/ap2365-3320'), 'AP2365-3320');
assert.equal(L.keyOf('development'), '');
assert.equal(L.keyOf('feature/fatca-dec-2026'), '', 'Not DEC-2026');
assert.equal(L.keyOf('AP-12'), 'AP-12');
assert.equal(L.keyOf('feature/AP2365-24XX-local'), '', 'Not AP2365-24');
assert.equal(L.keyOf('feature/portal/dev-01'), '', 'Not DEV-01');
assert.equal(L.keyOf('hotfix/LBC-9878-line-login-issue'), 'LBC-9878');
const lanes = L.detectLanes(
  [
    { path: 'C:/SCB/src-svc', pending: { branch: 'feature/AP2365-3320', unpushedBranches: [] } },
    { path: 'C:/SCB/crs-webview', pending: { branch: 'feature/fatca-dec-2026', unpushedBranches: [{ branch: 'feature/AP2365-3593', commits: 1 }] } },
    { path: 'C:/SCB/aml', pending: { branch: 'development' } },
  ],
  [{ key: 'AP2365-3320', main: 'C:/SCB/txi-svc', path: 'C:/SCB/txi-svc.worktrees/AP2365-3320', branch: 'feature/AP2365-3320' }],
  ['PAY-7'],
);
assert.deepEqual(lanes.map((l) => [l.key, l.repos.length]), [['AP2365-3320', 2], ['AP2365-3593', 1], ['PAY-7', 0]]);

assert.equal(L.nextStep([]).text, 'Find the repositories of this ticket');
assert.equal(L.nextStep([{ pending: { changed: 1 } }]).text, 'Commit your changes');
assert.equal(L.nextStep([{ pending: {}, journey: { pushed: true, merged: [], firstTag: null } }]).text, 'Open or merge the merge request');
assert.equal(L.nextStep([{ pending: {}, journey: { pushed: true, merged: ['origin/main'], firstTag: { name: '1.0' }, environments: [{ env: 'prod', contains: false }] } }]).text, 'Promote to the next environment');
assert.equal(L.nextStep([{ pending: {}, journey: { pushed: true, merged: ['origin/main'], firstTag: { name: '1.0' }, environments: [] } }]).tone, 'ok');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
assert.ok(read('web/index.html').indexOf('/lanes.js') < read('web/index.html').indexOf('/cockpit.js'));
assert.match(read('web/cockpit.js'), /'lanes'/);
console.log('PASS: ticket lanes (keys from branches and worktrees, next step)');
