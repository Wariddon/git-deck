const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');

// Background fetch is on by default (every 10 minutes, once), keeps an explicit choice, and
// announces new incoming commits for the open repository with a Pull button.
function setup({ storage = {}, minutes = 0, behindAfter = 0 } = {}) {
  const store = new Map(Object.entries(storage));
  const appended = [];
  const node = (tag, cls, text) => ({ tag, className: cls, textContent: text || '', children: [], id: '', append(...c) { this.children.push(...c); }, setAttribute() {}, remove() {} });
  const repo = { path: 'C:/r', name: 'r', behind: 0 };
  const context = {
    t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)),
    el: node,
    state: { meta: { autoFetchMinutes: minutes }, repos: [repo], workspaceRepo: repo, workspace: { sync: { upstream: 'origin/main' } }, busy: false },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) },
    saveMeta: () => {}, scheduled: 0, scheduleAutoFetch() { context.scheduled++; },
    runSmartFetch: async () => { repo.behind = behindAfter; return { message: 'ok' }; },
    loadWorkspace: async () => {},
    setTimeout: () => 0,
    document: { getElementById: () => null, querySelector: () => null, body: { append: (n) => appended.push(n) } },
  };
  context.window = context;
  vm.runInNewContext(web('auto-fetch.js'), context);
  return { context, store, appended };
}

(async () => {
  const fresh = setup();
  assert.equal(fresh.context.state.meta.autoFetchMinutes, 10, 'On by default, every 10 minutes');
  assert.equal(fresh.context.scheduled, 1);
  const chosen = setup({ storage: { 'gitdeck.autoFetchDefault': '1' } });
  assert.equal(chosen.context.state.meta.autoFetchMinutes, 0, 'An explicit Off is kept');

  const incoming = setup({ behindAfter: 2 });
  await incoming.context.runSmartFetch(false);
  const card = incoming.appended[0].children.find((c) => c.className === 'action-feedback feedback-success incoming-feedback');
  assert.ok(card, 'New commits produce a card');
  assert.equal(card.children[0].textContent, '2 new commit(s) on origin/main');
  const quiet = setup({ behindAfter: 0 });
  await quiet.context.runSmartFetch(false);
  assert.equal(quiet.appended.length, 0, 'Nothing new, no card');
  assert.ok(web('index.html').includes('/auto-fetch.js'));
  console.log('PASS: background fetch on by default, new commits announced with Pull');
})().catch((error) => { console.error(error); process.exit(1); });
