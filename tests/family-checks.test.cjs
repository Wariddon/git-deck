const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const C = require('../web/family-checks.js');
const rule = (id) => C.defaultRules.find((item) => item.id === id);

// Capture: the last FROM of a multi-stage Dockerfile.
const docker = 'FROM maven:3 AS build\nRUN mvn package\nFROM harbordev.se.scb.co.th/library/eclipse-temurin:17-scb-1.53\nCOPY x y\n';
assert.deepEqual(C.evaluate(rule('base-image'), docker), { state: 'value', value: '17-scb-1.53' });
assert.deepEqual(C.evaluate(rule('base-image'), null), { state: 'none' });
assert.equal(C.evaluate(rule('boot'), '<parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId>\n  <version>3.5.16</version></parent>').value, '3.5.16');
// Contains: argo_yaml must be there; the provided uber jar must not.
assert.equal(C.evaluate(rule('argo-yaml'), 'stage { argo_yaml = "helmvalues/sit/x.yaml" }').state, 'ok');
assert.equal(C.evaluate(rule('argo-yaml'), 'stage { }').state, 'bad');
const pom = '<dependency><groupId>com.ci.lib</groupId><artifactId>ci-lib-module</artifactId>\n<version>1.4</version>\n<scope>provided</scope></dependency>';
assert.equal(C.evaluate(rule('provided-uber-jar'), pom).state, 'bad');
assert.equal(C.evaluate(rule('provided-uber-jar'), pom.replace('provided', 'compile')).state, 'ok');
// Exclusions and odd ones out.
assert.ok(!C.applies(rule('argo-yaml'), 'crs-db-migration') && C.applies(rule('argo-yaml'), 'crs-web-gateway'));
const odd = C.oddOnes(['17-scb-1.53', '17-scb-1.53', '17-scb-1.40', undefined]);
assert.equal(odd.common, '17-scb-1.53');
assert.deepEqual([...odd.odd], ['17-scb-1.40']);
assert.equal(C.evaluate({ type: 'contains', pattern: '(', expect: true }, 'x').value, 'invalid pattern');

const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');
assert.ok(web('index.html').indexOf('/family-checks.js') < web('index.html').indexOf('/cockpit.js'));
assert.ok(((id) => require('../web/cockpit.js').intentGroups.flatMap(([, ids]) => ids).concat(require('../web/cockpit.js').moreViews).includes(id))('family-checks'), 'In the Dashboard menu');
console.log('PASS: family checks (capture, contains, exclusions, odd ones out)');
