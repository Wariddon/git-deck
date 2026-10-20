# Git Deck multi-repository views: pending work, branch cleanup, search and branch lookup.
# Dot-sourced by git-dashboard-server.ps1 after GitDeck.Activity.ps1 (uses Get-GitDeckMainline).
# Read-only and local (no network); Windows PowerShell 5.1 compatible.

$script:ProtectedBranches = @('main', 'master', 'develop', 'dev', 'release', 'staging', 'production')

function Get-GitDeckLines($Result) {
    if ($Result.Code -ne 0) { return @() }
    return @(([string]$Result.Output) -split "`r?`n" | Where-Object { $_ })
}

# Branch name from a `git status --branch` header: "main...origin/main [ahead 1]",
# "No commits yet on main", "HEAD (no branch)". Same text as `git branch --show-current`.
function Get-GitDeckHeaderBranch([string]$Header) {
    if ($Header -match '^(?:No commits yet on|Initial commit on) (\S+)') { return $Matches[1] }
    if ($Header -match '^HEAD \(no branch\)') { return '' }
    return ($Header -split '\.\.\.', 2)[0].Split(' ')[0]
}

# Unfinished merge, rebase, cherry-pick or revert, from marker files in the Git folder.
function Get-GitDeckOperationType([string]$GitDir) {
    if (-not $GitDir -or -not (Test-Path -LiteralPath $GitDir -PathType Container)) { return '' }
    if (Test-Path -LiteralPath (Join-Path $GitDir 'MERGE_HEAD')) { return 'merge' }
    if ((Test-Path -LiteralPath (Join-Path $GitDir 'rebase-merge')) -or (Test-Path -LiteralPath (Join-Path $GitDir 'rebase-apply'))) { return 'rebase' }
    if (Test-Path -LiteralPath (Join-Path $GitDir 'CHERRY_PICK_HEAD')) { return 'cherry-pick' }
    if (Test-Path -LiteralPath (Join-Path $GitDir 'REVERT_HEAD')) { return 'revert' }
    return ''
}

# The repository's own Git directory without starting Git: ".git" is a folder, or a file pointing
# at the worktree's directory ("gitdir: ..."), which may be relative.
function Get-GitDeckGitDir([string]$Path) {
    $marker = Join-Path $Path '.git'
    if (Test-Path -LiteralPath $marker -PathType Container) { return $marker }
    try {
        $text = ([IO.File]::ReadAllText($marker) -replace '^gitdir:\s*', '').Trim()
        if (-not [IO.Path]::IsPathRooted($text)) { $text = Join-Path $Path $text }
        return [IO.Path]::GetFullPath($text)
    } catch { return '' }
}

# Everything still open in one repository: uncommitted files, unpushed commits, stashes,
# merged branches nobody deleted, and an unfinished merge/rebase.
function Get-GitDeckPendingWork([string]$Path) {
    Assert-Registered $Path
    # Two Git commands for a tidy repository (three with tags): Dashboard checks run this for every repository,
    # and on Windows each Git start costs ~50 ms, so lookups are combined where Git allows it.
    $status = @(Get-GitDeckLines (Invoke-GitCapture $Path @('status', '--porcelain=v1', '--branch')))
    $head = if ($status.Count -and $status[0].StartsWith('## ')) { $status[0].Substring(3) } else { '' }
    $files = @($status | Where-Object { -not $_.StartsWith('## ') })
    $conflicts = @($files | Where-Object { $_ -match '^(UU|AA|DD|AU|UA|DU|UD) ' }).Count
    $untracked = @($files | Where-Object { $_.StartsWith('?? ') }).Count
    # "## main...origin/main [ahead 1]", "## No commits yet on main", "## HEAD (no branch)".
    $branch = Get-GitDeckHeaderBranch $head
    $ahead = 0; $behind = 0; $upstream = ''
    if ($head -match '\.\.\.(\S+)') { $upstream = $Matches[1] }
    if ($head -match 'ahead (\d+)') { $ahead = [int]$Matches[1] }
    if ($head -match 'behind (\d+)') { $behind = [int]$Matches[1] }
    # The remote branch was deleted (usually: its merge request was merged).
    $upstreamGone = $head -match '\[gone\]$'
    # One for-each-ref for local branches (upstream, tip, and the last commit of the current one),
    # tags (newest first, sorted here), the mainline candidates and the stash.
    $format = '--format=%(refname)%09%(upstream:short)%09%(upstream:track)%09%(objectname)%09%(symref:short)%09%(creatordate:iso-strict)%09%(if)%(taggeremail)%(then)%(taggeremail)%(else)%(authoremail)%(end)%09%(if)%(HEAD)%(then)%(committerdate:iso-strict)%09%(subject)%(end)'
    $heads = New-Object 'System.Collections.Generic.List[object]'
    $tags = New-Object 'System.Collections.Generic.List[object]'
    $refs = @{}; $last = @()
    foreach ($line in Get-GitDeckLines (Invoke-GitCapture $Path @('for-each-ref', $format, 'refs/heads', 'refs/tags', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/stash'))) {
        $f = $line -split "`t", 9
        if ($f[0].StartsWith('refs/tags/')) {
            $when = [DateTimeOffset]::MinValue; [void][DateTimeOffset]::TryParse($(if ($f.Count -gt 5) { $f[5] } else { '' }), [ref]$when)
            $tags.Add([pscustomobject]@{ name = $f[0].Substring(10); date = $(if ($f.Count -gt 5) { $f[5] } else { '' }); when = $when; by = $(if ($f.Count -gt 6) { $f[6].Trim('<', '>') } else { '' }) })
            continue
        }
        $refs[$f[0]] = $(if ($f.Count -gt 4) { $f[4] } else { '' })
        if ($f[0].StartsWith('refs/heads/')) {
            $heads.Add([object[]]@($f[0].Substring(11), $f[1], $f[2], $f[3]))
            if ($f.Count -gt 7 -and $f[7]) { $last = @($f[7], $(if ($f.Count -gt 8) { $f[8] } else { '' })) }
        }
    }
    # Other local branches with commits that are on no remote.
    $unpushed = New-Object 'System.Collections.Generic.List[object]'
    $loose = New-Object 'System.Collections.Generic.List[string]'
    $tips = @{}; $upstreams = @{}
    foreach ($f in $heads) {
        if ($f[0] -eq $branch) { continue }
        # Ahead of its upstream or without one: counted below as commits that no remote branch has, so
        # a local main moved onto (already pushed) develop work is not "962 commits not pushed".
        if (-not ($f.Count -gt 1 -and $f[1]) -or ($f.Count -gt 2 -and $f[2] -match 'ahead \d+')) {
            $loose.Add($f[0]); $tips[$f[0]] = $(if ($f.Count -gt 3) { $f[3] } else { '' }); $upstreams[$f[0]] = $(if ($f.Count -gt 1) { $f[1] } else { '' })
        }
    }
    # Branches without an upstream: one list of the commits no remote has, with their parents. A commit
    # is unpushed for a branch when it can be reached from the branch tip through unpushed commits.
    if ($loose.Count) {
        $parents = @{}
        # Full ref names: a branch called like a tag (v1.0.4-test) must not resolve to the tag.
        foreach ($line in Get-GitDeckLines (Invoke-GitCapture $Path (@('rev-list', '--parents') + @($loose | ForEach-Object { "refs/heads/$_" }) + @('--not', '--remotes')))) { $ids = $line.Split(' '); $parents[$ids[0]] = $ids }
        if ($parents.Count) {
            foreach ($name in $loose) {
                $seen = New-Object 'System.Collections.Generic.HashSet[string]'
                $queue = New-Object 'System.Collections.Generic.Queue[string]'
                if ($parents.ContainsKey([string]$tips[$name])) { $queue.Enqueue([string]$tips[$name]) }
                while ($queue.Count) {
                    $id = $queue.Dequeue(); if (-not $seen.Add($id)) { continue }
                    $ids = $parents[$id]; for ($i = 1; $i -lt $ids.Count; $i++) { if ($parents.ContainsKey($ids[$i])) { $queue.Enqueue($ids[$i]) } }
                }
                if ($seen.Count) { $unpushed.Add(@{ branch = $name; commits = $seen.Count; upstream = [string]$upstreams[$name] }) }
            }
        }
    }
    # Mainline (as Get-GitDeckMainline decides it) and whether a stash exists.
    $mainline = if ($refs['refs/remotes/origin/HEAD']) { $refs['refs/remotes/origin/HEAD'] } else { '' }
    if (-not $mainline) { foreach ($pair in @(@('refs/remotes/origin/main', 'origin/main'), @('refs/remotes/origin/master', 'origin/master'), @('refs/heads/main', 'main'), @('refs/heads/master', 'master'))) { if ($refs.ContainsKey($pair[0])) { $mainline = $pair[1]; break } } }
    $stashes = @()
    if ($refs.ContainsKey('refs/stash')) {
        $stashes = @(Get-GitDeckLines (Invoke-GitCapture $Path @('stash', 'list', '--format=%gd%x09%s'))) | ForEach-Object { $p = $_ -split "`t", 2; @{ ref = $p[0]; message = $(if ($p.Count -gt 1) { $p[1] } else { '' }) } }
    }
    $merged = @()
    $others = @($heads | Where-Object { $_[0] -ne $branch -and $script:ProtectedBranches -notcontains $_[0] })
    if ($mainline -and $others.Count) {
        $merged = @(Get-GitDeckLines (Invoke-GitCapture $Path @('branch', '--format=%(refname:short)', '--merged', $mainline)) |
            Where-Object { $_ -ne $branch -and $script:ProtectedBranches -notcontains $_ -and "origin/$_" -ne $mainline })
    }
    $operation = Get-GitDeckOperationType (Get-GitDeckGitDir $Path)
    # Newest tag (by tag or commit date) and the commits the current branch has after it.
    $tag = @{ name = ''; date = ''; by = ''; since = 0; count = $tags.Count }
    if ($tags.Count) {
        $newest = @($tags | Sort-Object -Property @{ Expression = 'when'; Descending = $true }, @{ Expression = 'name'; Descending = $false })[0]
        $tag.name = $newest.name; $tag.date = $newest.date; $tag.by = $newest.by
        $since = 0; [void][int]::TryParse(([string](Invoke-GitCapture $Path @('rev-list', '--count', "refs/tags/$($newest.name)..HEAD")).Output).Trim(), [ref]$since); $tag.since = $since
    }
    # When the current branch last changed, and with what (a detached HEAD asks Git once more).
    if (-not $last.Count) { $last = ([string](Invoke-GitCapture $Path @('log', '-1', '--format=%cI%x09%s')).Output).Trim() -split "`t", 2 }
    return [ordered]@{
        branch = $branch; upstream = $upstream; upstreamGone = $upstreamGone; ahead = $ahead; behind = $behind
        changed = $files.Count - $untracked; untracked = $untracked; conflicts = $conflicts
        operation = $operation
        unpushedBranches = $unpushed.ToArray(); stashes = @($stashes); mergedBranches = $merged; mainline = $mainline
        latestTag = $tag.name; latestTagDate = $tag.date; latestTagBy = $tag.by; commitsSinceTag = $tag.since; tagCount = $tag.count
        lastCommitDate = $(if ($last[0] -match '^\d{4}-') { $last[0] } else { '' }); lastCommitSubject = $(if ($last.Count -gt 1) { $last[1] } else { '' })
    }
}

# The newest tag in the repository (by tag or commit date) and how many commits the current
# branch has that the tag does not: "v1.4.0, 3 days ago, 5 commits since".
function Get-GitDeckLatestTag([string]$Path) {
    $lines = @(Get-GitDeckLines (Invoke-GitCapture $Path @('for-each-ref', '--sort=-creatordate', '--format=%(refname:short)%09%(creatordate:iso-strict)', 'refs/tags')))
    if (-not $lines.Count) { return @{ name = ''; date = ''; since = 0; count = 0 } }
    $f = $lines[0] -split "`t", 2
    $since = 0
    $count = (Invoke-GitCapture $Path @('rev-list', '--count', "refs/tags/$($f[0])..HEAD")).Output
    [void][int]::TryParse(([string]$count).Trim(), [ref]$since)
    return @{ name = $f[0]; date = $(if ($f.Count -gt 1) { $f[1] } else { '' }); since = $since; count = $lines.Count }
}

# Branch hygiene: local and remote branches with merged state, age and a gone upstream.
function Get-GitDeckBranchCleanup([string]$Path) {
    Assert-Registered $Path
    $mainline = Get-GitDeckMainline $Path
    $current = ([string](Invoke-GitCapture $Path @('branch', '--show-current')).Output).Trim()
    $mergedLocal = @{}; $mergedRemote = @{}
    if ($mainline) {
        foreach ($name in Get-GitDeckLines (Invoke-GitCapture $Path @('for-each-ref', '--format=%(refname:short)', '--merged', $mainline, 'refs/heads'))) { $mergedLocal[$name] = $true }
        foreach ($name in Get-GitDeckLines (Invoke-GitCapture $Path @('for-each-ref', '--format=%(refname:short)', '--merged', $mainline, 'refs/remotes'))) { $mergedRemote[$name] = $true }
    }
    $items = New-Object 'System.Collections.Generic.List[object]'
    $format = '--format=%(refname)%09%(refname:short)%09%(committerdate:iso-strict)%09%(upstream:short)%09%(upstream:track)%09%(subject)'
    foreach ($line in Get-GitDeckLines (Invoke-GitCapture $Path @('for-each-ref', $format, 'refs/heads', 'refs/remotes'))) {
        $f = $line -split "`t", 6
        if ($f.Count -lt 6 -or $f[0] -match '/HEAD$') { continue }
        $remote = $f[0].StartsWith('refs/remotes/')
        $short = $f[1]
        $base = if ($remote) { $short.Substring($short.IndexOf('/') + 1) } else { $short }
        $protected = $script:ProtectedBranches -contains $base -or $short -eq $mainline -or (-not $remote -and $short -eq $current)
        $items.Add([ordered]@{
            name = $short; remote = $remote; date = $f[2]; upstream = $f[3]; gone = ($f[4] -eq '[gone]'); subject = $f[5]
            merged = $(if ($remote) { [bool]$mergedRemote[$short] } else { [bool]$mergedLocal[$short] }); protected = $protected; current = (-not $remote -and $short -eq $current)
        })
    }
    return [ordered]@{ mainline = $mainline; current = $current; branches = $items.ToArray() }
}

# Search one repository: commit messages (and ticket keys), branch names, or changed content.
function Search-GitDeckRepository([string]$Path, [string]$Query, [string]$Mode) {
    Assert-Registered $Path
    $Query = ([string]$Query).Trim()
    if (-not $Query -or $Query.Length -gt 200 -or $Query -match "[`r`n]" -or $Query.StartsWith('-')) { throw 'Search text is required, under 200 characters and must not start with "-".' }
    if ($Mode -eq 'content') { $found = @(Search-HistoryContent $Path $Query 'literal'); return @{ commits = $found; branches = @() } }
    $branches = @(Get-GitDeckLines (Invoke-GitCapture $Path @('for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes')) |
        Where-Object { $_ -notmatch '/HEAD$' -and $_.IndexOf($Query, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 30)
    $result = Invoke-GitCapture $Path @('log', '--exclude=refs/stash', '--all', '--date=short', '--regexp-ignore-case', '--fixed-strings', "--grep=$Query",
        '--format=%h%x1f%H%x1f%ad%x1f%an%x1f%s%x1f%D', '-60')
    $commits = if ($result.Code -eq 0) { @(Convert-LogLines $result.Output) } else { @() }
    return @{ commits = @($commits); branches = @($branches) }
}

# Where a branch name exists in a repository, so a multi-repository switch can pick switch,
# track or create for each one.
function Find-GitDeckBranch([string]$Path, [string]$Name) {
    Assert-Registered $Path
    $Name = ([string]$Name).Trim()
    Assert-BranchName $Path $Name
    $local = (Invoke-GitCapture $Path @('show-ref', '--verify', '--quiet', "refs/heads/$Name")).Code -eq 0
    $remote = ''
    foreach ($ref in Get-GitDeckLines (Invoke-GitCapture $Path @('for-each-ref', '--format=%(refname:short)', "refs/remotes/*/$Name"))) { $remote = $ref; break }
    $current = ([string](Invoke-GitCapture $Path @('branch', '--show-current')).Output).Trim()
    $dirty = @(Get-GitDeckLines (Invoke-GitCapture $Path @('status', '--porcelain'))).Count -gt 0
    return [ordered]@{ local = $local; remote = $remote; current = $current; dirty = $dirty }
}

# Tags created after a time (Unix seconds), newest first, for the Today view's "new tags" list.
# Tracked files whose path ends with one of the names (com/scb/x/Foo.java, Foo.java), each with the
# last commits that changed it: "where does this stack trace line live, and who touched it last?".
function Find-GitDeckFilesBySuffix([string]$Path, [string]$Names) {
    Assert-Registered $Path
    $wanted = @(([string]$Names) -split '\|' | ForEach-Object { $_.Trim().Replace('\', '/').TrimStart('/') } | Where-Object { $_ -and $_.Length -le 300 -and $_ -notmatch '\.\.' } | Select-Object -First 20)
    if (-not $wanted.Count) { return @() }
    $found = New-Object 'System.Collections.Generic.List[object]'
    foreach ($file in Get-GitDeckLines (Invoke-GitCapture $Path @('ls-files'))) {
        foreach ($name in $wanted) {
            if ($file -eq $name -or $file.EndsWith('/' + $name)) {
                $commits = @(Get-GitDeckLines (Invoke-GitCapture $Path @('log', '-3', '--format=%h%x09%cs%x09%an%x09%s', '--', $file)) | ForEach-Object {
                    $f = $_ -split "`t", 4; [ordered]@{ hash = $f[0]; date = $f[1]; author = $f[2]; subject = $(if ($f.Count -gt 3) { $f[3] } else { '' }) } })
                $found.Add([ordered]@{ name = $name; file = $file; commits = $commits })
                break
            }
        }
        if ($found.Count -ge 30) { break }
    }
    return $found.ToArray()
}

# Commit subjects on HEAD after a tag (or the last 30 without one), newest first: a tag message
# that says what the tag contains.
function Get-GitDeckCommitsSince([string]$Path, [string]$Ref) {
    Assert-Registered $Path
    $Ref = ([string]$Ref).Trim()
    if ($Ref -and ($Ref.Length -gt 200 -or $Ref.StartsWith('-') -or $Ref -notmatch '^[A-Za-z0-9._/@-]+$')) { throw 'Tag name is not valid.' }
    $range = if ($Ref) { "refs/tags/$Ref..HEAD" } else { 'HEAD' }
    $items = New-Object 'System.Collections.Generic.List[object]'
    foreach ($line in Get-GitDeckLines (Invoke-GitCapture $Path @('log', '--no-merges', '--max-count=30', '--format=%h%x09%s', $range))) {
        $f = $line -split "`t", 2
        $items.Add([ordered]@{ hash = $f[0]; subject = $(if ($f.Count -gt 1) { $f[1] } else { '' }) })
    }
    return $items.ToArray()
}

function Get-GitDeckRecentTags([string]$Path, [string]$Since) {
    Assert-Registered $Path
    $after = [int64]0
    if (-not [int64]::TryParse(([string]$Since).Trim(), [ref]$after) -or $after -lt 0) { throw 'Since must be a Unix time in seconds.' }
    $tags = New-Object 'System.Collections.Generic.List[object]'
    foreach ($line in Get-GitDeckLines (Invoke-GitCapture $Path @('for-each-ref', '--sort=-creatordate', '--count=20', '--format=%(refname:short)%09%(creatordate:unix)%09%(creatordate:iso-strict)', 'refs/tags'))) {
        $f = $line -split "`t"
        $when = [int64]0; [void][int64]::TryParse($f[1], [ref]$when)
        if ($when -le $after) { break }
        $tags.Add([ordered]@{ name = $f[0]; date = $(if ($f.Count -gt 2) { $f[2] } else { '' }) })
    }
    return $tags.ToArray()
}
