const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');

// Load web/fleet.js with just enough of the page to get its pure helpers.
const panels = [];
const context = {
  el: () => ({}), t: (text) => text, api: async () => ({}), state: {},
  document: { querySelector: (selector) => (selector === '.operations-tabs' ? { querySelector: () => null } : null) },
  localStorage: { getItem: () => null, setItem() {} },
};
context.window = context;
context.window.GitDeckFleet = { addPanel: (id) => panels.push(id), pendingResults: () => [] };
vm.runInNewContext(web('fleet.js'), context);
const F = context.GitDeckFleet;
assert.equal(panels.join(','), 'tag-all,ticket,compare-files,ci', 'Four new Dashboard views');

// Tag many: the next tag continues the last number and keeps its zero padding.
assert.equal(F.nextTag('feature-enhance-report-ci-poc04'), 'feature-enhance-report-ci-poc05');
assert.equal(F.nextTag('1.2.2-poc14'), '1.2.2-poc15');
assert.equal(F.nextTag('v1.0.9'), 'v1.0.10');
assert.equal(F.nextTag('poc09-final'), 'poc10-final');
assert.equal(F.nextTag('release'), '');

// Compare files: YAML flattened to keys, lists indexed, block scalars kept as one value.
const yaml = F.flattenYaml([
  'spring:', '  datasource:', '    url: jdbc:postgresql://db/app # main db', '    hikari:', '      maximum-pool-size: 10',
  'features:', '  - name: a', '    on: true', '  - plain', 'banner: |', '  text: not a key', 'server:', '  port: 8080', '---', 'spring:', '  profiles: dev',
].join('\n'));
assert.equal(yaml.get('spring.datasource.url'), 'jdbc:postgresql://db/app');
assert.equal(yaml.get('spring.datasource.hikari.maximum-pool-size'), '10');
assert.equal(yaml.get('features[0].name'), 'a');
assert.equal(yaml.get('features[0].on'), 'true');
assert.equal(yaml.get('features[1]'), 'plain');
assert.equal(yaml.get('banner'), '|');
assert.ok(!yaml.has('banner.text') && !yaml.has('text'), 'Block scalar content is not read as keys');
assert.equal(yaml.get('server.port'), '8080');
assert.equal(yaml.get('[1].spring.profiles'), 'dev', 'Second YAML document keeps its own keys');

// Line diff for other files.
const diff = F.lineDiff('a\nb\nc', 'a\nc\nd');
assert.equal(JSON.stringify(diff.filter((line) => line[0] !== ' ')), JSON.stringify([['-', 'b'], ['+', 'd']]));

// Wiring: script loaded after multi-repo.js; Pending work marks new tags; worksets are groups.
const html = web('index.html');
assert.ok(html.indexOf('/fleet.js') > html.indexOf('/multi-repo.js'), 'fleet.js loads after multi-repo.js');
const multi = web('multi-repo.js');
assert.match(multi, /case 'newtag':return isNewTag\(item\);/);
assert.match(multi, /if\(folder\.startsWith\('set:'\)\)/);
assert.match(multi, /window\.GitDeckFleet=\{addPanel,folderSelect,reposIn/);
console.log('PASS: tag suggestions, YAML keys, line diff, new tags and worksets wiring');

// More menu: every item has an icon (Dashboard views, Work report, Custom actions too), drop-down
// menus close on a press elsewhere or Escape, and "Tags" opens the Tags view without the create dialog.
{
  const modern = web('modern.js');
  assert.match(modern, /extra\[button\.dataset\.multiRepo\]\|\|\(button\.dataset\.workReport\?'report':button\.dataset\.customActions\?'sparkles':''\)/);
  assert.match(modern, /document\.addEventListener\('pointerdown',\(event\)=>\{document\.querySelectorAll\(popupMenus\)/);
  assert.match(modern, /const popupMenus='\.sync-more\[open\], \.history-options\[open\]/);
  assert.match(web('index.html'), /<button type="button" data-workbench-nav="tags"><strong>◇ Tags<\/strong>/);
  assert.match(web('fleet.js'), /el\('p','sync-more-group fleet-more-group',t\('All repositories'\)\)/);
  console.log('PASS: More menu icons, grouping and closing');
}
