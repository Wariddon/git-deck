// The MCP server speaks JSON-RPC over stdio and answers from Git Deck's GET API (a fake one here).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
if (process.platform !== 'win32') { console.log('SKIP: MCP server needs Windows PowerShell'); process.exit(0); }

const repos = [{ name: 'crs-a', path: 'C:/x/crs-a', branch: 'main', valid: true }, { name: 'crs-b', path: 'C:/x/crs-b', branch: 'dev', valid: true }, { name: 'aml-c', path: 'C:/x/aml-c', branch: 'main', valid: true }];
const files = { 'C:/x/crs-a': 'FROM eclipse-temurin:17-scb-1.53\n', 'C:/x/crs-b': 'FROM eclipse-temurin:17-scb-1.40\n' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/api/repos') return send({ repos });
  if (url.pathname === '/api/repo/file') { const text = files[url.searchParams.get('path')]; return send({ file: { file: url.searchParams.get('file'), exists: text !== undefined, content: text || '' } }); }
  if (url.pathname === '/api/repo/pending') return send({ pending: { branch: 'main', upstream: 'origin/main', ahead: url.searchParams.get('path').endsWith('crs-a') ? 2 : 0, behind: 0, changed: 0, untracked: 0, unpushedBranches: [], stashes: [], lastCommitDate: '2020-01-01T00:00:00Z' } });
  send({ error: 'Not found' }, 404);
});
server.listen(0, '127.0.0.1', async () => {
  const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'mcp', 'gitdeck-mcp.ps1'), '-BaseUrl', `http://127.0.0.1:${server.address().port}`]);
  let buffer = ''; const waiting = new Map(); let id = 0;
  child.stdout.on('data', (data) => { buffer += data; let at; while ((at = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1); if (line) { const message = JSON.parse(line); waiting.get(message.id)?.(message); } } });
  const call = (method, params) => new Promise((resolve) => { const n = ++id; waiting.set(n, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
  const tool = async (name, args) => { const answer = await call('tools/call', { name, arguments: args }); return { error: answer.result.isError === true, text: answer.result.content[0].text }; };
  try {
    const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.result.serverInfo.name, 'gitdeck');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const list = await call('tools/list', {});
    const names = list.result.tools.map((item) => item.name);
    for (const name of ['pending_work', 'compare_file_across_family', 'effective_config_sources', 'ticket', 'push_risk', 'api_usage']) assert.ok(names.includes(name), name);
    assert.ok(Array.isArray(list.result.tools.find((item) => item.name === 'read_file').inputSchema.required));
    const family = JSON.parse((await tool('compare_file_across_family', { prefix: 'crs-', file: 'Dockerfile', pattern: 'eclipse-temurin:([0-9a-z.-]+)' })).text);
    assert.deepEqual(family.map((row) => [row.repo, row.value]), [['crs-a', '17-scb-1.53'], ['crs-b', '17-scb-1.40']]);
    const pending = JSON.parse((await tool('pending_work', { prefix: 'crs-' })).text);
    assert.deepEqual(pending.map((row) => [row.repo, row.pending]), [['crs-a', '2 to push']], 'Only repositories with something pending');
    const missing = await tool('read_file', { repo: 'nope', file: 'x' });
    assert.ok(missing.error && /No registered repository named nope/.test(missing.text));
    const unknown = await call('no/such', {});
    assert.equal(unknown.error.code, -32601);
    console.log('PASS: MCP server (initialize, tools, a file across a family, pending work, errors)');
  } finally { child.stdin.end(); server.close(); }
});
