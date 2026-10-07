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


// ---- Appearance: text size and look -----------------------------------------
function loadAppearance(saved = {}) {
  const storage = new Map(Object.entries(saved));
  const style = new Map();
  const classes = new Set();
  const menus = [];
  const node = () => ({ children: [], dataset: {}, attrs: {}, append(...xs) { this.children.push(...xs); }, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, addEventListener(type, fn) { this['on' + type] = fn; }, querySelector: () => null });
  const buttons = [];
  const events = [];
  const context = {
    t: format,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
    document: {
      readyState: 'complete',
      dispatchEvent: (event) => events.push(event.type + ':' + event.detail.look + ':' + event.detail.size),
      documentElement: { style: { setProperty: (k, v) => style.set(k, v), removeProperty: (k) => style.delete(k) }, classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) } },
      createElement: () => { const n = node(); buttons.push(n); return n; },
      querySelectorAll: (selector) => selector === '.theme-menu' ? menus : buttons.filter((b) => b.dataset.textSize || b.dataset.look),
    },
  };
  context.window = context;
  menus.push(node());
  vm.runInNewContext(web('appearance.js'), context);
  const [lookGroup, sizeGroup] = menus[0].children;
  return { context, storage, style, classes, lookGroup, sizeGroup, events };
}
let ap = loadAppearance();
assert.equal(ap.context.GitDeckAppearance.size, 13);
assert.equal(ap.style.get('--ui-text-size'), '13px');
assert.equal(ap.classes.has('ui-modern'), true, 'Modern is the default look');
assert.equal(ap.classes.has('ui-clean'), true, 'Modern builds on the Clean layout');
const sizeButtons = ap.sizeGroup.children.filter((c) => c.dataset.textSize);
assert.deepEqual(sizeButtons.map((b) => b.dataset.textSize), ['11', '12', '13', '14', '16']);
assert.equal(sizeButtons[2].attrs['aria-pressed'], 'true');
sizeButtons[0].onclick();
assert.equal(ap.style.get('--ui-text-size'), '11px'); assert.equal(ap.storage.get('gitdeck.textSize'), '11');
assert.equal(sizeButtons[0].attrs['aria-pressed'], 'true'); assert.equal(sizeButtons[2].attrs['aria-pressed'], 'false');
sizeButtons[2].onclick();
assert.equal(ap.storage.has('gitdeck.textSize'), false, 'Back to default clears the preference');
const lookButtons = ap.lookGroup.children.filter((c) => c.dataset.look);
assert.deepEqual(lookButtons.map((b) => b.dataset.look), ['modern', 'classic']);
lookButtons[1].onclick();
assert.equal(ap.classes.has('ui-clean'), false); assert.equal(ap.classes.has('ui-modern'), false); assert.equal(ap.storage.get('gitdeck.look'), 'classic');
assert.equal(lookButtons[1].attrs['aria-pressed'], 'true');
lookButtons[0].onclick();
assert.equal(ap.classes.has('ui-modern'), true); assert.equal(ap.storage.has('gitdeck.look'), false);
assert.deepEqual([...ap.events], ['gitdeck:appearance:modern:11', 'gitdeck:appearance:modern:13', 'gitdeck:appearance:classic:13', 'gitdeck:appearance:modern:13'], 'Every change is announced so views can re-render');
assert.equal(loadAppearance({ 'gitdeck.look': 'clean' }).classes.has('ui-modern'), true, 'A saved Clean look from older builds opens as Modern');
assert.equal(loadAppearance({ 'gitdeck.textSize': '14' }).style.get('--ui-text-size'), '14px', 'Saved size applies before first paint');
assert.equal(loadAppearance({ 'gitdeck.textSize': '8' }).context.GitDeckAppearance.size, 13, 'Old 8px preference falls back to the default');
assert.equal(loadAppearance({ 'gitdeck.look': 'classic' }).classes.has('ui-clean'), false, 'Saved Classic look applies before first paint');
assert(html.indexOf('/appearance.js') < html.indexOf('id="startup-controller"'), 'Applied before the splash and workspace render');
const links = [...html.matchAll(/rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
assert.deepEqual(links.slice(-5), ['/clean.css', '/modern.css', '/motion.css', '/polish.css', '/catalog.css'], 'Modern, motion and polish keep their ordering; the scoped catalog layout loads last');
for (const [file, scope] of [['clean.css', 'html.ui-clean'], ['modern.css', 'html.ui-modern']]) {
  const css = web(file).replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '')
    .replace(/@media[^{]*\{/g, '');
  for (const rule of css.split('}').map((r) => r.trim()).filter(Boolean)) {
    // Split the selector list on top-level commas only (:is(a, b) stays whole).
    const selectors = [];let depth = 0, current = '';
    for (const char of rule.slice(0, rule.indexOf('{'))) {
      if (char === ',' && !depth) { selectors.push(current.trim()); current = ''; continue; }
      depth += char === '(' ? 1 : char === ')' ? -1 : 0; current += char;
    }
    selectors.push(current.trim());
    for (const selector of selectors) assert(selector.startsWith(scope), `${file} selector not scoped to ${scope}: ${selector}`);
  }
}
console.log('PASS: overview next steps and actions, appearance text size 11-16 (13 default) and Modern/Classic look');
