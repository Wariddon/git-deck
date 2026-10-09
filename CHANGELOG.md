# Changelog

What changed in each Git Deck release. Dates are release dates (YYYY-MM-DD).

## 1.5.0 — 2026-10-09

Work by ticket across repositories, and much faster with 100+ repositories.

**Work by ticket**
- **My work** and **Release proof**: type a ticket key to see its branches, commits, review and build in every repository. Local Git first; GitLab MRs, pipelines and Argo CD only when you ask. A pipeline or tag is shown as evidence only when it matches the branch's exact commit.
- **Needs attention**: repositories with conflicts, uncommitted files or commits to push or pull, checked as soon as the view opens (local and read-only).
- **Systems**: owners, systems, dependencies and environments of each service, kept on this computer; shows the tag each environment runs from the last Releases load.
- **Task capsules** save where you were on a ticket (repository bases and reading position, never file contents) with a reviewed hand-off text. **Change impact** follows declared dependencies. **Failure lens** lists failed jobs without collecting logs.
- **Fleet recipes**: preview, approve and run read-only review checks on many repositories; each step shows what it found (changed files, diff size, whitespace problems as file:line).

**Faster with many repositories** (measured with 164)
- Repository status refresh: about 30 s → 10–13 s (six at a time).
- Pending work: about 57 s → 24–30 s, and the last check shows at once while the new one runs.
- Needs attention: about 19 s → 10 s. Ticket search: about 30 s → 14 s. Work report: about 0.6 s → 0.25 s per repository.
- Fewer Git starts per repository: unpushed branches from one list, main branch and stash in one lookup, the work-tree check reused for a minute.

**Dashboard**
- The Dashboard button opens Pending work; main views are All repositories, Pending work, My work, Needs attention and Systems. *More tools* is searchable and grouped (Many repositories, Tickets and releases, Code, Git Deck).
- Choosing repositories for recipes and capsules: filter, *Select repositories with changes*, *Clear* and a count.
- All new views in Thai, including their states.

**Fixes**
- Starting Git Deck again brings the open window to the front again (the title match broke under Windows PowerShell 5.1); "â€¦" and "â†’" no longer appear in diff notes and messages.
- The readiness check no longer opens at every start once everything required is ready; the splash closes even when the window is minimized while loading.
- The status refresh no longer leaves repositories on *Waiting for first status check* after one failed poll; background job files are written safely while the server reads them.
- One Undo in the Modern toolbar (the toolbar no longer cuts off *Tools*); dark themes: Annotated, CURRENT and ↑ n marks follow the theme.
- All repositories: the header no longer covers the first row; Copy path stays visible beside the diff file name.

## 1.4.0 — 2026-10-07

Git Deck now talks to the tools around Git.

- **Releases**: which image tag is configured for DEV, SIT, UAT and PROD in your deploy repository (Kubernetes manifests, Helm values, Kustomize), next to the latest tag of the service's repository. Ticket environment hints use this Git configuration; they do not verify the live cluster.
- **Merge requests**: open GitLab merge requests of every repository in one list, and one merge request per repository for a ticket branch.
- **Dependencies**: Maven parent, dependency, plugin and `*.version` versions side by side across repositories, with the ones that differ first.
- **Windows notifications** while Git Deck is in the background: new commits to pull and new tags after a background fetch, finished jobs and GitLab news. Turn them off or test them in *Dashboard → Automation & Windows*.
- **Open in IntelliJ IDEA** for the repository (Open menu, command palette) and for a changed file (right-click), plus *Open in VS Code* for a file.
- Pre-push checks also find Azure storage keys, SAS tokens and JSON Web Tokens, and run [gitleaks](https://github.com/gitleaks/gitleaks) when `bin\gitleaks.exe` is present.
- Pending work refreshes the registered repository list on every check, including repositories whose first status check is still pending.
- Conflict detection reads unmerged Git index entries, so LF/CRLF warnings no longer appear as conflicted filenames after a pull or stash restore.
- **Service catalog**: local owner/system metadata, docs and CI links, explicit dependencies and opt-in Argo CD snapshots. Controller age and unknown/error states are shown separately from Git-configured image tags; no deployment or refresh is requested.
- **MR readiness** in Merge requests and Ticket: approval rules and a pipeline matching the MR head SHA; missing permissions or unsupported approval APIs remain unknown.
- Dashboard tools grouped into Work, Inspect and Manage with search, keyboard navigation and a narrow-screen picker. Service details stack and tables become cards on small windows; secondary toolbar actions stay available under Tools.
- Fix Ticket copy using a newly edited key with old results, editor menus following the wrong repository, stash conflicts missing the primary resolution action, strict-CSP startup CSS and narrow-header overlap.
- Catalog editing now confirms before discarding unsaved changes, prevents stale windows from overwriting newer metadata, preserves unavailable dependency references and refuses malformed catalog files without replacing them. Service details include Copy repository path; future controller timestamps are not treated as fresh.
- Reject incompatible or differently indented image/tag pairs in Releases. Changing the source branch invalidates a bulk merge-request plan; title and draft settings stay fixed while requests are being created.

## 1.3.0 — 2026-10-07

Work across many repositories at once, without opening them one by one.

- **Tag many**: create the next tag in many repositories in one go. Each row suggests the tag after the latest one (`…-poc04` → `…-poc05`, `v1.0.9` → `v1.0.10`), keeps zero padding, can push to origin, and ticks the repositories that have commits after their latest tag.
- **Ticket**: type a ticket key (`PAY-1234`) to see its branches, commits (marked when not pushed yet) and the tags that already contain it in every repository; copy the result as Markdown.
- **Compare files**: compare one file across sibling repositories against a reference, from disk or from a branch or tag. `pom.xml` is compared by parent, properties and dependency versions; YAML, `.properties` and JSON by key; anything else line by line. *Compare one setting* shows one key's value everywhere, grouped.
- **CI status**: the latest GitLab pipeline of each repository's branch or latest tag, failures first, through your own signed-in GitLab CLI.
- **New tags** are marked in Pending work after a fetch, with a filter and *Mark tags as seen*.
- **Worksets as groups**: saved worksets appear in every folder picker; the shown repositories can be saved as one.
- Searching a repository name in Pending work finds it even when it has nothing pending; the summary says how many were checked, how many have work and how many are up to date.
- More menu: icons for every item, an *All repositories* group, and menus that close when you click elsewhere or press Escape.
- Startup: a rounded-square logo tile with a merge animation, drawn the same by `GitDeck.exe`; the progress line no longer covers the *Reload* buttons.
- Look and feel: matching colours on the repository list and dark themes (no more white panels), Dashboard choice cards for *Update all*, tidier Dashboard table, readiness checklist in English and Thai.

## 1.2.0 — 2026-10-07

- **Dashboard** for every repository: pending work by task or as a table, update all (fetch or pull with autostash), switch branch everywhere, search all, branch cleanup, latest tags and a dated **work report** with tickets and CSV/Markdown export.
- **Modern look**: view rail, repository and branch switcher, icon set, Paper/Dark/Midnight themes, slim scrollbars, loading bar and skeletons, gentle motion (off with *reduce motion*).
- Sourcetree-style workflows: right-click menus, custom actions, git-flow, interactive rebase of children, conflict center, Undo on the action bar, merge-and-push after a rejected push, switching branches with uncommitted changes.
- Friendly error cards that name the files and offer the next step.
- Word-level diff highlight; Thai and spaced file names work end to end; English/Thai interface.
- Optional AI helpers (explain, drafts, merge proposal, commit split, push review, release notes), controlled per repository.
- One window: starting Git Deck again brings it to the front; `GitDeck.exe` launcher with a splash card.

## 1.1.0 — 2026-09-28

- Portable release, MIT license, single test runner, release packaging and Scoop/winget manifests.
- Parallel reads, live refresh, line staging, Undo, pre-push checks, AI commit drafts and a GitHub tab.
