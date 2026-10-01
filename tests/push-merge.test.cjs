const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');

// Push rejected because the remote moved on: offer "Merge and push" instead of a dead end (like Sourcetree).
function setup({ pushFails = 1, pullResult = { message: 'ok', conflicts: [] }, operation = null } = {}) {
  const calls = [];
  const dialogs = [];
  let pushes = 0;
  const context = {
    t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)),
    el: (tag, cls, text) => ({ tag, cls, textContent: text || '', focus() {} }),
    state: { busy: false, meta: { pullStrategy: 'ff-only' }, workspaceRepo: { path: 'C:/r', name: 'r' }, workspace: { branch: 'main', sync: { upstream: 'origin/main' }, operation: null } },
    selectWorkspaceTab: (tab) => calls.push(['tab', tab]),
    showActionFeedback: (text) => calls.push(['feedback', text]),
    hidePushDialog: () => calls.push(['hidePush']),
    loadWorkspace: async () => { context.state.workspace.operation = operation; },
    releaseDialog: () => {
      const listeners = {};
      const close = { textContent: 'Close' };
      const ui = {
        dialog: { classList: { add() {} }, close: () => listeners.close?.(), addEventListener: (name, fn) => { listeners[name] = fn; } },
        body: { append() {} },
        actions: { buttons: [close], querySelector: () => close, append(button) { this.buttons.push(button); } },
      };
      dialogs.push(ui);
      return ui;
    },
    runWorkspaceAction: async (action, payload, confirmation, options = {}) => {
      calls.push([action, payload]);
      if (action.startsWith('push')) {
        if (pushes++ < pushFails) { options.onError?.(new Error(' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs')); return null; }
        return { message: 'pushed' };
      }
      if (action.startsWith('pull')) {
        if (!pullResult) { options.onError?.(new Error('Pull paused for conflicts.')); return null; }
        return pullResult;
      }
      return {};
    },
  };
  context.window = context;
  vm.runInNewContext(web('push-merge.js'), context);
  return { context, calls, dialogs };
}

(async () => {
  // Detection helpers.
  const { context } = setup();
  const pm = context.GitDeckPushMerge;
  assert.ok(pm.behindRejection('! [rejected] main -> main (non-fast-forward)'));
  assert.ok(pm.behindRejection('Updates were rejected because the remote contains work that you do not have locally'));
  assert.ok(!pm.behindRejection('Authentication failed'));
  assert.deepEqual([...pm.rejectedBranches(' ! [rejected] main -> main (fetch first)\n ! [rejected] dev -> dev (fetch first)')], ['main', 'dev']);
  assert.equal(pm.pullSource('push', {}, '! [rejected] other -> other (fetch first)'), null, 'Merging the current branch cannot fix another branch');
  assert.equal(pm.pullSource('push', {}, '').action, 'pull');
  const selection = pm.pullSource('push-selection', { remote: 'upstream', branches: [{ local: 'main', remote: 'release' }] }, '');
  assert.equal(selection.action, 'pull-ref');
  assert.equal(selection.payload.remote, 'upstream');
  assert.equal(selection.payload.branch, 'release');

  // Rejected push -> dialog -> merge (never ff-only, which cannot merge diverged history) -> push again.
  {
    const { context, calls, dialogs } = setup();
    let reported = null;
    assert.equal(await context.runWorkspaceAction('push', {}, '', { onError: (e) => { reported = e; } }), null);
    assert.equal(dialogs.length, 1, 'The merge offer opens');
    assert.equal(reported, null, 'The raw error card waits for the user');
    const go = dialogs[0].actions.buttons.find((b) => b.cls === 'primary');
    assert.equal(go.textContent, 'Merge and push');
    go.onclick();
    await new Promise((r) => setTimeout(r, 0));
    const names = calls.map((c) => c[0]);
    assert.deepEqual(names, ['push', 'hidePush', 'pull', 'push']);
    assert.equal(calls[2][1].strategy, 'merge');
    assert.equal(calls[2][1].autostash, true);
  }

  // Cancel shows the original error.
  {
    const { context, dialogs } = setup();
    let reported = null;
    await context.runWorkspaceAction('push', {}, '', { onError: (e) => { reported = e; } });
    dialogs[0].dialog.close();
    assert.match(reported.message, /rejected/);
  }

  // Merge conflicts: open the Conflicts page, do not push.
  {
    const { context, calls, dialogs } = setup({ pullResult: null, operation: { active: true, type: 'merge' } });
    await context.runWorkspaceAction('push', {}, '');
    dialogs[0].actions.buttons.find((b) => b.cls === 'primary').onclick();
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(calls.some((c) => c[0] === 'tab' && c[1] === 'conflicts'), 'Conflicts page opens');
    assert.equal(calls.filter((c) => c[0] === 'push').length, 1, 'No second push while conflicted');
  }

  // A second rejection after merging does not loop.
  {
    const { context, dialogs } = setup({ pushFails: 2 });
    await context.runWorkspaceAction('push', {}, '');
    dialogs[0].actions.buttons.find((b) => b.cls === 'primary').onclick();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(dialogs.length, 1);
  }

  // Force with lease and other actions pass straight through.
  {
    const { context, dialogs } = setup();
    await context.runWorkspaceAction('push-selection', { forceWithLease: true, branches: [] }, '');
    assert.equal(dialogs.length, 0);
  }

  const html = web('index.html');
  assert.ok(html.indexOf('/push-merge.js') > 0 && html.indexOf('/push-merge.js') < html.indexOf('/file-actions.js'), 'Loads before file-actions.js so push-after-commit gets the offer too');
  console.log('PASS: push rejected -> merge and push');
})().catch((error) => { console.error(error); process.exit(1); });
