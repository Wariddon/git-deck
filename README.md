<p align="center">
  <img src="assets/brand/git-deck-banner.png" alt="Git Deck — emerald stacked cards with a branching commit graph" width="900">
</p>

# Git Deck

A compact, local Git workspace for Windows, created by **Wariddon Rattanamalee**, with development assistance from **OpenAI Codex**.

Git Deck runs a local PowerShell service and opens a browser-based interface. It is an independent project, not affiliated with Sourcetree, Atlassian, GitHub or GitLab.

## Requirements

- Windows with Windows PowerShell 5.1 and Git for Windows available in `PATH`.
- A modern browser. The optional desktop launcher uses Edge/Chrome app mode where available.
- Optional: Git LFS for LFS operations.
- Optional: GitLab CLI (`glab.exe`) in `bin/` for GitLab integration; authenticate using your own account. No third-party CLI binaries or credentials are bundled.
- Optional: GitHub CLI (`gh`) on `PATH` or `bin/gh.exe` for the GitHub tab; run `gh auth login` with your own account.
- Optional: `ANTHROPIC_API_KEY` or a local Ollama model for AI commit message drafts.
- Node.js is needed only for the JavaScript regression test, not to run the app.

## Quick start

```powershell
git clone https://github.com/Wariddon/git-deck.git
cd git-deck
.\git-dashboard.bat
```

Git Deck opens in its own app window (Microsoft Edge `--app` mode: no tabs or address bar) when Edge is installed, otherwise in your default browser. Open **http://127.0.0.1:8765/** if nothing opens automatically. Keep the server running while using the UI.

Like Sourcetree there is one window: starting Git Deck again brings the open window to the front instead of opening another. When `GitDeck.exe` has been built, `git-dashboard.bat` simply starts it (hidden server, no console window); run `git-dashboard.bat --console` to see the server output while troubleshooting. While loading, Git Deck shows a green card with its logo and name, like Sourcetree's splash. `GitDeck.exe` shows the card the moment you start it, and keeps it until the app window appears, where the page shows the same card.

Use **Clone**, **Add** or **Scan** to register your own repositories. Scan can discover repositories nested inside the chosen folder. Start with a disposable repository to learn the workflow.

The terminal-only menu is available through `git-repo-manager.bat`.

## Optional desktop launcher

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Build-GitDeck.ps1
.\GitDeck.exe
```

The build uses the Windows .NET Framework C# compiler. Keep the generated executable alongside the scripts and `web/` folder; it is not a standalone bundled application. The executable is unsigned. The launcher opens Git Deck as an Edge app window (Edge in Program Files, Program Files (x86) or a per-user install), falling back to the default browser. A server started by the launcher stops by itself about 90 seconds after the last Git Deck window closes (`-IdleShutdownSeconds`); `git-dashboard.bat` keeps running until you close its window.

## Features

- Repository search, scanning, favorites and tabs.
- File status, stage/unstage by file, hunk or individual line, commit and diffs.
- Live refresh: edits, commits and branch switches made in VS Code or a terminal appear automatically.
- One-click **Undo** (or Ctrl+Z) for the last commit, merge, reset, cherry-pick and similar journaled actions.
- Commit message helpers: Conventional Commit type, issue key from the branch name, 72-character subject guide and optional AI drafts.
- Pre-push checks for secrets, large files and direct/force pushes to protected branches.
- Commit history and branch graph; branches, tags, stashes and remotes.
- Fetch, pull and push with a push selection dialog; pull keeps uncommitted work by stashing and restoring it.
- GitLab project and merge-request workflows with optional GitLab CLI.
- GitHub pull requests, Actions runs, PR checkout and PR creation with optional GitHub CLI.
- Optional AI helpers (explain errors and commits, PR/MR drafts, merge proposals, commit splitting, pre-push review, release notes, reflog questions, natural-language commands), controlled per repository.
- Modern look with a view rail, repo / branch switcher and a smart primary button; Classic layout still available.
- Themes, resizable panels and saved UI preferences.
- Bounded in-session workspace snapshots and on-demand LFS/submodule checks.

Feature coverage is evolving; this is not a claim of complete Sourcetree or GitLab parity.

## Local data and safety

Repository lists, paths, cached metadata, job output, activity history and saved UI state are generated locally and excluded from Git. Do not distribute your working folder wholesale: it may contain sensitive repository URLs or command output. Share a clean clone instead.

Git credentials come from your own Git/credential-manager configuration. Never place tokens in repository URLs or source files. The server is intended for trusted local use on `127.0.0.1`; do not expose it through a public proxy or tunnel.

Git operations affect real repositories. Review the selected repository, branch and confirmation before pushing, resetting, deleting or discarding. Back up important work. This project has not undergone a complete security audit or broad end-to-end certification.

## Development checks

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\run-tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\run-tests.ps1 -Filter staging   # only matching files
```

`run-tests.ps1` checks the syntax of every `web/*.js` file and runs every `tests/*.test.cjs` and `tests/*.test.ps1`; CI runs the same script, so a new test file is picked up automatically. The tests are focused regression checks, not a complete end-to-end suite. Restart the local server after backend changes and reload the browser after frontend changes.

## Known limitations

- Up to six recent workspace snapshots persist in this browser for up to seven days, with a size cap. Use Help > Clear workspace cache to remove them. They may contain private repository metadata; do not share your browser profile.
- Read-only requests (status, history, diffs) run in parallel in up to four PowerShell runspaces; Git actions still run one at a time. Start the server with `-Serial` to fall back to one request at a time.
- Cached remote-tracking information is not proof of current remote state; Fetch explicitly when needed.
- GitLab integration needs a separately installed and authenticated CLI in `bin/glab.exe`.

## Credits and licensing

Creator: Wariddon Rattanamalee. Development assistance: OpenAI Codex.

Licensed under the MIT License; see LICENSE.

## Staging lines, Undo and shortcuts

In **File Status**, click `+`/`−` lines in a hunk (Shift+click selects a range) and choose **Stage lines**, **Unstage lines** or **Discard lines**. Git applies only the selected lines.

**Undo** appears next to Push right after a journaled action (commit, merge, reset, cherry-pick, branch switch…). Undoing a commit uses `git reset --soft`, so its changes return to the staging area. Other actions restore the previous HEAD, which needs a clean working tree. Undo is offered only while HEAD still matches the state right after that action, so newer work is never overwritten.

Keyboard shortcuts (outside text fields): `J`/`K` next/previous file or commit, `S`/`U` stage/unstage the selected file, `C` commit message, `/` search, `R` refresh, `F` fetch, `Shift+P` push, `Ctrl+Z` undo, `?` shortcut list.

## Appearance

The theme menu also sets the **Look** and **Text size**, stored per browser:

- **Modern** (default) uses local line icons (`web/icons.js`, nothing is downloaded), zinc neutrals with one accent colour and a neutral dark theme, 24–26px rows (Sourcetree-like density), 8px corners and shadows only on menus and popovers. The header shows **repo / branch ▾** (click the repository to switch repositories, the branch for a searchable branch switcher) and a Sourcetree-style action bar with an icon over each label: **Commit · Pull · Push · Fetch · Branch · Merge · Stash · Tag**, plus **Terminal** and **Explorer** on the right. Pull and Push show their counts, Push reads *Publish* for a branch that is not on the remote yet, and the accent button appears only for *Resolve conflicts*. On narrow windows the labels hide, then Terminal / Explorer. History gives the commit list a bit more than half the height by default (drag the divider; double-click resets). **Stash** opens a small dialog (message, *Keep staged changes*) and **Merge** a branch picker (local and remote branches, filter, merge / always create a merge commit / squash), like Sourcetree. Merge is disabled while there are uncommitted changes and offers *Stash my changes*. History has a single header row: the *Viewing* label and *Show current* / *Return to* buttons sit next to the filters. A left rail opens File Status, History, Branches, Stashes, Tags, Compare, Conflicts (only when there are any), Recovery, Tools and Settings, with counts. History shows author initials, relative times (hover for the date) and coloured ref chips (current branch, local, remote, tag, stash). Loading shows skeletons, empty views show an icon and, where obvious, a next step; menus and toasts animate briefly (off with the system “reduce motion” setting). A saved **Clean** preference from earlier versions opens as Modern. Modern also includes the Clean layout:
- The Clean layout uses fewer borders and hides repeated hints. File Status sorting and layout sit under **View**, History order and layout join its **View ▾** menu, and rarely used diff tools move under **⋯**, and change/file navigation becomes arrows. The Ctrl+Enter hint lives in the commit message placeholder. The toolbar keeps Commit, Fetch, Pull, Push and More (Branch and Tag sit at the top of More). The repository list folds Create / Add / Scan into **＋ Add**, shows counts on the filter chips instead of the summary tiles, and hides an empty Scan locations card. **Classic** is the original dense layout, unchanged.
- **Easy on the eyes (Modern):** titles, section headings, text and captions use a small type scale derived from the text size (e.g. 16 / 14 / 12 / 11 at 12px), with weights 400 / 500 / 600 only. Text contrast stays readable without glare (about 14:1 in light and dark, no pure white or pure black) and diffs use muted colours. **Paper** is a warm cream theme for long sessions. The accent colour is kept for the main action and the current selection. Rail items explain their page on hover, File Status says what to do next in words, and **Focus** on the rail hides the side panels.
- **Text size** 8 / 10 / 12 / 14 px (default 12) scales all UI copy. Diff text keeps its own A− / A+ size.


The theme menu has a **Language** switch (English / ไทย), stored per browser. Source copy is English; `web/i18n.js` looks each string up with `t('English text', {placeholders})` and falls back to English when there is no translation. Thai strings live in `web/i18n-th.js`, and `tests/i18n.test.cjs` fails when a `t()` key has no Thai entry, when an entry is no longer used, or when placeholders differ. Migration is gradual: the GitHub tab, line staging, commit helpers, pre-push checks, pull, undo and shortcuts are translated; the main workspace (`app.js`, `diff-ui.js`, `release-ui.js`, `workflow-ui.js`) is still English-only.

## Pulling with uncommitted changes

**Pull** no longer requires a clean working tree. Before pulling, Git Deck lists your changed files that the incoming commits also touch, then runs `git pull --autostash` after you confirm: your changes are stashed, the pull runs, and they are restored. If restoring conflicts, File Status opens with the conflicted files and a copy of your changes stays in the stash (`autostash`) until you drop it. Untracked files are not stashed, so a pull that would overwrite one is blocked up front. Predictions use the last Fetch.

## Switching branches with uncommitted changes

Like plain Git (and Sourcetree), switching no longer requires a clean working tree. The review before checkout compares your uncommitted files with the files that differ between the two commits:

- **No overlap:** *Switch and keep my changes* — Git carries the changes to the other branch.
- **Overlap** (or an untracked file the other branch also has): *Stash, switch and restore* — Git Deck stashes your changes (including untracked files), switches, and restores them. If restoring conflicts, File Status opens with the conflicted files, the files that restored cleanly are staged (as `git stash pop` does), and a copy stays in the stash, so nothing is lost.
- **Merge, rebase or cherry-pick in progress:** switching stays blocked until you finish or abort it.

Creating a new branch from the current commit always keeps your changes.

## More Sourcetree-style actions

- **File Status right-click:**
  - *Ignore this file / all `*.ext` files / folder* adds the line to `.gitignore`, and says when files already tracked still match.
  - *Stop tracking (keep the file)* runs `git rm --cached`.
  - Conflicted files get *Resolve using mine / theirs*.
  - Untracked files get *Move to Recycle Bin…*: recoverable, unlike Sourcetree's permanent delete.
- **History file list right-click:**
  - *Open this version* opens a copy of the file as it was in that commit. Scripts and programs are only shown in Explorer, never run.
  - *Reset file to this commit…* is refused while the file has uncommitted changes.
- **Commit box:**
  - *Recent…* reuses one of your recent commit messages.
  - When the branch has an upstream, *Push to origin/x after commit* runs the pre-push checks and pushes. If any check is not green (protected branch, possible secret, large or sensitive file), nothing is pushed and the Push dialog opens instead.
- **Compare in VS Code** (Sourcetree's External Diff): from File Status it compares HEAD with the working copy; from History it compares the file before and after that commit. It uses temporary copies and needs `code` on PATH.
- **Ignore whitespace** in commit diffs (History) hides changes that only touch spaces, tabs or line endings. Staging diffs stay exact so hunks still apply.
- **Stashes:**
  - *Keep staged changes* adds `--keep-index` when saving.
  - Apply and Pop work on top of uncommitted work. Git refuses and changes nothing if a file would be overwritten; a content conflict opens File Status and keeps the stash.
- **Conflicts from a stash restore** (no merge or rebase in progress) can be resolved in the Conflict Center and with mine/theirs, like merge conflicts.
- **Push rejected because the remote has newer commits:**
  - Git Deck offers *Merge and push*. It merges the remote branch into yours and pushes again. It uses rebase instead only when that is your pull strategy, and it stashes and restores uncommitted work.
  - When the push review already shows the branch is behind, it offers *Merge remote changes, then push*.
  - If both sides changed the same lines, the **Conflicts** page opens. Resolve the files and commit the merge (Continue); Git Deck then asks *Push now?* so the waiting push is not forgotten. Abort drops it.
  - Force push never triggers the offer, and a second rejection does not loop.

## When something fails

Every error card says, in plain words, what happened and what to do next. It also has buttons that go there. Git's exact message stays under *Details*. The card also lists the files involved (the first three, then "and N more"). Some examples:

| Problem | Buttons |
| --- | --- |
| Conflicts, or an unfinished merge or rebase | Open Conflicts |
| Uncommitted or new files are in the way | Stash my changes and try again · Open File Status |
| Pull: both sides have new commits (fast-forward impossible) | Pull with merge · Pull with rebase |
| Push: the remote has newer commits | Merge and push |
| Branch not on the remote yet | Publish branch |
| Sign-in failed, remote not found, network down | Try again · Open Remotes |
| No name or email, protected branch, detached HEAD, nothing to commit | Settings, Branches or File Status |
| Lock file, file open in another program, folder owned by another user, path too long | Try again · Copy fix command |

Pull with *fast-forward only* on a branch that has its own commits and incoming ones no longer fails: Git Deck asks *Pull with merge* or *Pull with rebase* first. The card keeps only the repository name visible; the full repository and folder block is under *Details*.

Errors Git Deck does not recognise still get *Try again* and *Check repository health*. The Push dialog's error box uses the same wording.

## Pre-push checks

The Push dialog scans the commits that the remote does not have yet: added lines that look like private keys or API tokens (AWS, GitHub, GitLab, Slack, Anthropic, Google and generic `password = "…"` assignments), files of 5 MB or more, sensitive file names such as `.env` or `*.pem`, and direct or force pushes to `main`, `master`, `develop`, `release/*` and similar branches. Blocking findings ask for confirmation before pushing. Previews are masked, and the scan runs locally only. It is a safety net, not a replacement for server-side secret scanning.

## AI commit messages (optional)

**✨ Suggest** in the commit box drafts a message from the *staged* diff. Nothing is sent until you click it and confirm, and the diff is never sent if it contains something that looks like a secret. Diffs over 120 KB are cut, and the UI says so.

- Anthropic: set the `ANTHROPIC_API_KEY` environment variable, then restart Git Deck. The default model is `claude-opus-5-5`.
- Local model: create `git-deck-ai.json` next to the server (it is git-ignored):

```json
{ "provider": "ollama", "ollamaModel": "llama3.1", "ollamaUrl": "http://127.0.0.1:11434", "language": "Thai" }
```

`GITDECK_AI_PROVIDER` and `GITDECK_AI_MODEL` override the file. Always review the draft before committing.

## AI helpers (optional)

The same provider powers a few more ✨ buttons. AI only explains or proposes; anything that changes the repository still goes through the normal Git Deck action and its confirmation, and AI answers never run Git commands. Git Deck asks once per repository and provider per session before sending anything, scans every line it would send for secrets (and refuses to send if it finds one), and caps the size.

| Where | Button | Sends |
| --- | --- | --- |
| Error card | ✨ Explain | the error text and repository status |
| GitHub PR form / GitLab MR dialog | ✨ Draft title & description | commits and diff against the base branch |
| History commit details | ✨ Explain | that commit and its diff |
| Conflict Center | ✨ Propose merge | Base / Ours / Theirs of the selected file; the result box is filled for you to review and save |
| Commit box | ✨ Split | the staged diff; each proposed group can be kept staged on its own (the rest moves back to unstaged, working files untouched) |
| Push dialog | ✨ AI review | the commits about to be pushed (advice only, never blocks) |
| Ctrl+K palette | ✨ Ask AI | your request and the list of command names; it suggests one command and asks before opening it |
| Recovery | ✨ Ask about history | your question and the reflog; suggested commits can become a recovery branch |
| Tags | ✨ Release notes | commit messages in the chosen range |

**Per-repository policy** (Settings › AI for this repository): *Allowed*, *Local model only (Ollama)* or *Off*. It is stored in that repository's own `.git/config` (`gitdeck.ai`), is never committed, and is enforced by the server — use *Off* or *Local only* for work repositories whose code must not leave your machine.

## GitHub

For repositories whose `origin` is on github.com, the **GitHub** tab lists open pull requests and recent Actions runs. From there you can open or check out a PR, re-run failed jobs, and push the current branch and create a pull request. It uses your own `gh auth login` session. Git Deck never stores GitHub tokens.

## Daily workflow helpers

Open **Help** (under **View & tools**) or press **Ctrl+K** and search:

- **Before sending**: fresh local branch/working-file review, explicit remote/target comparison, and an optional online GitLab MR status check. The Push dialog still requires its own destination selection and confirmation.
- **Refresh files**: also runs when returning to the app from an IDE. Reads only the active repo's status; it does not Fetch or reload History. External HEAD changes show a refresh notice.
- **Action help**: explains common Push/Checkout/Merge blockers and links to File Status, Remotes, Conflict Center and Compare.
- **Worksets**: save up to 30 named groups of up to 50 open repo tabs. Opening a group preserves existing tabs/drafts; missing repositories are skipped, never cloned automatically. Groups are stored locally in this browser.
- **Performance**: bounded, numeric-only local timings. Request time includes network/queue/server work; the difference from Git time is not an exact queue measurement. Render measures synchronous DOM work. Copying a report never uploads it.
- **Practice**: creates a new repository in `sandboxes/practice-*`, with local practice identity and no remote. Stage/commit `notes.txt`, then merge `lesson/conflict` into `main` to practice conflict resolution. Existing practice repositories are never overwritten or automatically deleted.

Checkout now opens a fresh comparison and blocks confirmation while working changes or an operation are pending. It does not automatically stash. Git is checked again immediately before checkout.

Restart the local server after updating: the new status, checkout-review and practice endpoints require the matching server version. This workflow does not require online access except explicit remote/MR actions.

## Commit diff reader

Commit inspection remembers the selected file, file filter and diff scroll position per repository and commit (up to 20 recent commits per repository, stored in this browser). Missing files fall back to a file that still exists. Rapid repository switching uses a latest-request guard when restoring the view; restoring an already-selected commit does not request its details again.

Commit details show file status and added/removed line counts; per-file History/Blame live in the overflow menu. Blame explicitly reads the current working revision. Merge details compare against the first parent.

The diff reader remembers font size (12px default), supports unified/side-by-side layouts, independent scrolling, wrap, intraline highlights, non-filtering search, previous/next change, collapsed context, and focus mode with previous/next file. Escape exits focus mode.

Preview reads the selected commit, or its first parent for a deleted file. Markdown uses a restricted text-only subset: no executable HTML, external images or active links. PDF/binary files offer a download rather than an embedded viewer. Content is capped at 10 MB, text previews at 1 MB, and displayed diffs at 6,000 lines/500 KB. Search covers loaded diff content only. Restart the local server after updating to enable the content endpoint.

## Install with Scoop or winget

After publishing a GitHub release with the ZIP from `Build-Release.ps1`, generate package manifests that point at it:

```powershell
.\Build-Release.ps1 -Version 1.2.0
# upload dist\GitDeck-1.2.0-windows.zip to the GitHub release v1.2.0
.\packaging\New-PackageManifests.ps1 -Version 1.2.0
```

This writes `dist\packaging\git-deck.json` (a Scoop bucket manifest with `checkver`/`autoupdate` and persisted local data) and `dist\packaging\winget\<version>\` (a portable-zip winget manifest). Run `winget validate` and a local install test on Windows before submitting to a Scoop bucket or `microsoft/winget-pkgs`.

## Portable release and support

Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Build-Release.ps1` to build a ZIP and SHA-256 checksum in `dist/`. Extract the whole ZIP to a writable folder before opening `GitDeck.exe`. Git for Windows is still required; the launcher is unsigned.

Help includes a readiness check and a privacy-safe diagnostic report. Reports contain only allowlisted version/readiness fields, not raw error output. Nothing is uploaded automatically. First launch offers the readiness check.

Push now requires a review of local tracking-ref comparisons. It does not contact the remote until you explicitly Fetch or Push. A missing remote-tracking branch does not prove the remote branch is absent.

The Windows GitHub Actions workflow runs focused tests and builds a downloadable artifact. It does not publish GitHub Releases automatically. Run `node tests/release-tools.test.cjs` and `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/release-server.test.ps1` for the additional local checks.
