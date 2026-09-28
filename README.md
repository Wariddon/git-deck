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
- Node.js is needed only for the JavaScript regression test, not to run the app.

## Quick start

```powershell
git clone https://github.com/Wariddon/git-deck.git
cd git-deck
.\git-dashboard.bat
```

Open **http://127.0.0.1:8765/** if the browser does not open automatically. Keep the server running while using the UI.

Use **Clone**, **Add** or **Scan** to register your own repositories. Scan can discover repositories nested inside the chosen folder. Start with a disposable repository to learn the workflow.

The terminal-only menu is available through `git-repo-manager.bat`.

## Optional desktop launcher

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Build-GitDeck.ps1
.\GitDeck.exe
```

The build uses the Windows .NET Framework C# compiler. Keep the generated executable alongside the scripts and `web/` folder; it is not a standalone bundled application. The executable is unsigned. Closing the app window may leave the local server running.

## Features

- Repository search, scanning, favorites and tabs.
- File status, stage/unstage, commit and diffs.
- Commit history and branch graph; branches, tags, stashes and remotes.
- Fetch, pull and push with a push selection dialog.
- GitLab project and merge-request workflows with optional GitLab CLI.
- Themes, resizable panels and saved UI preferences.
- Bounded in-session workspace snapshots and on-demand LFS/submodule checks.

Feature coverage is evolving; this is not a claim of complete Sourcetree or GitLab parity.

## Local data and safety

Repository lists, paths, cached metadata, job output, activity history and saved UI state are generated locally and excluded from Git. Do not distribute your working folder wholesale: it may contain sensitive repository URLs or command output. Share a clean clone instead.

Git credentials come from your own Git/credential-manager configuration. Never place tokens in repository URLs or source files. The server is intended for trusted local use on `127.0.0.1`; do not expose it through a public proxy or tunnel.

Git operations affect real repositories. Review the selected repository, branch and confirmation before pushing, resetting, deleting or discarding. Back up important work. This project has not undergone a complete security audit or broad end-to-end certification.

## Development checks

```powershell
node --check web/app.js
node tests/workspace-loading.test.cjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/working-diff.test.ps1
```

These focused checks cover workspace request scheduling and working-diff behavior; they are not a complete test suite. Restart the local server after backend changes and reload the browser after frontend changes.

## Known limitations

- Up to six recent workspace snapshots persist in this browser for up to seven days, with a size cap. Use Help > Clear workspace cache to remove them. They may contain private repository metadata; do not share your browser profile.
- The backend still handles HTTP requests serially; large repositories can take time to refresh.
- Cached remote-tracking information is not proof of current remote state; Fetch explicitly when needed.
- GitLab integration needs a separately installed and authenticated CLI in `bin/glab.exe`.

## Credits and licensing

Creator: Wariddon Rattanamalee. Development assistance: OpenAI Codex.

Licensed under the MIT License; see LICENSE.

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

## Portable release and support

Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Build-Release.ps1` to build a ZIP and SHA-256 checksum in `dist/`. Extract the whole ZIP to a writable folder before opening `GitDeck.exe`. Git for Windows is still required; the launcher is unsigned.

Help includes a readiness check and a privacy-safe diagnostic report. Reports contain only allowlisted version/readiness fields, not raw error output. Nothing is uploaded automatically. First launch offers the readiness check.

Push now requires a review of local tracking-ref comparisons. It does not contact the remote until you explicitly Fetch or Push. A missing remote-tracking branch does not prove the remote branch is absent.

The Windows GitHub Actions workflow runs focused tests and builds a downloadable artifact. It does not publish GitHub Releases automatically. Run `node tests/release-tools.test.cjs` and `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/release-server.test.ps1` for the additional local checks.
