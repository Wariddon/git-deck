const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const E = require('../web/family-edit.js');

// Literal and regular expression edits, every match, with $1 groups.
assert.deepEqual(E.applyEdit('a.b a.b', { find: 'a.b', replace: 'x' }), { after: 'x x', count: 2 });
const docker = 'FROM maven:3 AS build\nFROM reg/eclipse-temurin:17-scb-1.40\n';
const base = E.presets['base-image'];
assert.equal(E.applyEdit(docker, { ...base, replace: '$117-scb-1.53' }).after, 'FROM maven:3 AS build\nFROM reg/eclipse-temurin:17-scb-1.53\n');
const pom = '<parent><artifactId>spring-boot-starter-parent</artifactId>\n  <version>3.5.6</version></parent>';
assert.match(E.applyEdit(pom, { ...E.presets['spring-boot'], replace: '$13.5.16$2' }).after, /<version>3\.5\.16<\/version>/);
assert.equal(E.applyEdit('x', { find: 'y', replace: 'z' }).count, 0);
assert.ok(E.applyEdit('x', { find: '(', regex: true }).error);

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
assert.ok(read('web/index.html').indexOf('/family-edit.js') < read('web/index.html').indexOf('/cockpit.js'));
assert.ok(read('web/index.html').indexOf('/fleet.js') < read('web/index.html').indexOf('/family-edit.js'), 'lineDiff comes from fleet.js');
assert.ok(((id) => require('../web/cockpit.js').intentGroups.flatMap(([, ids]) => ids).concat(require('../web/cockpit.js').moreViews).includes(id))('family-edit'), 'In the Dashboard menu');
for (const route of ["'family-edit'", "'/api/repo/family-edit-source'"]) assert.ok(read('git-dashboard-server.ps1').includes(route), route);
console.log('PASS: family edit (literal and regex edits, presets, wiring)');
// Carry a commit over: the same line replaced where it exists, keeping this file's indentation.
{
  const r = E.applyPairs('<a>\n    <java.version>17</java.version>\r\n  <x/>\n', [{ old: '  <java.version>17</java.version>', new: '  <java.version>21</java.version>' }, { old: 'not here', new: 'x' }]);
  assert.equal(r.count, 1);
  assert.equal(r.after, '<a>\n    <java.version>21</java.version>\r\n  <x/>\n');
  assert.equal(E.applyPairs('a', [{ old: '', new: 'b' }]).count, 0, 'Empty lines are not replaced everywhere');
}
