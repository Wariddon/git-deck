const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');

// Windows PowerShell 5.1 reads a .ps1 file without a byte order mark as ANSI, so "…", "→" or "·"
// in a string reached the UI as "â€¦", "â†’" or "Â·". Keep code lines ASCII; comments may use anything.
const files = ['git-dashboard-server.ps1', 'git-job-worker.ps1', 'git-workflow-tools.ps1', 'git-diff-content.ps1',
  ...fs.readdirSync(path.join(root, 'lib')).filter((name) => name.endsWith('.ps1')).map((name) => `lib/${name}`)];
const problems = [];
for (const file of files) {
  const bytes = fs.readFileSync(path.join(root, file));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) continue; // a BOM makes UTF-8 safe
  bytes.toString('utf8').split(/\r?\n/).forEach((line, index) => {
    const code = line.replace(/(^|\s)#.*$/, '');
    if (/[^\x00-\x7f]/.test(code)) problems.push(`${file}:${index + 1}: ${code.trim().slice(0, 80)}`);
  });
}
assert.deepEqual(problems, [], 'Non-ASCII text in PowerShell code without a BOM');
console.log(`PASS: ${files.length} PowerShell files keep strings ASCII (safe for Windows PowerShell 5.1)`);
