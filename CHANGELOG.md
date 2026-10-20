# Changelog

What changed in each Git Deck release. Dates are release dates (YYYY-MM-DD).

## Unreleased

- **Family checks** (Dashboard › Code): the same rules over every repository of a family (`depinq-`, `src-`, `crs-`…) in one table, so a sibling missed in a batch migration stands out. Default rules: Docker base image and Spring Boot version (odd values marked), `argo_yaml` in the SIT Jenkins build (db-migration excluded), `ci-lib-module` as `provided` (it still ends up in the fat jar), and the configuration file per environment in the deploy repository. Rules are JSON you can edit; they stay on this computer.
- **Known traps** (Dashboard › Find and investigate): the checks Push checks runs on added lines, built in and your own. Add a lesson as a rule (files pattern, added-line pattern, what to check, where the lesson is written), try it on a sample line, and it applies from the next push, also for coding agents (MCP push_risk). Kept on this computer (git-deck-traps.json).
- **🧾 Meaning** (History › commit): what a commit changed in pom.xml, application*.yml/.properties, JSON and Dockerfile, in words: "Spring Boot 3.5.6 → 3.5.16", "dependency azure-storage-queue added 12.24.1", "FROM eclipse-temurin:17-scb-1.48 → 1.50", "enterprise-api.host removed".
- **Forgotten work** (Dashboard › Every day): stashes and branches that exist only on this computer and have not moved for 7–90 days, each with its message, age and the files inside; buttons open the Stashes or Branches view. Only repositories the last Pending check flagged are asked. Nothing is deleted.
- **Config time machine** (Effective config › *What changed since*): the effective configuration of a service and environment now against how it was at a past moment (the commit each branch had then, in the service and the deploy repository): settings changed, removed, added, or the same value from another source, with the layer it came from. "UAT worked yesterday; what changed?"
- **Incident timeline** (Dashboard › Find and investigate): pick a time window and get one list, newest first, of every commit of the family on every branch, every change in the deploy repository (with the values / ConfigMap / app-configuration files it touched) and every new tag.
- **API map** (Dashboard › Find and investigate): who provides each HTTP endpoint and who calls it (Spring controllers with their class prefix, Feign clients, URLs in application.yml, path literals) and Kafka topics with producers and consumers, read with git grep from every repository (133 repositories in about 40 s). It flags **the same downstream API called with different paths** (for example findByProxy on /v2 in one place and /sales-services/v1 in another). Also as the MCP tool `api_usage`.
- **Carry a commit over to the siblings** (History › ⇉ Siblings, or Family edit › *Carry over a commit*): the lines a commit changed (old → new) are replaced in every repository of the family where the same line exists, keeping each file's indentation; additions and deletions are listed as skipped, not guessed. Preview per repository, then one commit per repository (several files at once) in its ticket worktree, with the original commit message. Also fixed: a change that only altered letter case was treated as no change.
- **Ticket journey** (Ticket view): for each repository, where the ticket has got to: ✓ pushed → ✓ merged into origin/development, origin/release → ✓ first in tag 1.1.0-29 → ✓ UAT / ✗ PROD for every environment from the last Releases load (the environment tag contains the ticket commit or not).
- **Today is the Dashboard home**, in three columns: *To do* (commit, push, pull and ready-to-tag, one click each), *In progress* (ticket workspaces with work, repositories committed this week) and *News* (new tags, production behind). The 📋 Standup draft is one click away.
- **Dashboard menu by intent**: Every day · The whole family · Release and deploy · Find and investigate, with **📌 pins** at the top (kept per computer) and tools you have not opened for a month moved under *Less often*.
- **Fleet map**: every repository of a folder as a tile, grouped by family (aml-, crs-, lns-…), coloured by state, updated live.
- **Releases trail**: each environment's tag says how many commits it is behind the newest tag ("UAT 1.5.1 · 3 behind").
- **Ticket mode** (🎫 next to the repository tabs): choose a ticket and the tabs of other repositories dim, Pending work and the Ticket view follow it.
- **Docked Dashboard** (⇥, wide windows): the Dashboard sits beside the repository and stays open while you open repositories from it.
- One colour meaning everywhere (ok, to do, blocked, information, nothing), Leelawadee UI for Thai text, explanations shortened to one line (click for more), a 🔔 notification center, a ● Live indicator, rows that changed glow once, skeleton rows while checking, a 14-day commit sparkline in Pending, j/k/Enter// in every Dashboard tool, and the readiness check shown once per computer (not per browser profile).
- **Find from an error log** (Dashboard › Code): paste a stack trace or log; your own frames (framework ones skipped) are looked up in every repository of the folder, showing the repository, file:line and the last three commits that changed that file, plus the exception names. Java/Kotlin frames and Go/JS/TS file:line.
- **Push checks: known traps** in the added lines, each with file:line: a forwarded `Content-Length`, Maven `provided` scope, a Lombok boolean named `isX` (Jackson writes `x`), a changed `application-{env}` file (the deploy ConfigMap wins), `@MockBean` on Spring Boot 3.4+, and a localhost URL in main code. Warnings only (`lib/GitDeck.Traps.ps1`).
- **Tag many** writes release notes into each tag: your message, then "Changes since <previous tag>" with one line per commit (option, on by default).
- **Git Deck as an MCP server** (`mcp/gitdeck-mcp.ps1`, read-only): Claude Code, Codex or Gemini CLI can ask Git Deck for pending work, a file across a family, effective config sources, tickets, activity, push risk and deploy map. Claude Code started from Ticket workspaces is connected automatically; Ticket workspaces › *Connect agents to Git Deck* shows the commands for the others. Included in the release ZIP.
- Pending work: a tag **you** made (in Git Deck, GitLab or a terminal) is no longer marked NEW; the tag tooltip says who tagged. The table works from the keyboard: j/k or arrows move, Enter opens, c commit, p push, u pull.
- **Live Pending work**: Git Deck watches the Git folder of every registered repository (refs only: commit, push, fetch, switch, merge, never the index), so a row updates by itself about 1.5 s after you commit or push from IntelliJ, VS Code or a terminal. No Check needed for those.
- Pending work table is compact: the six count columns are one **State** column of chips (✏️ ⬆️ ⬇️ 📦 🌿 🧹; the ones with a list open it), so the table fits the window. New sort **By family** groups `aml-`, `crs-`, `lns-`… with a heading row (repositories and how many have pending work); single repositories go under Others.
- **Standup draft** (Pending work › Worked on this week › 📋): what you did since the last working day (your own commits, one line per subject, ticket keys from branches), what is left today (uncommitted, unpushed, to pull, to tag) and what blocks you (unfinished merge, remote branch deleted). Editable, one click to copy.
- Pending work is about 5× faster: a check now starts two Git commands per tidy repository (status and one combined `for-each-ref` for branches, tags, mainline, stash and the last commit) instead of seven, and finds the Git folder without Git. On a real C:\SCB folder of 133 repositories: 75 s → 13 s. The request pool now follows the processor count (4–10 threads).
- A branch named like a tag (`v1.0.4-test`) is no longer mistaken for the tag when counting unpushed commits.
- Pending work: a **Worked on this week** filter lists every repository with a commit in the last 7 days as a timeline (newest first, with where each stands), so a repository you just committed and pushed no longer drops out of view.
- Pending work: "not pushed" for other branches now counts only commits that no remote branch has. A local `main` moved onto already-pushed work is no longer "962 commits not pushed" (on a real C:\SCB folder: 19 → 10 repositories flagged). The current branch is flagged when its remote branch was deleted (usually: the merge request was merged).
- **Family edit** (Dashboard › Code): the same change to one file in every repository of a family (presets: Docker base image, a pom property, the Spring Boot parent; or any text or regular expression). The diff of each repository is shown first; Apply writes it in the ticket worktree on `feature/<KEY>` (your own folders stay as they are), refuses a file that changed since the preview, keeps line endings, commits that file alone and optionally pushes, with the merge request link GitLab answers with.
- **Tag many** warns when a version-number tag goes on a branch that is not `release/` or `hotfix/`, and suggests a word test tag from the branch name.
- Effective config reads deploy repositories laid out like `manifestvalues/{env}/lns-app-configuration/{svc}.yml`: a plain Spring file named after the service is the configuration mounted for it (found by its path, even when the file does not mention the service).
- Effective config warns about **partial overrides** (for example the deployment sets `spring.data.redis.host` while `application.yml` still sets `port`, `ssl` and `use-managed-identity`), and **Compare environments** shows every environment side by side: settings missing in some environments first, then settings with different values.
- **Today** (first Dashboard view, and a *Good morning* card once a day): new tags since you last looked, repositories with commits to pull, your work not pushed, ticket workspaces with changes (an agent's work, for example) and services whose production tag differs from UAT (from the last Releases load). *Mark all as seen* moves the starting point to now.
- **Branch stack** (More menu or Ctrl+K): split a big change into branches that build on each other and see the stack around the current branch (each branch, its target, commits, push state and merge request). *Create merge requests* opens one MR per part into the part before it, with a description linking the parts (later parts as drafts); *Restack* rebases every part onto the moved base in one go (`rebase --update-refs`); *Push stack* pushes all parts with `--force-with-lease`.
- **Undo timeline** (Dashboard › Git Deck): every commit, pull, merge, switch, reset, absorb and similar action Git Deck made, in every repository, newest first. *Undo* puts a repository back exactly while nothing newer happened; *Go back to before this* moves the same branch back with `reset --keep` and keeps the newer commits in `refs/gitdeck/backup/<time>` (refused when local changes would be lost). The same action in several repositories within two minutes can be undone together. Going back is recorded too, so it can be undone.
- **Absorb into commits** (beside the commit box, like git-absorb): staged fixes go into the unpushed commits that last changed the same lines, after a preview of where each change goes. Changes from several commits, from pushed commits, new or deleted files stay as working changes. Pushed commits are never rewritten; Undo puts the commits back and the changes staged again.
- **Ticket workspaces** (Dashboard › Tickets and releases): type a ticket key, pick repositories (or *Select repositories that already have the ticket branch*), and Git Deck creates a worktree per repository on `feature/<KEY>` beside it (`<name>.worktrees\<KEY>`), from an existing ticket branch or `origin/develop`/`main`, registered so every view sees it. Your own folders are not touched. Start **Claude Code, Codex, Gemini CLI or Aider** in each (or all) with an editable first prompt, or open Git Deck, a terminal or VS Code there; the list shows changes and commits to push per ticket, and *Remove* cleans up.
- Removing a worktree (Worktrees view and Ticket workspaces) failed with *Worktree was not found* because Git lists worktree paths with `/`.
- **Push risk** in the Push dialog: a 0–100 score with the reasons — production configuration, any application config, database migrations, dependency or build files, deployment or CI files, security code, large or many-file changes, deleted files, and services that declare this one as a dependency (Systems). High risk lists a short checklist (for example *I compared the production values with the ConfigMap*) that must be ticked before Push goes through.
- **Effective config** (Dashboard › Code): the value each Spring Boot setting really gets in one environment, in Spring Boot order: `application.yml` → `application-{env}.yml` → ConfigMap files → environment variables from ConfigMaps and manifests (relaxed binding, so `SPRING_DATASOURCE_URL` and `spring.datasource.url` are one setting; `${NAME:default}` resolved). Settings that the deployment overrides come first: a value changed in `application-uat.yml` that a ConfigMap replaces is shown in amber.
- Starting on another computer: `GitDeck.exe` is not in Git, so `git-dashboard.bat` now builds it on the first start after a clone, and again after a pull that changed the launcher. `Build-GitDeck.ps1 -Shortcut` adds Desktop and Start menu icons. Building no longer rewrites `GitDeck.ico` and `web/favicon.svg` (that left changes behind that blocked the next pull); use `-Artwork` to redraw them.
- Update Git Deck from Git Deck: when the Git Deck folder is a git clone and GitHub has newer commits, a banner offers **Update now** (`git pull --ff-only`, only without local edits in that folder). Checked at most every 6 hours.
- The repository list (`/api/repos`, read at start and after every refresh) and the registration check every request makes use dictionary look-ups instead of nested pipelines: with 201 repositories about 0.65 s → 0.16 s per request.
- Opening a repository asks Git fewer questions: the workspace view uses about 15 Git commands instead of 20–23 (branch, upstream and ahead/behind from the status header, all remote URLs from one `git remote -v`, user name and email in one lookup, submodule and LFS checks only when the repository uses them), and the repository details 8 instead of 18. Same results, checked side by side.
- README: step-by-step start from a clone or from the release ZIP, how to update with `git pull`, and what to do when it does not start.

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
