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
assert.match(web('cockpit.js'), /'compare-files','effective-config'/);
console.log('PASS: effective config (relaxed binding, ConfigMap keys/files, env lists, layer order, placeholders)');
