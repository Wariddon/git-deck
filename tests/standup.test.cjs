const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
global.t = (text, values) => String(text).replace(/\{(\w+)\}/g, (_, key) => values?.[key] ?? '');
const S = require('../web/standup.js');

// Monday looks back to Friday; the weekend too; other days to yesterday.
assert.equal(S.day(S.previousWorkday(new Date(2026, 9, 19))), '2026-10-16');
assert.equal(S.day(S.previousWorkday(new Date(2026, 9, 18))), '2026-10-16');
assert.equal(S.day(S.previousWorkday(new Date(2026, 9, 21))), '2026-10-20');

const text = S.buildStandup({
  since: '2026-10-19', today: new Date(2026, 9, 20),
  done: [{ repo: { name: 'crs-webview' }, branch: 'feature/AP2365-3400-fatca', commits: [{ subject: 'feat(crs): update consent wording' }, { subject: 'feat(crs): update consent wording' }] }],
  state: [
    { repo: { name: 'crs-webview' }, pending: { branch: 'feature/AP2365-3400-fatca', upstream: 'origin/x', latestTag: '1.2.9', commitsSinceTag: 1 } },
    { repo: { name: 'aml-webview' }, pending: { branch: 'development', upstream: 'origin/development', changed: 2, unpushedBranches: [{ branch: 'release', commits: 1 }] } },
    { repo: { name: 'lns-azure-adf' }, pending: { branch: 'feature/aml-to-blob-zip', upstream: 'origin/feature/aml-to-blob-zip', upstreamGone: true } },
  ],
});
assert.match(text, /^Standup 2026-10-20/);
assert.match(text, /- crs-webview \(feature\/AP2365-3400-fatca\) AP2365-3400\n  - feat\(crs\): update consent wording\n\n/, 'One line per subject, ticket key from the branch');
assert.match(text, /- crs-webview: tag\/deploy: 1 commit\(s\) after 1\.2\.9/);
assert.match(text, /- aml-webview: commit 2 changed file\(s\), push release \(1\)/);
assert.match(text, /Blocked:\n- lns-azure-adf: feature\/aml-to-blob-zip was deleted on the remote/);
assert.match(S.buildStandup({ since: '2026-10-19' }), /No commits of mine\.[\s\S]*\(write the plan\)[\s\S]*Nothing/);

const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');
assert.ok(web('index.html').includes('/standup.js'));
assert.match(web('multi-repo.js'), /GitDeckStandup\.open\(pool\)/);
console.log('PASS: standup draft (last working day, done, today, blocked)');
