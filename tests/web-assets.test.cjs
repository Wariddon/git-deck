const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
// Every local asset in index.html must exist, be servable by the generic static
// route and be copied by Build-Release.ps1; every web/*.js|css must be loaded.
const html = read('web/index.html');
const runtime = read('lib/GitDeck.Runtime.ps1');
const release = read('Build-Release.ps1');
assert.match(release, /'CHANGELOG\.md'/, 'Portable package includes release notes');
assert(release.indexOf('Release ZIP already exists') < release.indexOf("'Build-GitDeck.ps1'"), 'Existing release is refused before rebuilding binaries');
const served = new Set([...runtime.match(/\$script:StaticTypes = @\{([\s\S]*?)\n\}/)[1].matchAll(/'(\.[a-z0-9]+)'=/g)].map((m) => m[1]));
const packaged = new Set([...release.match(/Get-ChildItem -LiteralPath \(Join-Path \$root 'web'\)[^\n]*Extension -in @\(([^)]*)\)/)[1].matchAll(/'(\.[a-z0-9]+)'/g)].map((m) => m[1]));
const flatName = /^\/([A-Za-z0-9][A-Za-z0-9_-]*\.[a-z]{2,4})$/; // Get-GitDeckStaticPath
const referenced = new Set();
for (const [, url] of html.matchAll(/\s(?:href|src)="(\/[^"]*)"/g)) {
  const route = url.split(/[?#]/)[0];
  if (route === '/' || route.startsWith('//')) continue;
  const match = route.match(flatName);
  assert(match, `${url} is not a flat web/ file name the server can serve`);
  const name = match[1], ext = path.extname(name);
  assert(fs.existsSync(path.join(root, 'web', name)), `${url} is referenced but web/${name} does not exist`);
  assert(served.has(ext), `${url}: ${ext} is not in $script:StaticTypes`);
  assert(packaged.has(ext), `${url}: ${ext} is not copied by Build-Release.ps1`);
  referenced.add(name);
}
for (const name of fs.readdirSync(path.join(root, 'web'))) {
  if (/\.(js|css)$/.test(name)) assert(referenced.has(name), `web/${name} is never loaded by index.html`);
}
assert(referenced.size >= 10, 'Asset scan found suspiciously few references');
console.log(`PASS: ${referenced.size} index.html assets exist, are served and packaged; no orphan web/*.js|css`);
