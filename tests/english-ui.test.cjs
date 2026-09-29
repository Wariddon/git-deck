const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
// Check shipped application copy, not user repository data or test fixtures.
for (const dir of ['web', 'launcher']) {
  for (const name of fs.readdirSync(path.join(root, dir))) {
    if (!/\.(js|html|cs)$/.test(name)) continue;
    // Translations live only in the i18n dictionaries; everything else ships English source copy.
    if (/^i18n(-[a-z]+)?\.js$/.test(name)) continue;
    const source = fs.readFileSync(path.join(root, dir, name), 'utf8');
    assert(!/[\u0e00-\u0e7f]/u.test(source), `${dir}/${name} contains untranslated Thai copy`);
    assert(!source.includes('th-TH'), `${dir}/${name} forces a Thai locale`);
  }
}
assert.match(fs.readFileSync(path.join(root, 'web/index.html'), 'utf8'), /<html lang="en">/);
console.log('PASS: shipped UI and launcher use English copy and document language');
