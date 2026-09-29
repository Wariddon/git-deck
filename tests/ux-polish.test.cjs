const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'web/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
const slice = (start, end) => app.slice(app.indexOf(start), app.indexOf(end));

// Working diff rows: real line numbers, git header lines marked for hiding, one row per patch line.
const diffContext = {};
vm.runInNewContext(slice('function workingDiffRow(', 'function renderWorkingPatch('), diffContext);
const patch = ['diff --git a/f b/f', 'index 1..2 100644', '--- a/f', '+++ b/f', '@@ -10,3 +10,4 @@ fn', ' keep', '-old', '+new', '+added', ' tail', '\\ No newline at end of file'];
let cursor = { inHunk: false, oldNo: 0, newNo: 0 };
const rows = patch.map((line) => { const row = diffContext.workingDiffRow(line, cursor.inHunk, cursor.oldNo, cursor.newNo); cursor = row; return `${row.kind}|${row.old}|${row.new}`; });
assert.deepEqual(rows, [
  'diff-meta||', 'diff-meta||', 'diff-meta||', 'diff-meta||', 'diff-hunk||',
  '|10|10', 'diff-remove|11|', 'diff-add||11', 'diff-add||12', '|12|13', 'diff-eof||',
]);
assert.equal(diffContext.workingDiffRow('new file mode 100644', false, 0, 0).kind, 'diff-file', 'Meaningful headers stay visible');
assert.equal(diffContext.workingDiffRow('--- removed line that looks like a header', true, 5, 5).kind, 'diff-remove', 'Inside a hunk, --- is a removed line');
assert.match(app, /renderLines\(parsed\.header,false\)/, 'Header-only patches (binary, mode) are shown unnumbered and unhidden');

// Fetch freshness text and button state.
const nodes = { 'status-fetch': { textContent: '', title: '', disabled: false, classList: { stale: false, toggle(name, on) { this.stale = on; } } } };
const fetchContext = { $: (id) => nodes[id] };
vm.runInNewContext(slice('function fetchAgeText(', 'function renderWorkspaceStatus('), fetchContext);
const now = Date.parse('2026-09-29T12:00:00Z');
const ago = (minutes) => new Date(now - minutes * 60000).toISOString();
assert.equal(fetchContext.fetchAgeText('', now), 'Never fetched');
assert.equal(fetchContext.fetchAgeText(ago(0.5), now), 'Fetched just now');
assert.equal(fetchContext.fetchAgeText(ago(5), now), 'Fetched 5 min ago');
assert.equal(fetchContext.fetchAgeText(ago(150), now), 'Fetched 2 h ago');
assert.equal(fetchContext.fetchAgeText(ago(60 * 50), now), 'Fetched 2 d ago');
const status = nodes['status-fetch'];
fetchContext.renderFetchStatus({ remotes: [{ name: 'origin' }], lastFetchAt: ago(10) }, now);
assert.equal(status.textContent, 'Fetched 10 min ago'); assert.equal(status.classList.stale, false); assert.equal(status.disabled, false);
fetchContext.renderFetchStatus({ remotes: [{ name: 'origin' }], lastFetchAt: ago(90) }, now);
assert.equal(status.textContent, 'Fetched 1 h ago · Fetch now'); assert.equal(status.classList.stale, true);
fetchContext.renderFetchStatus({ remotes: [{ name: 'origin' }] }, now);
assert.equal(status.textContent, 'Never fetched · Fetch now');
fetchContext.renderFetchStatus({ remotes: [] }, now);
assert.equal(status.textContent, 'No remote'); assert.equal(status.disabled, true); assert.equal(status.classList.stale, false);
assert.match(html, /<button type="button" id="status-fetch"/);
assert.match(app, /\$\('status-fetch'\)\.addEventListener\('click'/);

// Tab highlight: top tabs and the File Status / History switcher always agree.
const button = (data) => ({ dataset: data, attrs: {}, active: false, classList: { toggle(name, on) { button.last = on; this.owner.active = on; } }, setAttribute(k, v) { this.attrs[k] = v; } });
const top = [button({ workspaceTab: 'changes' }), button({ workspaceTab: 'history' })];
const tree = [button({ treeView: 'changes' }), button({ treeView: 'history' })];
[...top, ...tree].forEach((b) => { b.classList.owner = b; });
const tabContext = { document: { querySelectorAll: (selector) => selector.includes('tree-view') ? tree : top } };
vm.runInNewContext(slice('function syncWorkspaceTabButtons(', 'function renderWorkbenchTree('), tabContext);
tabContext.syncWorkspaceTabButtons('changes');
assert.deepEqual([...top, ...tree].map((b) => b.active), [true, false, true, false]);
assert.equal(tree[0].attrs['aria-pressed'], 'true');
const openWorkspace = slice('async function openWorkspace(', 'function showWorkspaceRetry(');
assert.match(openWorkspace, /syncWorkspaceTabButtons\(tab\)/, 'Opening a repository syncs both tab groups');

// Status bar exposes the command palette; Worksets is not squeezed into the square "+" slot.
assert.match(html, /id="status-commands"[^>]*>.*Ctrl\+K/);
const workflow = fs.readFileSync(path.join(root, 'web/workflow-ui.js'), 'utf8');
assert.match(workflow, /classList\.add\('repo-tab-search','repo-tab-worksets'\)/);
assert.doesNotMatch(workflow, /workflowButton\('Worksets'[^;]*;button\.classList\.add\('repo-tab-add'\)/);
console.log('PASS: diff line numbers and hidden headers, fetch freshness, tab sync, status bar hints, worksets slot');

// ---- Audit fixes ------------------------------------------------------------
// No machine-specific export path in shipped copy; the server writes to <GitDeck>\exports.
assert.doesNotMatch(app, /my-git-tools/);
assert.match(app, /exports folder next to Git Deck/);
// Add-on scripts wrap render functions after app.js; a cached first paint must be redone once they load.
assert.match(app, /document\.addEventListener\('DOMContentLoaded',\(\)=>\{if\(state\.workspace\)paintWorkspace\(state\.workspace\);\}\);/);
// Diff A-/A+ must win over the shared UI text size rule.
const workspaceCss = fs.readFileSync(path.join(root, 'web/workspace.css'), 'utf8');
assert.match(workspaceCss, /body :not\(:where\([^)]*\.diff-viewer-body, \.diff-viewer-body \*\)\)/);
assert.match(workspaceCss, /\.improved-diff \.diff-viewer-body\{[^}]*font:var\(--diff-font-size/);
// Clean layout only restructures in Clean mode and re-renders on look changes.
const cleanLayout = fs.readFileSync(path.join(root, 'web/clean-layout.js'), 'utf8');
assert.match(cleanLayout, /if\(isClean\(\)\)\{try\{groupViewOptions\(content\);moveShortcutHint\(content\);\}/);
assert.match(cleanLayout, /addEventListener\('gitdeck:appearance',\(\)=>\{if\(state\.workspace\)renderWorkspace\(\);\}\)/);
assert.doesNotMatch(cleanLayout, /requestAnimationFrame\(/, 'rAF pauses while the window is hidden');
console.log('PASS: audit fixes (export path, add-on repaint, diff font size) and clean layout guards');
