const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
// vm objects come from another realm; compare structure, not prototypes.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
const source = fs.readFileSync(path.join(__dirname, '../web/pull-assist.js'), 'utf8');

function setup(preview, result) {
  const calls = [], feedback = [], tabs = [];
  const context = {
    URLSearchParams, t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => k in vars ? String(vars[k]) : m), state: { busy: false, workspaceRepo: { name: 'demo', path: 'C:/demo' } },
    api: async (url) => { calls.push(['api', url]); if (preview instanceof Error) throw preview; return { pull: preview }; },
    runWorkspaceAction: async (action, payload, confirmation) => { calls.push(['run', action, payload, confirmation]); return result; },
    gitCommandPreview: (action, payload) => action === 'pull-ref' ? `git pull --rebase "${payload.remote}" "${payload.branch}"` : 'git pull --ff-only',
    showActionFeedback: (message, options) => feedback.push([message, options]),
    setOutput: () => {}, selectWorkspaceTab: (tab) => tabs.push(tab),
  };
  vm.runInNewContext(source, context);
  return { context, calls, feedback, tabs };
}

(async () => {
  const { context } = setup(null, null);
  const note = context.pullAutostashNote;
  same(note({ dirty: [] }), { text: '', blocked: false });
  assert.equal(note(null).text, '');
  assert.match(note({ dirty: ['a'], overlap: [], knownTarget: true }).text, /stash them, pull, then restore them[\s\S]*None of your changed files/);
  assert.match(note({ dirty: ['a'], overlap: [], knownTarget: false }).text, /unknown until you Fetch/);
  const many = note({ dirty: Array(12).fill('x'), overlap: Array.from({ length: 12 }, (_, i) => `f${i}`), knownTarget: true }).text;
  assert.match(many, /may conflict[\s\S]*• f0[\s\S]*• f9\n…and 2 more/);
  assert.equal(note({ dirty: ['n.txt'], blockingUntracked: ['n.txt'] }).blocked, true);

  // Clean tree: payload unchanged, no autostash.
  let t = setup({ dirty: [], knownTarget: true }, { message: 'ok', conflicts: [] });
  await t.context.runWorkspaceAction('pull', { strategy: 'ff-only' }, 'Pull 1 commit?');
  same(t.calls[1], ['run', 'pull', { strategy: 'ff-only' }, 'Pull 1 commit?']);

  // Dirty tree: autostash on, confirmation explains overlap, command preview shows the flag.
  t = setup({ dirty: ['a.txt'], overlap: ['a.txt'], knownTarget: true }, { message: 'ok', conflicts: [] });
  await t.context.runWorkspaceAction('pull-ref', { remote: 'origin', branch: 'dev' }, 'Pull origin/dev?');
  assert.match(t.calls[0][1], /pull-preview\?path=C%3A%2Fdemo&remote=origin&branch=dev/);
  assert.equal(t.calls[1][2].autostash, true);
  assert.match(t.calls[1][3], /^Pull origin\/dev\?\n\nYou have 1 uncommitted[\s\S]*• a\.txt/);
  assert.equal(t.context.gitCommandPreview('pull-ref', { remote: 'origin', branch: 'dev', autostash: true }), 'git pull --rebase --autostash "origin" "dev"');
  assert.equal(t.context.gitCommandPreview('pull', {}), 'git pull --ff-only');
  same(t.tabs, []);

  // Untracked collision: blocked before any Git call.
  t = setup({ dirty: ['n.txt'], blockingUntracked: ['n.txt'] }, null);
  assert.equal(await t.context.runWorkspaceAction('pull', {}, 'Pull?'), null);
  assert.equal(t.calls.filter((c) => c[0] === 'run').length, 0);
  assert.match(t.feedback[0][0], /overwrite 1 untracked/);

  // Restore conflicts: File Status opens and an attention card stays.
  t = setup({ dirty: ['a.txt'], overlap: ['a.txt'], knownTarget: true }, { message: 'conflicted', conflicts: ['a.txt'] });
  await t.context.runWorkspaceAction('pull', {}, 'Pull?');
  same(t.tabs, ['changes']);
  assert.equal(t.feedback[0][1].error, true);
  assert.match(t.feedback[0][1].context, /1 conflict\(s\) · stash kept/);

  // Preview failure falls back to the server check; explicit autostash:false skips the preview.
  t = setup(new Error('offline'), { message: 'ok' });
  await t.context.runWorkspaceAction('pull', { strategy: 'merge' }, 'Pull?');
  same(t.calls.at(-1), ['run', 'pull', { strategy: 'merge' }, 'Pull?']);
  t = setup({ dirty: ['a'] }, { message: 'ok' });
  await t.context.runWorkspaceAction('pull', { autostash: false }, 'Pull?');
  assert.equal(t.calls[0][0], 'run');
  await t.context.runWorkspaceAction('fetch', {}, '');
  assert.equal(t.calls.filter((c) => c[0] === 'api').length, 0);
  console.log('PASS: autostash note, preview wiring, command flag, untracked block, conflict follow-up, fallbacks');
})().catch((error) => { console.error(error); process.exit(1); });
