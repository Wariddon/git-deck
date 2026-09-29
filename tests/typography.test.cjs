const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
test('shared UI typography is included in an existing packaged stylesheet', () => {
  const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
  const styles = [...html.matchAll(/rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
  assert.ok(styles.includes('/workspace.css'));
  assert.match(fs.readFileSync(path.join(root, 'Build-Release.ps1'), 'utf8'), /Get-ChildItem -LiteralPath \(Join-Path \$root 'web'\)[^\n]*'\.css'/);
});
test('UI uses one size while preserving code and scalable icons', () => {
  const css = fs.readFileSync(path.join(root, 'web/workspace.css'), 'utf8').split('/* Shared UI typography:')[1];
  assert.match(css, /--ui-text-size: 11px/);
  assert.match(css, /font-size: var\(--ui-text-size\) !important/);
  assert.match(css, /pre, pre \*, \.diff-lines, \.diff-lines \*, svg, svg \*/);
  assert.doesNotMatch(css, /--diff-font-size\s*:/);
});
test('repository rows do not shrink and commit hints stay in normal flow', () => {
  const css = fs.readFileSync(path.join(root, 'web/workspace.css'), 'utf8');
  assert.match(css, /body \.repo-list > \.repo\s*\{[^}]*flex: 0 0 auto/);
  assert.match(css, /body \.commit-shortcut\s*\{[^}]*position: static/);
});
