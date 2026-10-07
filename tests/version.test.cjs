const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// One version everywhere: release build default, server readiness, launcher, issue report, About.
const version = read('Build-Release.ps1').match(/\$Version='(\d+\.\d+\.\d+)'/)[1];
assert.ok(read('git-dashboard-server.ps1').includes(`appVersion='${version}'`), 'Server reports the release version');
assert.ok(read('launcher/GitDeckLauncher.cs').includes(`AssemblyFileVersion("${version}.0")`), 'Launcher file version matches');
assert.ok(read('web/release-tools.js').includes(`version:'${version}'`), 'Issue report version matches');
assert.ok(read('web/index.html').includes(`Git Deck Desktop · v${version}`), 'About shows the version');
console.log(`PASS: version ${version} is consistent`);
