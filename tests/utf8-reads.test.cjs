const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');

// Git Deck writes its files as UTF-8 without a BOM. Windows PowerShell 5.1 reads such files with the
// ANSI code page unless told otherwise, which turned Thai commit messages in the repository list
// into "à¹ƒà¸ª…". Every Get-Content must say -Encoding UTF8.
const files = ['git-dashboard-server.ps1', 'git-job-worker.ps1', 'git-workflow-tools.ps1', ...fs.readdirSync(path.join(root, 'lib')).filter((n) => n.endsWith('.ps1')).map((n) => `lib/${n}`)];
for (const file of files) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  fs.readFileSync(full, 'utf8').split(/\r?\n/).forEach((line, index) => {
    for (const call of line.match(/Get-Content\b[^|;}]*/g) || []) assert.match(call, /-Encoding\s+UTF8/i, `${file}:${index + 1} reads without -Encoding UTF8: ${call.trim()}`);
  });
}
// The repository row keeps its status visible when the message or path is long.
assert.match(fs.readFileSync(path.join(root, 'web/features.css'), 'utf8'), /#repo-list \.repo \.repo-meta>i\{flex:0 0 auto\}/);
console.log('PASS: server files are read as UTF-8; repository status is never clipped');
