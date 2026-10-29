# Changelog

What changed in each Git Deck release. Dates are release dates (YYYY-MM-DD).

## Unreleased

## 1.7.0 — 2026-10-29

The screen follows what you are doing, and power tools that work across repositories.

- **Power tools** (Ctrl+K):
  - **Copy this change to sibling repositories**: one commit (a merge too) checked against every sibling (src-svc-x / txi-svc-x, then the family) and applied where it fits, cleanly or by three-way merge; nothing is committed.
  - **Save points**: save the open tabs (or the ticket's repositories) with branch, commit and uncommitted changes to tracked files; load later to put them all back. Loading saves the current state first.
  - **Where does a setting come from?**: one key in every environment with the value it really gets and the layer that wins (ConfigMap over application-{env}.yml).
  - **Blast radius of my push**: services next to this one that call an endpoint or listen to a Kafka topic in the files you are pushing.
  - **Panic** (Ctrl+Alt+Backspace): everything Git Deck changed in any repository lately, each with Undo or a recovery branch.
  - **Morning diff**: on the first start of the day, what came in for your open tabs and which of it touches files you are editing.
- **Clipboard ticket radar** (GitDeck.exe): copy a ticket key anywhere (Jira, LINE, mail) and Git Deck offers to follow it in every repository.
- **Branch graveyard** (Dashboard): merged, gone or 90-day idle local branches in every repository; bury the ticked ones and revive any for 7 days. Long-lived branches (development, release/*, test/*…) are never offered.
- Fixed: the Push dialog's "what each environment really gets" check never ran (its helper was overwritten at load).
- **Flow UI**: the screen follows what you are doing (theme menu › Flow switches each part):
  - **Next step first**: the action bar puts the sensible next step forward (Commit when files changed, Pull when behind, Push when ahead, Fetch when clean); the rest become small icons.
  - **Status as a sentence**: "main · 29 commits to pull"; click a part to act on it (pull and push still ask).
  - **Zen while writing**: writing a commit message fades everything else; move to an edge to see it again; Ctrl+Alt+Z by hand.
  - **Peek**: hold Space over a commit or a changed file for a floating preview.
  - **Timeline** (Ctrl+Alt+T): history as one line from old to now; drag a changed file onto Stage.
  - **Plain requests in Ctrl+K**, in English or Thai: "open txi", "fetch all in SCB", "go history", "theme dark".
  - **Desks** (Dashboard): worksets and open tabs as desks on a canvas you pan and zoom, each with a note.
  - **Focus lens** (off unless chosen): the part under the pointer stays sharp, the rest fades.
- Rubik shape: main buttons (Commit, Pull origin…) keep their colour instead of the plain sticker grey, so they are readable on white plastic too.
## 1.6.1 — 2026-10-29

- **Colour themes work with the Rubik shape**: the theme now picks the cube's plastic. Light is a white cube, Paper a warm white one, Dark a graphite one, Midnight a near-black blue one and Focus the black speedcube; System follows Windows. Before, Rubik kept the dark palette whatever theme was chosen. The separate *Plastic* setting is gone: the theme does it.

## 1.6.0 — 2026-10-29

The whole app as a speedcube: a frameless window, a cube that turns between views, desktop powers (tray, hotkey, Jump List) and faster starts.

- **Scrolling in the top bar** (frameless window): the action bar and the repository tab row can be scrolled again: their scrollbars no longer move the window, and the mouse wheel scrolls them sideways.
- **Speedcube extras** (Rubik shape): every repository tab carries a status sticker (green clean, yellow work to commit, blue to pull, white to push, red conflicts); hold **Ctrl+Alt and type F P U** to fetch, pull and push in one algorithm (pull and push still ask); **Ctrl+Alt+1-6** turns straight to a view; **drag a cube edge** and the face leans with the pointer, turning once dragged far enough; today's cube does a victory spin when solved and keeps a **solve time** with this week's best and the average of five; the softer clack of a speedcube for the cube sound; the Fleet cube can group faces by **folder** and colour stickers by **activity** (a heatmap of the latest commit); the sticker row fits windows down to 1280 px.
- **Speedcube look** (Rubik shape): the whole window is matte black plastic with dark stickers of one height; colour appears only where it means something (a small chip on Repository and Branch, the open view on its rail item, tab and content edge, Dashboard green while open). Calmer classic sticker colours, slimmer cube edges, and the view colour now follows the view restored at start. The rail highlight no longer sticks to Repos.
- **Faster start**: web files are served in parallel and revalidated with an ETag (unchanged files answer 304), so opening Git Deck again loads about 28 KB instead of 1.9 MB and finishes in about half the time (measured 1.7 s → 1.25 s first, 0.65 s after).
- **Lighter while open**: the cube edges only write when something moved, the sliding highlight watches only its menus, card tilt runs at most once per frame, and the periodic checks (today's cube, taskbar number, lessons, ticket time) pause while the window is hidden. A skipped cube turn no longer logs an error.
- **Desktop powers** (frameless window): **Win+Shift+G** from any app shows Git Deck with the command box (Ctrl+Alt+G if Windows has the key); **system tray** icon with Open, Command, Today, Mini mode, Close the day and Quit — closing the window keeps Git Deck in the tray; the **taskbar button** shows how many things need you now; the **Jump List** lists recent repositories and the Today / Command / Mini mode / Close the day tasks. Starting GitDeck.exe again (Jump List, Explorer menu) hands the request to the open window instead of opening a second one.
- **Sticker sets** (Appearance › Stickers): Classic, Neon, Pastel, Mono, Songkran, New Year, or your own colours per view.
- **Cube room** (Rubik shape): the app always sits on a cube — the cube's top face (green, turns up to the Dashboard) and right face (the next view's colour, turns to it) show beside the face you work on, which stays flat and sharp.
- **Twist with the keyboard** (Rubik shape): Ctrl+Alt+Left/Right turns to the previous or next view (or Dashboard view), Ctrl+Alt+Up opens the Dashboard and Ctrl+Alt+Down closes it; a two-finger sideways swipe on the touchpad twists where nothing scrolls sideways.
- **Stickers you can press**: buttons sink when pressed, cards tilt a little toward the pointer (not with reduced motion); **Cube sound** (Appearance, off by default) clicks on every turn, made with Web Audio.
- **Today's cube**: a 3x3 face in the status bar scrambled with the day's open work; each item done turns a sticker green, a solved face celebrates. Repositories Git Deck sees change are re-checked so it stays current.
- **Fleet cube** (The whole family): the six largest families as faces of one cube, every repository a sticker in its weather colour; drag to turn, pick a family to turn to it, click a sticker to open it.
- **Rubik shape** (Appearance › Shape › Rubik, now the default): the whole app as a puzzle cube. Every panel, card and button is a sticker on dark plastic, each view has its sticker colour (rail, sliding highlight, top edge of the content, open tab), and every view change turns the cube: workspace tabs and Dashboard views turn left or right by menu order, another repository turns to the next face, and the Dashboard turns up and back down. Switches made during a turn wait for it; a window that is not painting switches at once; reduced motion switches without the turn. Soft and Square remain.
- **Frameless window**: GitDeck.exe now hosts Git Deck in its own window (WebView2) with no title bar: minimize, maximize and close sit in the repository tab row, the empty parts of the tab row and toolbar move the window (double-click maximizes), and Windows keeps the resize borders, shadow, rounded corners and snap. Links to other sites open in the browser. Without the WebView2 runtime it falls back to the Edge app window. The WebView2 SDK files (Microsoft-signed, from NuGet Microsoft.Web.WebView2 1.0.4314.35) are in `launcher/webview2` and copied next to GitDeck.exe by the build.
- **Cube opening** (Appearance › Opening › Cube, now the default): a scrambled Rubik's-style cube twists itself solved layer by layer; each repository that needs you keeps a red or amber sticker; the green face with the Git Deck mark turns to you and the app grows out of it (about 2.7 s; click or Esc skips; reduced motion skips it).
- **Soft shape** (Appearance › Shape, default): the repository list and content float as rounded islands on a tinted ground, a radius scale (10/14/18 px, squircle corners where the browser supports them), frosted-glass command bar, dialogs and toasts, and a sliding highlight in the side rail, repository tabs and Dashboard menu. Square keeps the previous look.
- **Openings** (Appearance › Opening): Logo (default; the splash logo flies into the corner as the app grows in), Stars (every repository flies in as a star coloured by its weather), Command (start at one box: "What will you do today?" with what you usually do now and the top Inbox items) or Off. A greeting for the time of day follows, with Close the day in the evening; reduced motion keeps it to a fade.
- **Close the day** (Ctrl+K or Dashboard › Every day): one card with what moved today (ticket time, actions), what is still only on this computer, the time Git Deck saved and a plan for tomorrow ready to paste.
- **Time saved**: features record what they spared you (conflicts seen early, recipe steps, quick undos, config checked per environment, lessons, resumed tickets) with modest estimates; shown daily and weekly in Close the day.
- **Production celebration**: when every repository of a ticket lane reaches a production environment, a short confetti burst (none with reduced motion), a note and a Windows toast; tickets already in production on first use are skipped.
- **Ctrl+K predicts**: what you usually do around this time of day (on two or more of the last 30 days) comes first; Enter runs it.
- **Resume a ticket**: Git Deck remembers the repository and view per ticket; leave yourself a note (the ⏱ button) and see it when you come back; recent tickets can be resumed in one click.
- **History replay** (Find and investigate): a repository's history played back as an animation, branches forking and merging, with speed and a time slider.
- **Repository weather** (The whole family): ☀ ⛅ 🌧 ⛈ per repository and one sky per family, from the last Pending check and Conflict forecast.
- **Conflict forecast** (Dashboard › Every day): every repository on a work branch is merged in memory (git merge-tree, nothing checked out) into its main line, develop and teammates' branches of the last 14 days that touch the same files; shows the files that would conflict and who last changed them.
- **Push: what each environment really gets**: for configuration changes, the Push dialog computes the effective configuration of every profile before and after the push (ConfigMaps from the deploy repository included) and lists the values that really change per environment.
- **Time machine** (Find and investigate): the whole family at two moments: main-line commit and newest tag per repository, commits, authors and files in between; the deploy repository first.
- **Ask history** (Find and investigate): ask in Thai or English ("who changed redis.host in crs- this month"); Git Deck runs git log -S/-G over the matching repositories and all branches.
- **Service map** (Find and investigate): the API map as a live graph of who calls whom (HTTP and Kafka); services pulse when they change and arrows turn red when a change removes an endpoint others still call.
- **Habits become recipes**: a run of steps you repeat on three days is offered once as a recipe.
- **Lessons** (Find and investigate): choose a folder of Markdown notes (for example a shared AI brain); 💡 in the status bar and the Push dialog show notes that mention the repository, family, ticket or kind of files you changed. Read-only; secret-looking lines are never shown.
- **Quick undo**: after a local commit, pull, merge, switch, reset or cherry-pick, a toast offers Undo for 10 seconds (same entry as the Undo timeline; pushes and tags are never offered).
- **Review mode** (History › commit › ✔ Review): the commit's files ordered by risk (configuration, deployment, migrations, build first; tests and docs last) with a reason and a read tick per file; clicking a file opens its diff.
- **Recipes** (Ctrl+K › Record a recipe): record fetch, pull, push, switch, branch, tag, stash and merge steps, save them by name and replay them from Ctrl+K after checking the steps; stops at the first failure. Commits, resets and discards are never recorded.
- **Ticket time**: minutes spent per ticket are counted while Git Deck is in front and in use (ticket mode or the branch's ticket key); shown in the status bar, on Ticket lanes and in the Standup draft.
- **Ticket lanes** show the ticket's path as a line of stages: branch, pushed, merged, tagged, then each environment.
- **Calm light theme**: the default Light look now uses the Git Deck design tokens: cool grey ground, white panels, softer borders and the green brand accent (#0B6E47) unless you picked your own accent colour.
- **Mini mode** (▣ in the status bar): a 400×640 window to keep beside the editor with the next few things that need you (shared with the Inbox, ✓ marks done), Push/Pull in one click, the ticket you work on, a live list of repositories that just changed, and a command box that runs in the main window.
- **Midnight Focus theme**: an editor-dark theme (near-black canvas, one green accent, red/amber/blue only for status) beside Dark and Midnight.
- **Family checks** (Dashboard › Code): the same rules over every repository of a family (`depinq-`, `src-`, `crs-`…) in one table, so a sibling missed in a batch migration stands out. Default rules: Docker base image and Spring Boot version (odd values marked), `argo_yaml` in the SIT Jenkins build (db-migration excluded), `ci-lib-module` as `provided` (it still ends up in the fat jar), and the configuration file per environment in the deploy repository. Rules are JSON you can edit; they stay on this computer.
- **Pre-flight in the Push dialog**: besides secrets, sizes, known traps and push risk, a section says in words what the outgoing commits change in pom.xml, configuration and Dockerfile.
- **Release radar** (Releases): each service shows the environment furthest behind the newest tag ("PROD waits for 9"); click it for the commits waiting and copy them as release notes.
- **Ticket lanes** (Dashboard › Every day): one lane per ticket you work on (from current branches, local-only branches and ticket worktrees, plus keys you add): each repository with its state and journey, a summary and the next step. Finished tickets step aside.
- **Command bar that acts** (Ctrl+K): type `tag crs- next`, `push aml-`, `pull lns-`, `ticket AP2365-3320` or a ticket key alone. Git Deck shows a plan for every matching repository (what will happen, what is skipped and why, word tags instead of version tags on feature branches) and runs nothing until you press Run.
- **Inbox** (Dashboard › Every day): everything that needs you across every repository, one item at a time: work to commit, push or pull, branches deleted on the remote, branches only on this computer, new tags by others. E = done (comes back if it changes), H = snooze until tomorrow 9:00, D/Enter = run the suggested step, J/K = move. Filters by family.
- **Density** (Appearance menu): Comfortable (34 px rows) or Compact (26 px rows, tighter tables and cards).
- API map scans are remembered per commit (and per staged state): scanning the same folder again takes about 2 s instead of 12 s. *Re-read files* also reads edits that are not staged yet.
- **Fixed (Windows PowerShell 5.1): double quotes in Git arguments.** A commit message like `fix "x"` was saved as `fix x`, a message with quotes and spaces could fail to commit, and a trailing backslash became a quote. Every Git call (server and job worker) now escapes arguments the way Windows reads a command line. The API map also finds config URLs under any key (`post-promptpay-by-proxy: ${enterprise-api.host}/...`).
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
