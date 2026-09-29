const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../web/ai-features.js'), 'utf8');

// Minimal globals: no views are rendered, so only the palette/consent paths run.
function setup(status, replies = {}) {
  const posts = [], feedback = [], confirms = [], ran = [];
  const search = { value: '' };
  const context = {
    t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => k in vars ? String(vars[k]) : m),
    state: { workspaceRepo: { name: 'demo', path: 'C:/demo' } },
    document: { getElementById: (id) => id === 'command-search' ? search : null, querySelector: () => null, querySelectorAll: () => [] },
    api: async (url, options) => {
      if (url.startsWith('/api/ai/status')) return { ai: status };
      const body = JSON.parse(options.body); posts.push(body); return replies[body.action];
    },
    runWorkspaceAction: async () => ({}),
    showActionFeedback: (message, options) => feedback.push([message, options]),
    confirm: (text) => { confirms.push(text); return true; },
    commandPaletteEntries: () => [
      { label: 'Fetch', group: 'Sync', run: () => ran.push('fetch') },
      { label: 'Create branch', group: 'Branches', run: () => ran.push('branch') },
    ],
    setTimeout,
  };
  vm.runInNewContext(source, context);
  return { context, posts, feedback, confirms, ran, search };
}

(async () => {
  // Short palette terms add nothing; longer ones add one "Ask AI" entry at the end.
  let s = setup({ ready: true, provider: 'anthropic', model: 'claude-opus-5-5' }, { 'ai-command': { commandId: '1', explanation: 'Makes a branch' } });
  s.search.value = 'abc';
  assert.equal(s.context.commandPaletteEntries().length, 2);
  s.search.value = 'make a new branch';
  const entries = s.context.commandPaletteEntries();
  assert.equal(entries.length, 3);
  assert.match(entries[2].label, /Ask AI: "make a new branch"/);

  // Asking sends only ids and labels, asks consent once, and opens the command only after confirm.
  await entries[2].run();
  assert.equal(s.posts.length, 1);
  assert.equal(s.posts[0].action, 'ai-command');
  assert.equal(s.posts[0].path, 'C:/demo');
  assert.deepEqual(JSON.parse(JSON.stringify(s.posts[0].commands)), [{ id: '0', label: 'Fetch (Sync)' }, { id: '1', label: 'Create branch (Branches)' }]);
  assert.match(s.confirms[0], /Send your request[\s\S]*Anthropic \(claude-opus-5-5\)[\s\S]*checks for secrets/);
  assert.match(s.confirms[1], /AI suggests: Create branch/);
  assert.deepEqual([...s.ran], ['branch']);
  await s.context.commandPaletteEntries()[2].run();
  assert.equal(s.confirms.filter(text => text.startsWith('Send')).length, 1, 'consent is asked once per repository and provider');

  // Unknown command id: nothing runs, the explanation is shown instead.
  s = setup({ ready: true, provider: 'anthropic', model: 'm' }, { 'ai-command': { commandId: '', explanation: 'Nothing fits.' } });
  s.search.value = 'rewrite history please';
  await s.context.commandPaletteEntries()[2].run();
  assert.equal(s.ran.length, 0);
  assert.equal(s.feedback.at(-1)[0], 'Nothing fits.');

  // AI not ready (policy off / no key): show the hint and never post an action.
  s = setup({ ready: false, hint: 'AI is off for this repository.' });
  s.search.value = 'push my work';
  await s.context.commandPaletteEntries()[2].run();
  assert.equal(s.posts.length, 0);
  assert.equal(s.confirms.length, 0);
  assert.equal(s.feedback.at(-1)[0], 'AI is off for this repository.');
  assert.equal(s.feedback.at(-1)[1].error, true);

  // Declining consent sends nothing.
  s = setup({ ready: true, provider: 'ollama', model: 'llama3' });
  s.context.confirm = () => false;
  s.search.value = 'show stashes';
  await s.context.commandPaletteEntries()[2].run();
  assert.equal(s.posts.length, 0);

  // Static guards: repository-changing steps go through runWorkspaceAction with a confirmation.
  assert.match(source, /runWorkspaceAction\('keep-staged-hunks',\{hunks:group\.hunks,fingerprint:plan\.fingerprint\},t\(/);
  assert.match(source, /runWorkspaceAction\('branch-create-at',[^;]*t\('Create branch \{branch\} at \{hash\}/);
  assert.doesNotMatch(source, /innerHTML/);
  const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
  assert.match(html, /<script src="\/ai-features\.js" defer><\/script>/);
  console.log('PASS: AI palette entry, consent once, not-ready hint, declined consent, guarded repository changes');
})().catch((error) => { console.error(error); process.exit(1); });
