const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// GitDeck.exe is not in Git, so a clone or pull must still have a way to start: git-dashboard.bat
// builds it when missing or older than the launcher source, and the build leaves Git clean.
assert.match(read('.gitignore'), /^\/GitDeck\.exe$/m, 'GitDeck.exe stays out of Git');
const bat = read('git-dashboard.bat');
assert.ok(bat.includes('\r\n'), 'git-dashboard.bat keeps CRLF line endings');
assert.match(bat, /if exist "%~dp0launcher\\Ensure-GitDeckExe\.ps1" powershell\.exe .*-ExecutionPolicy Bypass -File "%~dp0launcher\\Ensure-GitDeckExe\.ps1"/);
assert.ok(bat.indexOf('Ensure-GitDeckExe.ps1') < bat.indexOf('start "" "%~dp0GitDeck.exe"'), 'Build before starting the launcher');
assert.match(bat, /goto server/, '--console still runs the server in the window');
const ensure = read('launcher/Ensure-GitDeckExe.ps1');
assert.match(ensure, /LastWriteTimeUtc -ge/, 'Rebuild only when the launcher source is newer');
assert.match(ensure, /Build-GitDeck\.ps1/);
const build = read('Build-GitDeck.ps1');
assert.match(build, /param\(\[switch\]\$Artwork, \[switch\]\$Shortcut\)/);
assert.match(build, /if \(\$Artwork -or -not \(Test-Path -LiteralPath \$icon\)\)/, 'Tracked icon files are only redrawn when asked');
const readme = read('README.md');
for (const text of ['the program to run is `git-dashboard.bat`', 'Build-GitDeck.ps1 -Shortcut', 'git pull', 'If it does not start', 'Unblock'])
  assert.ok(readme.includes(text), `README explains: ${text}`);
console.log('PASS: a clone or pull can start Git Deck (launcher built on first start, Git left clean, README steps)');
