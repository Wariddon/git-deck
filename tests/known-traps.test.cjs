const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const K = require('../web/known-traps.js');

assert.equal(K.tryRule({ file: '\\.java$', line: '@Value\\("\\$\\{' }, 'src/A.java', '  @Value("${redis.host}")').ok, true);
assert.equal(K.tryRule({ file: '\\.java$', line: '@Value' }, 'pom.xml', '@Value').ok, false, 'Wrong file');
assert.equal(K.tryRule({ file: '.', line: '(?i)content-length', also: '(?i)header' }, 'a', 'headers.set("Content-Length", x)').ok, true, '(?i) like .NET');
assert.ok(K.tryRule({ file: '(', line: 'x' }, 'a', 'x').error, 'Invalid pattern reported');
assert.equal(K.slug('Content-Length forwarded!'), 'content-length-forwarded');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
assert.ok(read('web/index.html').indexOf('/known-traps.js') < read('web/index.html').indexOf('/cockpit.js'));
assert.ok(read('git-dashboard-server.ps1').includes("'traps-save'") && read('git-dashboard-server.ps1').includes("'/api/traps'"));
console.log('PASS: known traps (try a rule, case-insensitive patterns, ids, wiring)');
