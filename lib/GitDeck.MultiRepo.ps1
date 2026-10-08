# Git Deck multi-repository views: pending work, branch cleanup, search and branch lookup.
# Dot-sourced by git-dashboard-server.ps1 after GitDeck.Activity.ps1 (uses Get-GitDeckMainline).
# Read-only and local (no network); Windows PowerShell 5.1 compatible.

$script:ProtectedBranches = @('main', 'master', 'develop', 'dev', 'release', 'staging', 'production')

function Get-GitDeckLines($Result) {
    if ($Result.Code -ne 0) { return @() }
    return @(([string]$Result.Output) -split "`r?`n" | Where-Object { $_ })
}

# Everything still open in one repository: uncommitted files, unpushed commits, stashes,
# merged branches nobody deleted, and an unfinished merge/rebase.
function Get-GitDeckPendingWork([string]$Path) {
    Assert-Registered $Path
    # About seven Git commands for a tidy repository: Dashboard checks run this for every repository,
    # and on Windows each Git start costs ~50 ms, so lookups are combined where Git allows it.
    $status = @(Get-GitDeckLines (Invoke-GitCapture $Path @('status', '--porcelain=v1', '--branch')))
    $head = if ($status.Count -and $status[0].StartsWith('## ')) { $status[0].Substring(3) } else { '' }
    $files = @($status | Where-Object { -not $_.StartsWith('## ') })
    $conflicts = @($files | Where-Object { $_ -match '^(UU|AA|DD|AU|UA|DU|UD) ' }).Count
    $untracked = @($files | Where-Object { $_.StartsWith('?? ') }).Count
    # "## main...origin/main [ahead 1]", "## No commits yet on main", "## HEAD (no branch)".
    $branch = if ($head -match '^(?:No commits yet on|Initial commit on) (\S+)') { $Matches[1] } elseif ($head -match '^HEAD \(no branch\)') { '' } else { ($head -split '\.\.\.', 2)[0].Split(' ')[0] }
    $ahead = 0; $behind = 0; $upstream = ''
    if ($head -match '\.\.\.(\S+)') { $upstream = $Matches[1] }
    if ($head -match 'ahead (\d+)') { $ahead = [int]$Matches[1] }
    if ($head -match 'behind (\d+)') { $behind = [int]$Matches[1] }
    # Other local branches with commits that are on no remote.
    $unpushed = New-Object 'System.Collections.Generic.List[object]'
    $heads = @(Get-GitDeckLines (Invoke-GitCapture $Path @('for-each-ref', '--format=%(refname:short)%09%(upstream:short)%09%(upstream:track)%09%(objectname)', 'refs/heads')) | ForEach-Object { , ($_ -split "`t") })
    $loose = New-Object 'System.Collections.Generic.List[string]'
    $tips = @{}
    foreach ($f in $heads) {
        if ($f[0] -eq $branch) { continue }
        if ($f.Count -gt 1 -and $f[1]) {
            if ($f.Count -gt 2 -and $f[2] -match 'ahead (\d+)') { $unpushed.Add(@{ branch = $f[0]; commits = [int]$Matches[1]; upstream = $f[1] }) }
        } else { $loose.Add($f[0]); $tips[$f[0]] = $(if ($f.Count -gt 3) { $f[3] } else { '' }) }
    }
    # Branches without an upstream: one list of the commits no remote has, with their parents. A commit
    # is unpushed for a branch when it can be reached from the branch tip through unpushed commits.
    if ($loose.Count) {
        $parents = @{}
        foreach ($line in Get-GitDeckLines (Invoke-GitCapture $Path (@('rev-list', '--parents') + $loose.ToArray() + @('--not', '--remotes')))) { $ids = $line.Split(' '); $parents[$ids[0]] = $ids }
        if ($parents.Count) {
            foreach ($name in $loose) {
                $seen = New-Object 'System.Collections.Generic.HashSet[string]'
                $queue = New-Object 'System.Collections.Generic.Queue[string]'
                if ($parents.ContainsKey([string]$tips[$name])) { $queue.Enqueue([string]$tips[$name]) }
                while ($queue.Count) {
                    $id = $queue.Dequeue(); if (-not $seen.Add($id)) { continue }
                    $ids = $parents[$id]; for ($i = 1; $i -lt $ids.Count; $i++) { if ($parents.ContainsKey($ids[$i])) { $queue.Enqueue($ids[$i]) } }
                }
                if ($seen.Count) { $unpushed.Add(@{ branch = $name; commits = $seen.Count; upstream = '' }) }
            }
        }
    }
    # Mainline (as Get-GitDeckMainline decides it) and whether a stash exists, in one lookup.
    $refs = @{}
    foreach ($line in Get-GitDeckLines (Invoke-GitCapture $Path @('for-each-ref', '--format=%(refname)%09%(symref:short)', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/heads/main', 'refs/heads/master', 'refs/stash'))) {
        $f = $line -split "`t", 2; $refs[$f[0]] = $(if ($f.Count -gt 1) { $f[1] } else { '' })
    }
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
    # Unfinished merge, rebase, cherry-pick or revert: marker files in the Git folder.
    $operation = ''
    $gitDir = ([string](Invoke-GitCapture $Path @('rev-parse', '--absolute-git-dir')).Output).Trim()
    if ($gitDir -and (Test-Path -LiteralPath $gitDir -PathType Container)) {
        if (Test-Path -LiteralPath (Join-Path $gitDir 'MERGE_HEAD')) { $operation = 'merge' }
        elseif ((Test-Path -LiteralPath (Join-Path $gitDir 'rebase-merge')) -or (Test-Path -LiteralPath (Join-Path $gitDir 'rebase-apply'))) { $operation = 'rebase' }
        elseif (Test-Path -LiteralPath (Join-Path $gitDir 'CHERRY_PICK_HEAD')) { $operation = 'cherry-pick' }
        elseif (Test-Path -LiteralPath (Join-Path $gitDir 'REVERT_HEAD')) { $operation = 'revert' }
    }
    $tag = Get-GitDeckLatestTag $Path
    # When the current branch last changed, and with what.
    $last = ([string](Invoke-GitCapture $Path @('log', '-1', '--format=%cI%x09%s')).Output).Trim() -split "`t", 2
    return [ordered]@{
        branch = $branch; upstream = $upstream; ahead = $ahead; behind = $behind
        changed = $files.Count - $untracked; untracked = $untracked; conflicts = $conflicts
        operation = $operation
        unpushedBranches = $unpushed.ToArray(); stashes = @($stashes); mergedBranches = $merged; mainline = $mainline
        latestTag = $tag.name; latestTagDate = $tag.date; commitsSinceTag = $tag.since; tagCount = $tag.count
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
