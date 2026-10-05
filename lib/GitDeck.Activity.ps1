# Git Deck activity report: what was committed in a repository during a date range.
# Dot-sourced by git-dashboard-server.ps1. Read-only; Windows PowerShell 5.1 compatible.

function Get-GitDeckActivity([string]$Path, [string]$Since, [string]$Until, [string]$Authors, [bool]$Merges) {
    Assert-Registered $Path
    if ($Since -notmatch '^\d{4}-\d{2}-\d{2}$' -or $Until -notmatch '^\d{4}-\d{2}-\d{2}$') { throw 'Dates must look like 2026-09-30.' }
    $arguments = @('log', '--all', '--source', '--numstat', '--date-order', '--max-count=5000',
        "--since=$Since 00:00:00", "--until=$Until 23:59:59", '--regexp-ignore-case', '--fixed-strings',
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
    return @(ConvertFrom-GitDeckActivityLog $result.Output)
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
            $current = [ordered]@{ hash = $f[1]; author = $f[2]; email = $f[3]; date = $f[4]; ref = $ref; subject = $f[6]; files = 0; added = 0; deleted = 0 }
        } elseif ($current -and $line -match '^(\d+|-)\t(\d+|-)\t') {
            $current.files++
            if ($Matches[1] -ne '-') { $current.added += [int]$Matches[1] }
            if ($Matches[2] -ne '-') { $current.deleted += [int]$Matches[2] }
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
