# Git Deck insight helpers (read-only):
# - Conflict forecast: merge a branch into its bases and into teammates' recent branches in memory
#   (git merge-tree --write-tree, Git 2.38+), without touching the working tree or any ref.
# - History search: which commits added or removed a text (git log -S) or changed lines matching a
#   pattern (git log -G), across all branches.
# - Lessons: notes from a folder you choose (for example a shared AI brain's knowledge\notes) that
#   mention the repository, the files or the words you are working on.
# Dot-sourced by git-dashboard-server.ps1. Windows PowerShell 5.1 compatible.

function Test-GitDeckRefName([string]$Ref) {
    return ($Ref -and $Ref.Length -le 200 -and -not $Ref.StartsWith('-') -and $Ref -match '^[A-Za-z0-9._/@+-]+$')
}

# One in-memory merge: clean or the conflicted files, each with who last changed it on the other side.
function Get-GitDeckMergeTrial([string]$Path, [string]$Into, [string]$Branch) {
    $trial = Invoke-GitCapture $Path @('merge-tree', '--write-tree', '--name-only', '--no-messages', $Into, $Branch)
    if ($trial.Code -gt 1) { return [ordered]@{ base = $Into; found = $false; error = (([string]$trial.Output) -split "`r?`n")[0] } }
    $lines = @(([string]$trial.Output) -split "`r?`n" | ForEach-Object { $_.Trim() })
    $files = New-Object 'System.Collections.Generic.List[object]'
    if ($trial.Code -eq 1) {
        $mergeBase = ([string](Invoke-GitCapture $Path @('merge-base', $Into, $Branch)).Output).Trim()
        foreach ($file in @($lines | Select-Object -Skip 1 | Where-Object { $_ } | Select-Object -Unique -First 20)) {
            $range = if ($mergeBase) { "$mergeBase..$Into" } else { $Into }
            $last = ([string](Invoke-GitCapture $Path @('log', '-1', '--format=%an%x09%cI%x09%h%x09%s', $range, '--', $file)).Output).Trim()
            $f = $last -split "`t", 4
            $files.Add([ordered]@{ file = $file; author = $(if ($last) { $f[0] } else { '' }); date = $(if ($f.Count -gt 1) { $f[1] } else { '' }); commit = $(if ($f.Count -gt 2) { $f[2] } else { '' }); subject = $(if ($f.Count -gt 3) { $f[3] } else { '' }) })
        }
    }
    $counts = ([string](Invoke-GitCapture $Path @('rev-list', '--left-right', '--count', "$Into...$Branch")).Output).Trim() -split '\s+'
    return [ordered]@{ base = $Into; found = $true; clean = ($trial.Code -eq 0); files = $files.ToArray(); behind = $(if ($counts.Count -ge 2) { [int]$counts[0] } else { 0 }); ahead = $(if ($counts.Count -ge 2) { [int]$counts[1] } else { 0 }) }
}

function Get-GitDeckMergeForecast([string]$Path, [string]$Branch, [string]$Bases, [bool]$Others) {
    Assert-Registered $Path
    $Branch = ([string]$Branch).Trim()
    if (-not $Branch) { $Branch = ([string](Invoke-GitCapture $Path @('rev-parse', '--abbrev-ref', 'HEAD')).Output).Trim() }
    if (-not (Test-GitDeckRefName $Branch) -or $Branch -eq 'HEAD') { return [ordered]@{ branch = $Branch; supported = $true; results = @(); others = @(); note = 'detached' } }
    $version = ([string](Invoke-GitCapture $Path @('version')).Output)
    if ($version -match 'version (\d+)\.(\d+)' -and ([int]$Matches[1] -lt 2 -or ([int]$Matches[1] -eq 2 -and [int]$Matches[2] -lt 38))) { return [ordered]@{ branch = $Branch; supported = $false; results = @(); others = @() } }
    $candidates = New-Object 'System.Collections.Generic.List[string]'
    foreach ($item in @(([string]$Bases) -split '\|' | ForEach-Object { $_.Trim() } | Where-Object { $_ })) { if ((Test-GitDeckRefName $item) -and -not $candidates.Contains($item)) { $candidates.Add($item) } }
    if (-not $candidates.Count) {
        $mainline = Get-GitDeckMainline $Path
        foreach ($item in @($mainline, 'origin/develop', 'origin/development')) { if ($item -and -not $candidates.Contains($item)) { $candidates.Add($item) } }
    }
    $results = New-Object 'System.Collections.Generic.List[object]'
    foreach ($base in @($candidates | Select-Object -First 6)) {
        if ((Invoke-GitCapture $Path @('rev-parse', '--verify', '--quiet', "$base^{commit}")).Code -ne 0) { continue }
        if ((Invoke-GitCapture $Path @('rev-parse', $base)).Output -eq (Invoke-GitCapture $Path @('rev-parse', $Branch)).Output) { continue }
        $results.Add((Get-GitDeckMergeTrial $Path $base $Branch))
    }
    # Teammates: remote branches updated in the last 14 days that touch the same files as this branch.
    $teammates = New-Object 'System.Collections.Generic.List[object]'
    if ($Others) {
        $mainline = Get-GitDeckMainline $Path
        $mine = @{}
        if ($mainline) { foreach ($file in @(([string](Invoke-GitCapture $Path @('diff', '--name-only', "$mainline...$Branch")).Output) -split "`r?`n" | Where-Object { $_ })) { $mine[$file] = $true } }
        $upstream = ([string](Invoke-GitCapture $Path @('rev-parse', '--abbrev-ref', "$Branch@{upstream}")).Output).Trim()
        $cutoff = [DateTimeOffset]::Now.AddDays(-14).ToUnixTimeSeconds()
        if ($mine.Count) {
            foreach ($line in @(([string](Invoke-GitCapture $Path @('for-each-ref', '--sort=-committerdate', '--count=60', '--format=%(refname:short)%09%(committerdate:unix)%09%(authorname)', 'refs/remotes/origin')).Output) -split "`r?`n" | Where-Object { $_ })) {
                if ($teammates.Count -ge 25) { break }
                $f = $line -split "`t", 3
                $ref = $f[0]; $when = 0; [void][int64]::TryParse($f[1], [ref]$when)
                if ($when -lt $cutoff) { break }
                if ($ref -in @('origin/HEAD', 'origin', $mainline, $upstream) -or $candidates.Contains($ref) -or -not (Test-GitDeckRefName $ref)) { continue }
                $touched = @(([string](Invoke-GitCapture $Path @('diff', '--name-only', "$mainline...$ref")).Output) -split "`r?`n" | Where-Object { $_ -and $mine.ContainsKey($_) })
                if (-not $touched.Count) { continue }
                $trial = Get-GitDeckMergeTrial $Path $ref $Branch
                $teammates.Add([ordered]@{ branch = $ref; author = $(if ($f.Count -gt 2) { $f[2] } else { '' }); shared = @($touched | Select-Object -First 10); clean = $trial.clean; files = $trial.files })
            }
        }
    }
    return [ordered]@{ branch = $Branch; supported = $true; results = $results.ToArray(); others = $teammates.ToArray() }
}

function Search-GitDeckHistory([string]$Path, [string]$Term, [string]$Mode, [string]$Since, [int]$Limit = 30) {
    Assert-Registered $Path
    $Term = [string]$Term
    if (-not $Term.Trim() -or $Term.Length -gt 200 -or $Term -match '[\r\n]') { throw 'Use a text of 1 to 200 characters on one line.' }
    if ($Limit -lt 1 -or $Limit -gt 100) { $Limit = 30 }
    $arguments = New-Object 'System.Collections.Generic.List[string]'
    foreach ($item in @('log', '--all', "--max-count=$Limit", '--name-only', '--format=%x1e%H%x09%h%x09%an%x09%cI%x09%D%x09%s')) { $arguments.Add($item) }
    if ($Mode -eq 'G') { $arguments.Add("-G$Term") } else { $arguments.Add("-S$Term") }
    $Since = ([string]$Since).Trim()
    if ($Since) {
        $when = [DateTimeOffset]::MinValue
        if (-not [DateTimeOffset]::TryParse($Since, [ref]$when)) { throw 'Use a date, for example 2026-10-01.' }
        $arguments.Add("--since=$($when.ToString('yyyy-MM-ddTHH:mm:sszzz'))")
    }
    $result = Invoke-GitCapture $Path $arguments.ToArray()
    if ($result.Code -ne 0) { throw ((([string]$result.Output) -split "`r?`n")[0]) }
    $commits = New-Object 'System.Collections.Generic.List[object]'
    foreach ($block in @(([string]$result.Output) -split [char]0x1e | Where-Object { $_.Trim() })) {
        $lines = @($block -split "`r?`n")
        $f = $lines[0] -split "`t", 6
        if ($f.Count -lt 6) { continue }
        $commits.Add([ordered]@{ commit = $f[0]; short = $f[1]; author = $f[2]; date = $f[3]; refs = $f[4]; subject = $f[5]; files = @($lines | Select-Object -Skip 1 | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -First 12) })
    }
    return [ordered]@{ term = $Term; mode = $(if ($Mode -eq 'G') { 'G' } else { 'S' }); commits = $commits.ToArray() }
}

function Get-GitDeckBrainFolder {
    if (-not (Test-Path -LiteralPath $script:PrefsFile -PathType Leaf)) { return '' }
    try { $prefs = Get-Content -Encoding UTF8 -LiteralPath $script:PrefsFile -Raw | ConvertFrom-Json } catch { return '' }
    $folder = ([string]$prefs.brainFolder).Trim()
    if (-not $folder -or -not [IO.Path]::IsPathRooted($folder) -or -not (Test-Path -LiteralPath $folder -PathType Container)) { return '' }
    return $folder
}

# Notes (*.md) in the chosen folder that mention any of the words; never lines that look like secrets.
function Get-GitDeckLessons([string]$Terms) {
    $folder = Get-GitDeckBrainFolder
    if (-not $folder) { return [ordered]@{ configured = $false; lessons = @() } }
    $words = @(([string]$Terms) -split '\|' | ForEach-Object { $_.Trim() } | Where-Object { $_.Length -ge 3 -and $_.Length -le 80 } | Select-Object -Unique -First 12)
    $secret = '(?i)(password|passwd|secret|token|api[_-]?key|private[_ -]?key|cookie|bearer)\s*[:=]|-----BEGIN'
    $lessons = New-Object 'System.Collections.Generic.List[object]'
    if (-not $words.Count) { return [ordered]@{ configured = $true; lessons = @() } }
    foreach ($file in @(Get-ChildItem -LiteralPath $folder -Filter '*.md' -File -ErrorAction SilentlyContinue | Where-Object { $_.Length -le 200KB } | Sort-Object LastWriteTime -Descending | Select-Object -First 500)) {
        $text = ''
        try { $text = [IO.File]::ReadAllText($file.FullName, [Text.Encoding]::UTF8) } catch { continue }
        $hits = @($words | Where-Object { $text.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
        if (-not $hits.Count) { continue }
        $title = $file.BaseName; $description = ''
        if ($text -match '(?m)^name:\s*(.+)$') { $title = $Matches[1].Trim() } elseif ($text -match '(?m)^#\s+(.+)$') { $title = $Matches[1].Trim() }
        if ($text -match '(?m)^description:\s*(.+)$') { $description = $Matches[1].Trim() }
        $snippets = New-Object 'System.Collections.Generic.List[string]'
        foreach ($line in ($text -split "`r?`n")) {
            if ($snippets.Count -ge 3) { break }
            $clean = $line.Trim()
            if (-not $clean -or $clean -match $secret -or $clean -match '^(name|description|type|metadata):') { continue }
            if (@($hits | Where-Object { $clean.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count) { $snippets.Add($(if ($clean.Length -gt 220) { $clean.Substring(0, 220) + '...' } else { $clean })) }
        }
        $lessons.Add([ordered]@{ file = $file.Name; title = $title; description = $(if ($description -match $secret) { '' } else { $description }); matched = $hits; snippets = $snippets.ToArray(); modified = $file.LastWriteTime.ToString('yyyy-MM-dd') })
    }
    $sorted = @($lessons | Sort-Object -Property @{ Expression = { $_.matched.Count }; Descending = $true }, @{ Expression = { $_.modified }; Descending = $true } | Select-Object -First 8)
    return [ordered]@{ configured = $true; folder = $folder; lessons = $sorted }
}

# Time machine: one repository at two moments on its main line (or a given ref): the commit and the
# newest tag at each moment, how many commits came in between and which files they changed.
function Get-GitDeckMoments([string]$Path, [string]$From, [string]$To, [string]$Ref) {
    Assert-Registered $Path
    $Ref = ([string]$Ref).Trim()
    if (-not $Ref) { $Ref = Get-GitDeckMainline $Path; if (-not $Ref) { $Ref = 'HEAD' } }
    if (-not (Test-GitDeckRefName $Ref)) { throw 'Branch or tag name is not valid.' }
    $at = {
        param([string]$When)
        $moment = [DateTimeOffset]::MinValue
        if (-not [DateTimeOffset]::TryParse(([string]$When).Trim(), [ref]$moment)) { throw 'Use a date and time, for example 2026-10-19T10:00.' }
        $line = ([string](Invoke-GitCapture $Path @('log', '-1', '--first-parent', "--before=$($moment.ToString('yyyy-MM-ddTHH:mm:sszzz'))", '--format=%H%x09%h%x09%cI%x09%an%x09%s', $Ref)).Output).Trim()
        if (-not $line) { return [ordered]@{ found = $false } }
        $f = $line -split "`t", 5
        $described = Invoke-GitCapture $Path @('describe', '--tags', '--abbrev=0', $f[0])
        $tag = if ($described.Code -eq 0) { ([string]$described.Output).Trim() } else { '' }
        return [ordered]@{ found = $true; commit = $f[0]; short = $f[1]; date = $f[2]; author = $f[3]; subject = $(if ($f.Count -gt 4) { $f[4] } else { '' }); tag = $tag }
    }
    $a = & $at $From; $b = & $at $To
    $count = 0; $files = @(); $authors = @()
    if ($a.found -and $b.found -and $a.commit -ne $b.commit) {
        [void][int]::TryParse(([string](Invoke-GitCapture $Path @('rev-list', '--count', "$($a.commit)..$($b.commit)")).Output).Trim(), [ref]$count)
        $files = @(([string](Invoke-GitCapture $Path @('diff', '--name-only', $a.commit, $b.commit)).Output) -split "`r?`n" | Where-Object { $_ } | Select-Object -First 40)
        $authors = @(([string](Invoke-GitCapture $Path @('log', '--format=%an', "$($a.commit)..$($b.commit)")).Output) -split "`r?`n" | Where-Object { $_ } | Select-Object -Unique -First 6)
    } elseif (-not $a.found -and $b.found) {
        [void][int]::TryParse(([string](Invoke-GitCapture $Path @('rev-list', '--count', $b.commit)).Output).Trim(), [ref]$count)
    }
    return [ordered]@{ ref = $Ref; from = $a; to = $b; commits = $count; files = $files; authors = $authors }
}
