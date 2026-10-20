const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const L = require('../web/log-locate.js');

const log = [
  'com.scb.lns.crs.CustomerException: proxy not found',
  '\tat com.scb.lns.crs.service.ProxyService.find(ProxyService.java:88)',
  '\tat com.scb.lns.crs.service.ProxyService$$SpringCGLIB$$0.find(<generated>)',
  '\tat org.springframework.aop.framework.CglibAopProxy.intercept(CglibAopProxy.java:720)',
  '\tat com.scb.lns.crs.web.ProxyController.get(ProxyController.java:41)',
  '\tat com.scb.lns.crs.service.ProxyService.find(ProxyService.java:88)',
  'Caused by: java.net.SocketTimeoutException: Read timed out',
  'panic at internal/handler/order.go:57 and node_modules/x/y.js:3',
].join('\n');
const parsed = L.parseLog(log);
assert.deepEqual(parsed.frames.map((f) => `${f.file}:${f.line}`), [
  'com/scb/lns/crs/service/ProxyService.java:88', 'com/scb/lns/crs/web/ProxyController.java:41', 'internal/handler/order.go:57'],
  'Own frames once each, framework and node_modules skipped');
assert.deepEqual(parsed.exceptions, ['com.scb.lns.crs.CustomerException', 'java.net.SocketTimeoutException']);
assert.equal(L.parseLog('nothing here').frames.length, 0);

const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');
assert.ok(web('index.html').indexOf('/log-locate.js') < web('index.html').indexOf('/cockpit.js'));
assert.match(web('cockpit.js'), /'family-edit','log-locate'/);
assert.ok(fs.readFileSync(path.join(__dirname, '../git-dashboard-server.ps1'), 'utf8').includes("'/api/repo/find-files'"));
console.log('PASS: find from an error log (own frames, exceptions, wiring)');
