const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const web = (name) => fs.readFileSync(path.join(__dirname, '../web', name), 'utf8');
const format = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => k in vars ? String(vars[k]) : m);

// ---- Overview next steps ----------------------------------------------------
const calls = [];
const overview = {
  t: format, state: { meta: { pullStrategy: 'rebase' } },
  selectWorkspaceTab: (tab) => calls.push(['tab', tab]),
  runWorkspaceAction: (...args) => calls.push(['run', ...args]),
  syncConfirmation: (action) => `confirm ${action}`,
  showPushDialog: () => calls.push(['push-dialog']),
  el: (tag, cls = '', text = '') => ({ tag, className: cls, text, children: [], dataset: {}, attrs: {}, append(...xs) { this.children.push(...xs); }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(type, fn) { this['on' + type] = fn; } }),
};
vm.runInNewContext(web('overview-panel.js'), overview);
const steps = (data) => [...overview.overviewSteps(data)].map((s) => `${s.id}:${s.label}`);

assert.deepEqual(steps({ branch: 'main', sync: { upstream: 'origin/main' }, remotes: [{ name: 'origin' }] }), ['clean:All clear']);
assert.deepEqual(steps({
  branch: 'feature/x', remotes: [{ name: 'origin' }], sync: {},
  files: [{ path: 'a', staged: true }, { path: 'a', staged: false }, { path: 'b' }],
  stashes: [{ ref: 'stash@{0}', message: 'wip' }, { ref: 'stash@{1}' }],
}), ['changes:Commit 1 staged file', 'publish:Publish this branch', 'stashes:2 stashes saved']);
assert.deepEqual(steps({ branch: 'main', remotes: [{ name: 'origin' }], sync: { upstream: 'origin/main', behind: 3, ahead: 1 }, files: [{ path: 'x' }, { path: 'y' }] }),
  ['changes:Review 2 changed files', 'pull:Pull 3 commits', 'push:Push 1 commit']);
assert.deepEqual(steps({ branch: 'main', sync: { upstream: 'origin/main' }, operation: { active: true, type: 'merge', conflicts: ['a', 'b'] } }).slice(0, 1), ['conflicts:Resolve 2 conflicts']);
assert.deepEqual(steps({ branch: 'main', sync: { upstream: 'origin/main' }, operation: { active: true, type: 'rebase', conflicts: [] } }), ['finish:Finish the rebase']);
assert.deepEqual(steps({ branch: '', sync: {}, remotes: [{ name: 'origin' }] }), ['clean:All clear'], 'Detached HEAD is never offered Publish');
assert.deepEqual(steps({ branch: 'main', sync: {}, remotes: [] }), ['clean:All clear'], 'No remote, nothing to publish');

// Rendered steps are buttons that open the view or start the action they name.
const box = overview.renderOverviewSteps({ branch: 'main', remotes: [{ name: 'origin' }], sync: { upstream: 'origin/main', behind: 2 }, files: [{ path: 'a' }], stashes: [{ ref: 'stash@{0}' }] });
const buttons = box.children.filter((c) => c.tag === 'button');
assert.deepEqual(buttons.map((b) => b.dataset.step), ['changes', 'pull', 'stashes']);
buttons.forEach((b) => b.onclick());
assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['tab', 'changes'], ['run', 'pull', { strategy: 'rebase' }, 'confirm pull'], ['tab', 'stashes']]);
const clean = overview.renderOverviewSteps({ branch: 'main', sync: { upstream: 'origin/main' } });
assert.equal(clean.children.at(-1).tag, 'div', '"All clear" is not a fake button');
const html = web('index.html');
assert(html.indexOf('/overview-panel.js') < html.indexOf('src="/app.js"'), 'Loaded before app.js so the first render includes the steps');
assert.match(web('app.js'), /if\(typeof renderOverviewSteps==='function'\)filters\.after\(renderOverviewSteps\(data\)\)/);

// ---- Text size --------------------------------------------------------------
function loadTextSize(saved) {
  const storage = new Map(saved ? [['gitdeck.textSize', saved]] : []);
  const style = new Map();
  const menus = [];
  const node = () => ({ children: [], dataset: {}, attrs: {}, append(...xs) { this.children.push(...xs); }, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, addEventListener(type, fn) { this['on' + type] = fn; }, querySelector: () => null });
  const buttons = [];
  const context = {
    t: format,
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
    document: {
      readyState: 'complete',
      documentElement: { style: { setProperty: (k, v) => style.set(k, v), removeProperty: (k) => style.delete(k) } },
      createElement: () => { const n = node(); buttons.push(n); return n; },
      querySelectorAll: (selector) => selector === '.theme-menu' ? menus : buttons.filter((b) => b.dataset.textSize),
    },
  };
  context.window = context;
  menus.push(node());
  vm.runInNewContext(web('text-size.js'), context);
  return { context, storage, style, menus };
}
let ts = loadTextSize();
assert.equal(ts.context.GitDeckTextSize.size, 11);
assert.equal(ts.style.has('--ui-text-size'), false, 'Default keeps the stylesheet value');
const picker = ts.menus[0].children[0];
const sizeButtons = picker.children.filter((c) => c.dataset.textSize);
assert.deepEqual(sizeButtons.map((b) => b.dataset.textSize), ['11', '12', '13', '14']);
sizeButtons[2].onclick();
assert.equal(ts.style.get('--ui-text-size'), '13px'); assert.equal(ts.storage.get('gitdeck.textSize'), '13');
assert.equal(sizeButtons[2].attrs['aria-pressed'], 'true'); assert.equal(sizeButtons[0].attrs['aria-pressed'], 'false');
sizeButtons[0].onclick();
assert.equal(ts.style.has('--ui-text-size'), false); assert.equal(ts.storage.has('gitdeck.textSize'), false, 'Back to default clears the preference');
assert.equal(loadTextSize('14').style.get('--ui-text-size'), '14px', 'Saved size applies before first paint');
assert.equal(loadTextSize('40').context.GitDeckTextSize.size, 11, 'Unknown sizes fall back to the default');
assert(html.indexOf('/text-size.js') < html.indexOf('id="startup-controller"'), 'Applied before the splash and workspace render');
console.log('PASS: overview next steps and actions, text size picker, persistence and defaults');
