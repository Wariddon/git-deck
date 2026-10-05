# Git Deck activity report: what was committed in a repository during a date range.
# Dot-sourced by git-dashboard-server.ps1. Read-only; Windows PowerShell 5.1 compatible.

function Get-GitDeckActivity([string]$Path, [string]$Since, [string]$Until, [string]$Authors, [bool]$Merges) {
    Assert-Registered $Path
    if ($Since -notmatch '^\d{4}-\d{2}-\d{2}$' -or $Until -notmatch '^\d{4}-\d{2}-\d{2}$') { throw 'Dates must look like 2026-09-30.' }
    $window = @("--since=$Since 00:00:00", "--until=$Until 23:59:59")
    $arguments = @('log', '--exclude=refs/stash', '--all', '--source', '--numstat', '--date-order', '--max-count=5000') + $window + @('--regexp-ignore-case', '--fixed-strings',
        '--pretty=format:@@%x1f%H%x1f%an%x1f%ae%x1f%aI%x1f%S%x1f%s')
    if (-not $Merges) { $arguments += '--no-merges' }
    foreach ($author in @(([string]$Authors) -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -First 10)) {
        if ($author.Length -gt 100 -or $author.StartsWith('-')) { throw 'Author filter is not valid.' }
        $arguments += "--author=$author"
    }
    $result = Invoke-GitCapture $Path $arguments
    if ($result.Code -ne 0) {
        # A repository without commits is simply quiet, not an error.
        if ($result.Output -match 'does not have any commits|unknown revision|bad default revision') { return @() }
        throw $result.Output
    }
    $commits = @(ConvertFrom-GitDeckActivityLog $result.Output)
    if (-not $commits.Count) { return @() }
    # Status for a handover: is each commit on a remote yet, and is it in the main line?
    $pushed = $null
    if (([string](Invoke-GitCapture $Path @('remote')).Output).Trim()) { $pushed = Get-GitDeckHashSet $Path (@('log', '--remotes', '--format=%H', '--max-count=20000') + $window) }
    $mainline = Get-GitDeckMainline $Path
    $merged = if ($mainline) { Get-GitDeckHashSet $Path (@('log', $mainline, '--format=%H', '--max-count=20000') + $window) } else { $null }
    foreach ($commit in $commits) {
        $commit | Add-Member -NotePropertyName pushed -NotePropertyValue $(if ($null -eq $pushed) { $null } else { $pushed.Contains($commit.hash) })
        $commit | Add-Member -NotePropertyName merged -NotePropertyValue $(if ($null -eq $merged) { $null } else { $merged.Contains($commit.hash) })
    }
    return $commits
}

function Get-GitDeckHashSet([string]$Path, [string[]]$Arguments) {
    $set = New-Object 'System.Collections.Generic.HashSet[string]'
    $result = Invoke-GitCapture $Path $Arguments
    if ($result.Code -eq 0) { foreach ($line in (([string]$result.Output) -split "`r?`n")) { if ($line -match '^[0-9a-f]{40}$') { [void]$set.Add($line) } } }
    return , $set
}

# The branch finished work lands on: origin/HEAD, else origin/main, origin/master, main, master.
function Get-GitDeckMainline([string]$Path) {
    $head = Invoke-GitCapture $Path @('symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD')
    if ($head.Code -eq 0 -and ([string]$head.Output).Trim()) { return ([string]$head.Output).Trim() }
    foreach ($ref in @('origin/main', 'origin/master', 'main', 'master')) {
        if ((Invoke-GitCapture $Path @('rev-parse', '--verify', '--quiet', "$ref^{commit}")).Code -eq 0) { return $ref }
    }
    return ''
}

function ConvertFrom-GitDeckActivityLog([string]$Text) {
    $commits = New-Object 'System.Collections.Generic.List[object]'
    $current = $null
    foreach ($line in ($Text -split "`r?`n")) {
        if ($line.StartsWith("@@$([char]31)")) {
            if ($current) { $commits.Add([pscustomobject]$current) }
            $f = $line -split [char]31, 7
            if ($f.Count -lt 7) { $current = $null; continue }
            $ref = $f[5] -replace '^refs/(heads|remotes|tags)/', ''
            $current = [ordered]@{ hash = $f[1]; author = $f[2]; email = $f[3]; date = $f[4]; ref = $ref; subject = $f[6]; files = 0; added = 0; deleted = 0; paths = @() }
        } elseif ($current -and $line -match '^(\d+|-)\t(\d+|-)\t(.+)$') {
            $current.files++
            if ($Matches[1] -ne '-') { $current.added += [int]$Matches[1] }
            if ($Matches[2] -ne '-') { $current.deleted += [int]$Matches[2] }
            if ($current.paths.Count -lt 100) { $current.paths += $Matches[3] }
        }
    }
    if ($current) { $commits.Add([pscustomobject]$current) }
    return $commits.ToArray()
}

function Get-GitDeckIdentity {
    $name = (& git config --global user.name 2>$null | Out-String).Trim()
    $email = (& git config --global user.email 2>$null | Out-String).Trim()
    return @{ name = $name; email = $email }
}

# AI draft of a work report. The report text is built by the UI from commit subjects only (no code),
# and every repository in it must allow AI with the configured provider.
function Get-GitDeckAiWorkSummary($Paths, [string]$Report) {
    $Report = ([string]$Report).Trim()
    if (-not $Report) { throw 'There is nothing to summarize.' }
    $settings = Get-AiSettings
    foreach ($path in @($Paths | ForEach-Object { [string]$_ } | Where-Object { $_ } | Select-Object -First 200)) {
        Assert-Registered $path
        $policy = Get-GitDeckAiPolicy $path
        $name = Split-Path -Leaf $path
        if ($policy -eq 'off') { throw "AI is turned off for $name. Leave it out of the report (Folder or Author filter) or change its AI setting." }
        if ($policy -eq 'local' -and $settings.provider -ne 'ollama') { throw "$name only allows a local AI model. Leave it out of the report or use Ollama." }
    }
    $note = ''; $Report = Limit-GitDeckAiText $Report 60000 ([ref]$note)
    $instructions = 'You turn a Git work log into a short progress report for a manager or client. Use Markdown: a one-paragraph overview, then one "###" section per repository (or per ticket when ticket keys are present) with bullets describing what was done in plain language, merging related commits. Mention what is not yet pushed or merged when the log says so. Do not invent work that is not in the log.'
    return [ordered]@{ summary = (Invoke-GitDeckAi '' $instructions "<work-log>`n$Report`n</work-log>"); note = $note }
}
