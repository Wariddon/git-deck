const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');
const C = require('../web/effective-config.js');

// The YAML reader of web/fleet.js, loaded the way tests/fleet.test.cjs does.
const context = { el: () => ({}), t: (text) => text, api: async () => ({}), state: {}, document: { querySelector: (selector) => (selector === '.operations-tabs' ? { querySelector: () => null } : null) }, localStorage: { getItem: () => null, setItem() {} } };
context.window = context;
context.window.GitDeckFleet = { addPanel() {}, pendingResults: () => [] };
vm.runInNewContext(web('fleet.js'), context);
const flattenYaml = context.GitDeckFleet.flattenYaml;

// Relaxed binding: property and environment variable forms are one setting.
assert.equal(C.canon('spring.kafka.bootstrap-servers'), C.canon('SPRING_KAFKA_BOOTSTRAPSERVERS'));
assert.equal(C.canon('my.list[0].name'), C.canon('MY_LIST_0_NAME'));
assert.notEqual(C.canon('spring.datasource.url'), C.canon('spring.datasource.username'));

// A ConfigMap with plain keys, a mounted application.yml block, and a Deployment env list.
const deploy = [
  'apiVersion: v1', 'kind: ConfigMap', 'metadata:', '  name: billing-svc-config', 'data:',
  '  SPRING_DATASOURCE_URL: "jdbc:postgresql://uat-db:5432/billing"', '  LOG_LEVEL: DEBUG',
  '  application.yml: |', '    server:', '      port: 9090', '    feature:', '      flag: true',
  '---', 'apiVersion: apps/v1', 'kind: Deployment', 'spec:', '  template:', '    spec:', '      containers:', '        - name: app',
  '          env:', '            - name: SPRING_PROFILES_ACTIVE', '              value: "uat"', '            - name: SECRET_FROM_VAULT', '              valueFrom:', '                secretKeyRef: {}',
].join('\n');
const inputs = C.deployInputs(deploy, 'overlays/uat/billing.yaml');
assert.deepEqual(inputs.env.map((item) => `${item.name}=${item.value}`), ['SPRING_DATASOURCE_URL=jdbc:postgresql://uat-db:5432/billing', 'LOG_LEVEL=DEBUG', 'SPRING_PROFILES_ACTIVE=uat']);
assert.equal(inputs.env[0].via, 'billing-svc-config');
assert.equal(inputs.files.length, 1);
assert.equal(inputs.files[0].name, 'application.yml');
assert.match(inputs.files[0].content, /^server:\n {2}port: 9090/);

// Layers lowest first; the deployment wins over application-uat.yml, which wins over application.yml.
const base = flattenYaml('spring:\n  datasource:\n    url: jdbc:postgresql://localhost/billing\n    username: app\nserver:\n  port: 8080\nlogging:\n  level: ${LOG_LEVEL:INFO}\n');
const profile = flattenYaml('spring:\n  datasource:\n    url: jdbc:postgresql://uat-db-old/billing\n');
const rows = C.mergeLayers([
  { label: 'application.yml', map: base },
  { label: 'application-uat.yml', map: profile },
  { label: 'ConfigMap file', map: flattenYaml(inputs.files[0].content) },
  { label: 'env', map: new Map(inputs.env.map((item) => [item.name, item.value])) },
]);
const byKey = new Map(rows.map((row) => [row.key, row]));
const url = byKey.get('spring.datasource.url');
assert.ok(url, 'Property form is shown, not SPRING_DATASOURCE_URL');
assert.equal(url.effective, 'jdbc:postgresql://uat-db:5432/billing');
assert.equal(C.classify(url, 2), 'overridden', 'application-uat.yml value replaced by the ConfigMap');
assert.equal(byKey.get('server.port').effective, '9090');
assert.equal(C.classify(byKey.get('server.port'), 2), 'overridden');
assert.equal(byKey.get('spring.datasource.username').effective, 'app');
assert.equal(C.classify(byKey.get('spring.datasource.username'), 2), 'file');
assert.equal(byKey.get('logging.level').effective, 'DEBUG', '${LOG_LEVEL:INFO} resolved from the ConfigMap');
assert.equal(C.classify(byKey.get('feature.flag'), 2), 'deploy-only');
assert.equal(C.resolvePlaceholders('${MISSING:fallback}', new Map()), 'fallback');
assert.equal(C.resolvePlaceholders('${MISSING}', new Map()), '${MISSING}');

// .properties files.
assert.equal(C.flattenProperties('# c\nserver.port=8081\nspring.application.name: billing\n').get('spring.application.name'), 'billing');

// Wiring.
const html = web('index.html');
assert.ok(html.indexOf('/effective-config.js') > html.indexOf('/fleet.js') && html.indexOf('/effective-config.js') < html.indexOf('/cockpit.js'));
const server = fs.readFileSync(path.join(__dirname, '../git-dashboard-server.ps1'), 'utf8');
assert.ok(server.includes("'/api/repo/effective-config'"));
assert.ok(((id) => require('../web/cockpit.js').intentGroups.flatMap(([, ids]) => ids).concat(require('../web/cockpit.js').moreViews).includes(id))('effective-config'), 'In the Dashboard menu');
console.log('PASS: effective config (relaxed binding, ConfigMap keys/files, env lists, layer order, placeholders)');

// lns-deployment-2 style: manifestvalues/{env}/lns-app-configuration/{svc}.yml is a plain Spring file.
const plain = C.deployInputs('spring:\n  data:\n    redis:\n      host: classic.redis\n', 'manifestvalues/dev/lns-app-configuration/src-svc-common.yml', true);
assert.equal(plain.files.length, 1, 'Plain Spring file named after the service is configuration');
assert.equal(C.deployInputs('spring:\n  x: 1\n', 'helmvalues/dev/other.yaml', false).files.length, 0, 'Other plain files are not');
// The real trap: the deployment overrides only host while application.yml sets port, ssl and managed identity.
const trap = C.mergeLayers([
  { label: 'application.yml', map: flattenYaml('spring:\n  data:\n    redis:\n      host: managed.redis\n      port: 10000\n      ssl: true\n      use-managed-identity: true\n') },
  { label: 'profile', map: new Map() },
  { label: 'src-svc-common.yml', map: flattenYaml(plain.files[0].content) },
]);
const partial = C.partialOverrides(trap, 2);
assert.equal(partial.length, 1);
assert.equal(partial[0].group, 'spring.data.redis');
assert.deepEqual(partial[0].deploy, ['host']);
assert.deepEqual(partial[0].files.sort(), ['port', 'ssl', 'use-managed-identity']);
// Environments side by side: a key missing in one environment is drift and comes first.
const matrix = C.compareEnvironments({
  dev: [{ key: 'spring.data.redis.host', effective: 'a', fromDeploy: true }, { key: 'x.y', effective: '1' }],
  uat: [{ key: 'SPRING_DATA_REDIS_HOST', effective: 'b', fromDeploy: true }, { key: 'x.y', effective: '1' }, { key: 'only.uat', effective: '1' }],
});
assert.deepEqual(matrix.map((item) => `${item.key}:${item.kind}`), ['only.uat:missing', 'spring.data.redis.host:different', 'x.y:same']);
assert.deepEqual(matrix[0].missing, ['dev']);
console.log('PASS: effective config for plain config files, partial overrides and environment comparison');
