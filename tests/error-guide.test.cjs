const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const web = (file) => fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');

// Every failed action gets a plain explanation and a next step (not only conflicts).
const context = {
  t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)),
  state: { workspace: { operation: { active: true } }, workspaceRepo: { path: 'C:\\r' } },
  showActionFeedback: () => {},
  runWorkspaceAction: async () => ({}),
};
context.window = context;
vm.runInNewContext(web('error-guide.js'), context);
const { guideFor, guides, fallback } = context.GitDeckErrorGuide;
const id = (message) => guideFor(message)?.id || 'unknown';

// Real Git messages -> guide.
const cases = [
  ["fatal: Unable to create 'C:/r/.git/index.lock': File exists.\nAnother git process seems to be running in this repository", 'lock'],
  ["fatal: detected dubious ownership in repository at 'D:/r'", 'dubious'],
  ['Author identity unknown\n*** Please tell me who you are.', 'identity'],
  ['fatal: You have not concluded your merge (MERGE_HEAD exists).', 'unfinished'],
  ['CONFLICT (content): Merge conflict in app.txt\nAutomatic merge failed; fix conflicts and then commit the result.', 'conflicts'],
  ['Pull paused for conflicts. Resolve them in Safety Center.', 'conflicts'],
  ['error: The following untracked working tree files would be overwritten by merge:\n\tnotes.md', 'untracked'],
  ['error: Your local changes to the following files would be overwritten by checkout:\n\tapp.txt\nPlease commit your changes or stash them before you switch branches.', 'local-changes'],
  ['Commit or stash changes before pulling, or allow Git Deck to stash and restore them.', 'local-changes'],
  ['fatal: Not possible to fast-forward, aborting.', 'diverged'],
  ['hint: You have divergent branches and need to specify how to reconcile them.', 'diverged'],
  [' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs', 'push-behind'],
  ['remote: error: GH006: Protected branch update failed for refs/heads/main.', 'protected'],
  ["error: unable to unlink old 'app.txt': Permission denied", 'file-busy'],
  ["remote: HTTP Basic: Access denied\nfatal: Authentication failed for 'https://gitlab.com/a/b.git/'", 'auth'],
  ['git@github.com: Permission denied (publickey).', 'auth'],
  ['remote: Repository not found.', 'not-found'],
  ["fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com", 'network'],
  ['remote: error: File big.zip is 120 MB; this exceeds GitHub\'s file size limit of 100.00 MB', 'too-large'],
  ['fatal: The current branch feature/x has no upstream branch.', 'no-upstream'],
  ["fatal: couldn't find remote ref feature/gone", 'missing-ref'],
  ['nothing to commit, working tree clean', 'nothing'],
  ['There are no changes to stash.', 'nothing'],
  ["fatal: a branch named 'feature/x' already exists", 'exists'],
  ["error: The branch 'old' is not fully merged.", 'not-merged'],
  ['fatal: You are not currently on a branch.', 'detached'],
  ['error: unable to create file src/very/long/path.txt: Filename too long', 'long-path'],
  ['fatal: cannot create directory: Filename too long', 'long-path'],
  ['fatal: refusing to merge unrelated histories', 'unrelated'],
  ["fatal: your current branch 'main' does not have any commits yet", 'empty-repo'],
  ["error: pathspec 'gone.txt' did not match any file(s) known to git", 'missing-path'],
  ['Something odd happened', 'unknown'],
];
for (const [message, expected] of cases) assert.equal(id(message), expected, message);

// Every guide explains, says what to do, and offers at least one button that leads somewhere.
const ctx = { message: '', last: { action: 'pull', payload: {} } };
for (const guide of [...guides, fallback]) {
  assert.ok(guide.title() && guide.next(), guide.id);
  const actions = guide.actions(ctx).filter(Boolean);
  assert.ok(guide.id === 'unrelated' || actions.length, `${guide.id} offers a next step`);
  for (const action of actions) assert.ok(action.label && typeof action.run === 'function', guide.id);
}

const html = web('index.html');
assert.ok(html.indexOf('/error-guide.js') > html.indexOf('/ai-features.js'), 'Wraps the card after the AI Explain button is added');
console.log(`PASS: error guide covers ${guides.length} kinds of Git errors plus a fallback`);

// Git Deck's own messages map too.
for (const [message, expected] of [
  ['Pull would overwrite 1 untracked file(s) with incoming files. Move, rename or commit them first:', 'untracked'],
  ['app.txt has uncommitted changes. Commit, stash or discard them first so nothing is lost.', 'local-changes'],
  ['Finish or abort the merge, rebase or cherry-pick in progress before switching.', 'unfinished'],
  ['Merge needs attention. Resolve conflicts in Safety Center, then Continue or Abort.', 'conflicts'],
  ['No staged changes. Review and stage files before committing.', 'nothing'],
  ['Remote branch was not found. Fetch first.', 'missing-ref'],
  ['Cannot push from detached HEAD.', 'detached'],
]) assert.equal(id(message), expected, message);

// The card names the files involved.
const files = (message) => [...context.GitDeckErrorGuide.affectedFiles(message)];
assert.deepEqual(files('CONFLICT (content): Merge conflict in app.txt\nCONFLICT (content): Merge conflict in src/a.js\nAutomatic merge failed'), ['app.txt', 'src/a.js']);
assert.deepEqual(files('error: Your local changes to the following files would be overwritten by checkout:\n\tapp.txt\n\tsrc/b.js\nPlease commit'), ['app.txt', 'src/b.js']);
assert.deepEqual(files('Pull would overwrite 1 untracked file(s) with incoming files. Move, rename or commit them first:\n• notes.md'), ['notes.md']);
assert.deepEqual(files("error: unable to unlink old 'app.txt': Permission denied"), ['app.txt']);
assert.deepEqual(files('fatal: Not possible to fast-forward, aborting.'), []);
console.log('PASS: error cards name the files involved');
