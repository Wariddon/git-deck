# Changelog

What changed in each Git Deck release. Dates are release dates (YYYY-MM-DD).

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
