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

- Workspace snapshots are currently in memory and do not survive a browser restart.
- The backend still handles HTTP requests serially; large repositories can take time to refresh.
- Cached remote-tracking information is not proof of current remote state; Fetch explicitly when needed.
- GitLab integration needs a separately installed and authenticated CLI in `bin/glab.exe`.

## Credits and licensing

Creator: Wariddon Rattanamalee. Development assistance: OpenAI Codex.

No open-source license has been selected yet. Public source availability does not itself grant an open-source license; contact the owner about redistribution or licensing.
