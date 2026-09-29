const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const web = (name) => fs.readFileSync(path.join(root, 'web', name), 'utf8');

function load(language) {
  const storage = new Map(language ? [['gitdeck.language', language]] : []);
  const pickers = [], reloads = [];
  const node = () => ({ children: [], dataset: {}, attributes: {}, append(...items) { this.children.push(...items); }, setAttribute(k, v) { this.attributes[k] = v; }, addEventListener(type, fn) { this['on' + type] = fn; }, querySelector() { return null; } });
  const context = {
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    location: { reload: () => reloads.push(1) },
    document: { readyState: 'complete', documentElement: {}, createElement: node, querySelectorAll: () => pickers },
  };
  context.window = context;
  pickers.push(node());
  vm.runInNewContext(web('i18n.js') + '\n' + web('i18n-th.js'), context);
  return { context, pickers, storage, reloads };
}

// Every t('…') key used in web/*.js has a Thai entry, and the dictionary has no stale keys.
const dictionary = load("th").context.GitDeckI18n.entries('th');
const used = new Set();
const literal = String.raw`'((?:[^'\\]|\\.)*)'`;
const call = new RegExp(String.raw`\bt\(\s*(?:[^()']*\?\s*)?` + literal + String.raw`(?:\s*:\s*` + literal + ')?', 'g');
for (const name of fs.readdirSync(path.join(root, 'web')).filter((f) => f.endsWith('.js') && !f.startsWith('i18n'))) {
  for (const match of web(name).matchAll(call)) for (const key of [match[1], match[2]]) if (key !== undefined) used.add(JSON.parse(`"${key.replace(/\\'/g, "'").replace(/"/g, '\\"')}"`));
}
used.add('Language');
const missing = [...used].filter((key) => !Object.prototype.hasOwnProperty.call(dictionary, key));
const stale = Object.keys(dictionary).filter((key) => !used.has(key));
if (process.argv.includes('--list-missing')) { console.log(JSON.stringify(missing, null, 2)); process.exit(0); }
// Fallback, interpolation and Thai lookup.
let { context, pickers, storage, reloads } = load();
assert.equal(context.t('Clear'), 'Clear');
assert.equal(context.t('Stage {count} lines', { count: 3 }), 'Stage 3 lines');
assert.equal(context.t('Keep {missing}', {}), 'Keep {missing}');
assert.equal(context.document.documentElement.lang, 'en');
({ context, pickers, storage, reloads } = load('th'));
assert.equal(context.document.documentElement.lang, 'th');
assert.equal(context.t('Stage {count} lines', { count: 3 }), 'Stage 3 บรรทัด');
assert.equal(context.t('Text that is not translated'), 'Text that is not translated');
assert.equal(load('xx').context.GitDeckI18n.language, 'en', 'Unknown language falls back to English');

// Language picker is added to theme menus and switching reloads once.
const picker = pickers[0].children.find((child) => child.className === 'language-choice');
assert(picker, 'Theme menu gets a language picker');
const buttons = picker.children.filter((child) => child.dataset.languageChoice);
assert.deepEqual(buttons.map((b) => b.dataset.languageChoice), ['en', 'th']);
assert.equal(buttons[1].attributes['aria-pressed'], 'true');
buttons[1].onclick(); assert.equal(reloads.length, 0, 'Choosing the current language is a no-op');
buttons[0].onclick(); assert.equal(storage.get('gitdeck.language'), 'en'); assert.equal(reloads.length, 1);

assert.deepEqual(missing, [], 'Thai translations missing');
assert.deepEqual(stale, [], 'Thai dictionary has keys no code uses');
for (const [key, value] of Object.entries(dictionary)) {
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  assert.equal(placeholders(value), placeholders(key), `Placeholders differ for "${key}"`);
}
assert(used.size >= 60, `Expected the migrated modules to use t(); found ${used.size} keys`);
console.log(`PASS: i18n fallback, interpolation, picker, ${used.size} keys translated to Thai with matching placeholders`);
