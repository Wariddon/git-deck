# Undo timeline (web/timeline.js): every journaled action in every repository, newest first, with
# whether it can still be undone exactly (the repository is still right after it) or only by going
# back to before it (later commits on the branch are then kept in a backup ref). Going back is itself
# journaled, so it can be undone too. Windows PowerShell 5.1 compatible.

function Get-GitDeckTimeline([int]$Limit = 200) {
    $entries = @(Get-ActionJournal | Select-Object -First ([Math]::Max(1, [Math]::Min(200, $Limit))))
    $registered = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($path in @(Get-Repositories)) { [void]$registered.Add($path) }
    $state = @{}
    $latest = @{}
    $items = New-Object 'System.Collections.Generic.List[object]'
    foreach ($entry in $entries) {
        $path = [string]$entry.path
        if (-not $state.ContainsKey($path)) {
            $now = $null
            if ($registered.Contains($path) -and (Test-Path -LiteralPath $path -PathType Container)) {
                $info = Invoke-GitCapture $path @('rev-parse', 'HEAD', '--abbrev-ref', 'HEAD')
                $lines = @(([string]$info.Output) -split "`r?`n" | Where-Object { $_ })
                if ($info.Code -eq 0 -and $lines.Count -ge 2) { $now = [ordered]@{ head = $lines[0].Trim(); branch = $(if ($lines[1].Trim() -eq 'HEAD') { '' } else { $lines[1].Trim() }) } }
            }
            $state[$path] = $now
        }
        $now = $state[$path]
        $status = if (-not $now) { 'missing' }
            elseif (-not $latest.ContainsKey($path) -and $now.head -eq [string]$entry.afterHead -and $now.branch -eq [string]$entry.afterBranch) { 'latest' }
            elseif (-not $latest.ContainsKey($path) -and $now.head -eq [string]$entry.beforeHead -and $now.branch -eq [string]$entry.beforeBranch) { 'undone' }
            elseif ($now.branch -and $now.branch -eq [string]$entry.beforeBranch -and [string]$entry.beforeHead) { 'moved' }
            else { 'other-branch' }
        $latest[$path] = $true
        $items.Add([ordered]@{
            id = [string]$entry.id; path = $path; repository = [string]$entry.repository; action = [string]$entry.action; createdAt = [string]$entry.createdAt
            summary = [string]$entry.summary; beforeHead = [string]$entry.beforeHead; afterHead = [string]$entry.afterHead
            beforeBranch = [string]$entry.beforeBranch; afterBranch = [string]$entry.afterBranch; status = $status
            currentBranch = $(if ($now) { $now.branch } else { '' })
        })
    }
    return $items.ToArray()
}

# Undo one timeline entry: exactly (journal-restore-head) when the repository is still right after it;
# otherwise move the same branch back to before it with `reset --keep`, keeping the newer commits in
# refs/gitdeck/backup/<time> and refusing if local changes would be lost.
function Invoke-GitDeckTimelineRestore([string]$Path, [string]$Id) {
    Assert-Registered $Path
    $entry = Get-ActionJournalEntry $Path $Id
    $now = Get-GitSnapshot $Path
    if ($now.head -eq [string]$entry.afterHead -and $now.branch -eq [string]$entry.afterBranch) {
        return Invoke-UndoLast $Path $Id
    }
    if (-not $now.branch -or $now.branch -ne [string]$entry.beforeBranch) { throw "Switch to $($entry.beforeBranch) first: going back only moves the branch the action was made on." }
    if ([string]$entry.beforeHead -notmatch '^[0-9a-f]{40}$') { throw 'This action has no earlier commit to go back to.' }
    if ((Invoke-GitCapture $Path @('cat-file', '-e', "$($entry.beforeHead)^{commit}")).Code -ne 0) { throw 'The commit before this action no longer exists.' }
    $backup = 'refs/gitdeck/backup/' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss-fff')
    [void](Invoke-GitOrThrow $Path @('update-ref', '-m', "Git Deck timeline backup before going back past $($entry.action)", $backup, $now.head))
    $reset = Invoke-GitCapture $Path @('reset', '--keep', [string]$entry.beforeHead)
    if ($reset.Code -ne 0) {
        [void](Invoke-GitCapture $Path @('update-ref', '-d', $backup))
        throw ('Local changes would be lost; commit or stash them first. ' + ([string]$reset.Output).Split("`n")[0])
    }
    return @{ message = "$($now.branch) is back to before $($entry.action) ($($entry.createdAt)). The newer commits are kept in $backup."; output = "$($now.head.Substring(0, 8)) -> $(([string]$entry.beforeHead).Substring(0, 8))" }
}
