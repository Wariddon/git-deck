const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
global.t = (text, values) => String(text).replace(/\{(\w+)\}/g, (_, key) => values?.[key] ?? '');
const C = require('../web/command-actions.js');

assert.deepEqual(C.parseIntent('tag crs- next'), { verb: 'tag', target: 'crs-', arg: '' });
assert.deepEqual(C.parseIntent('tag crs-webview fatca-01'), { verb: 'tag', target: 'crs-webview', arg: 'fatca-01' });
assert.deepEqual(C.parseIntent('push aml-'), { verb: 'push', target: 'aml-', arg: '' });
assert.deepEqual(C.parseIntent('ap2365-3320'), { verb: 'ticket', target: 'AP2365-3320' });
assert.deepEqual(C.parseIntent('ticket AP2365-3320'), { verb: 'ticket', target: 'AP2365-3320' });
assert.equal(C.parseIntent('crs-webview'), null, 'A repository name without a number is not a ticket');
assert.equal(C.parseIntent('commit history'), null);

const repos = ['crs-webview', 'crs-web-gateway', 'aml-webview', 'crs-webview2'].map((name) => ({ name, path: `C:/SCB/${name}` })).concat([{ name: 'crs-webview', path: 'C:/SCB/crs-webview.worktrees/AP-1' }]);
assert.deepEqual(C.matchRepos('crs-', repos).map((r) => r.name), ['crs-webview', 'crs-web-gateway', 'crs-webview2'], 'Family prefix, worktrees left out');
assert.deepEqual(C.matchRepos('crs-webview', repos).map((r) => r.name), ['crs-webview'], 'Exact name first');
assert.deepEqual(C.matchRepos('crs-web*', repos).map((r) => r.name), ['crs-webview', 'crs-web-gateway', 'crs-webview2']);

const repo = (name) => ({ name, path: `C:/SCB/${name}` });
const nextTag = (tag) => tag.replace(/(\d+)$/, (n) => String(Number(n) + 1));
const tagGuard = (name, branch) => (/^\d/.test(name) && !/^release/.test(branch) ? `${branch.split('/').pop()}-01` : '');
const plan = C.planFor({ verb: 'tag', arg: '' }, [
  { repo: repo('a'), pending: { branch: 'release', latestTag: '1.2.6', commitsSinceTag: 4 } },
  { repo: repo('b'), pending: { branch: 'release', latestTag: '2.0.3', commitsSinceTag: 0 } },
  { repo: repo('c'), pending: { branch: 'feature/fatca-dec-2026', latestTag: '1.2.9', commitsSinceTag: 1 } },
  { repo: repo('d'), pending: null },
], { nextTag, tagGuard });
assert.deepEqual(plan.map((r) => [r.run, r.tag || '']), [[true, '1.2.7'], [false, ''], [true, 'fatca-dec-2026-01'], [false, '']]);
const push = C.planFor({ verb: 'push' }, [{ repo: repo('a'), pending: { branch: 'dev', upstream: 'origin/dev', ahead: 2 } }, { repo: repo('b'), pending: { branch: 'x', upstream: '', ahead: 1 } }, { repo: repo('c'), pending: { ahead: 0 } }]);
assert.deepEqual(push.map((r) => r.run), [true, false, false]);
const pull = C.planFor({ verb: 'pull' }, [{ repo: repo('a'), pending: { branch: 'main', behind: 3, changed: 1 } }]);
assert.ok(pull[0].run && /stashed/.test(pull[0].note));

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
assert.ok(read('web/index.html').indexOf('/app.js') < read('web/index.html').indexOf('/command-actions.js'));
console.log('PASS: command bar actions (intents, repository matching, tag/push/pull plans)');
