# Git Deck branch switching with uncommitted changes, the way Git (and Sourcetree)
# does it: changes that do not touch files differing between the two commits come
# along; overlapping changes can be stashed, switched and restored. A conflict on
# restore keeps the stash so nothing is lost. Dot-sourced by git-dashboard-server.ps1.
# Windows PowerShell 5.1 compatible.

function Get-GitDeckSwitchPlan([string]$Path, [string]$TargetHash) {
    # mode: clean (nothing pending) | carry (git switch keeps the changes) |
    #       stash (changed files overlap the target, or an untracked file would be overwritten)
    $status = Invoke-GitCapture $Path @('-c', 'core.quotepath=off', 'status', '--porcelain=v1')
    if ($status.Code -ne 0) { throw $status.Output }
    $dirty = @(Get-GitDeckStatusPaths $status.Output)
    if (-not $dirty.Count) { return [ordered]@{ mode = 'clean'; dirty = @(); overlap = @(); blockingUntracked = @() } }
    $changed = @()
    $head = Invoke-GitCapture $Path @('rev-parse', '--verify', '--quiet', 'HEAD')
    if ($head.Code -eq 0) {
        # Two-dot: every path whose content differs between HEAD and the target is rewritten by the switch.
        $changed = @((Invoke-GitOrThrow $Path @('-c', 'core.quotepath=off', 'diff', '--name-only', 'HEAD', $TargetHash, '--')) -split "`r?`n" | Where-Object { $_ })
    } else {
        $changed = @((Invoke-GitOrThrow $Path @('-c', 'core.quotepath=off', 'ls-tree', '-r', '--name-only', $TargetHash)) -split "`r?`n" | Where-Object { $_ })
    }
    $changedSet = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $changed) { [void]$changedSet.Add($file) }
    $overlap = @($dirty | Where-Object { -not $_.untracked -and $changedSet.Contains($_.path) } | ForEach-Object { $_.path })
    # Untracked entries may be folders ("output/"): blocking when the target has a file inside them.
    $blocking = @($dirty | Where-Object { $_.untracked } | Where-Object {
        $entry = $_.path
        if ($entry.EndsWith('/')) { @($changed | Where-Object { $_.StartsWith($entry, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0 } else { $changedSet.Contains($entry) }
    } | ForEach-Object { $_.path })
    $mode = if ($overlap.Count -or $blocking.Count) { 'stash' } else { 'carry' }
    return [ordered]@{ mode = $mode; dirty = @($dirty | ForEach-Object { $_.path }); overlap = $overlap; blockingUntracked = $blocking }
}

function Invoke-GitDeckStashRestore([string]$Path, [string]$Mode, [string]$StashRef) {
    # Mode: pop | apply. Works on a dirty tree: git refuses (changing nothing) when a
    # local change would be overwritten; a content conflict is reported and, for pop,
    # the stash is kept.
    if ($Mode -notin @('pop', 'apply')) { throw 'Invalid stash mode.' }
    if ((Get-GitOperationState $Path).active) { throw 'Finish or abort the merge, rebase or cherry-pick in progress first.' }
    $result = Invoke-GitCapture $Path @('stash', $Mode, $StashRef)
    if ($result.Code -eq 0) {
        $what = if ($Mode -eq 'pop') { 'applied and removed from the stash list' } else { 'applied and kept in the stash list' }
        return @{ message = "$StashRef $what."; output = $result.Output; conflicts = @(); stashKept = ($Mode -eq 'apply') }
    }
    $conflicts = @((Get-GitOperationState $Path).conflicts)
    if ($conflicts.Count) {
        return @{ message = "$StashRef was applied with conflicts in $($conflicts.Count) file(s). Resolve them in File Status or Conflict Center; the stash was kept."; output = $result.Output; conflicts = $conflicts; stashKept = $true }
    }
    throw "$($result.Output)`nNothing was changed. Commit or stash the files listed above first."
}

function Invoke-GitDeckSwitch([string]$Path, [string[]]$SwitchArguments, [string]$LocalChanges, [string]$Label) {
    # LocalChanges: '' (require a clean tree, the old behaviour), 'carry' or 'stash'.
    if ((Get-GitOperationState $Path).active) { throw 'Finish or abort the merge, rebase or cherry-pick in progress before switching.' }
    $status = Invoke-GitCapture $Path @('status', '--porcelain')
    if ($status.Code -ne 0) { throw $status.Output }
    $dirty = @(Get-GitDeckVisibleStatusLines $status.Output).Count -gt 0
    if ($dirty -and $LocalChanges -notin @('carry', 'stash')) { throw 'Commit or stash changes before switching.' }
    if (-not $dirty -or $LocalChanges -eq 'carry') {
        # git refuses (and changes nothing) if a local change would be overwritten.
        $result = Invoke-GitCapture $Path (@('switch') + $SwitchArguments)
        if ($result.Code -ne 0) {
            $hint = if ($dirty) { "`nChoose 'Stash, switch and restore' to bring the changes along." } else { '' }
            throw "$($result.Output)$hint"
        }
        $carried = if ($dirty) { ' Your uncommitted changes came along.' } else { '' }
        return @{ message = "Switched to $Label.$carried"; output = $result.Output; conflicts = @(); stashKept = $false }
    }
    $stashMessage = "gitdeck: switch to $Label"
    $stash = Invoke-GitCapture $Path @('stash', 'push', '--include-untracked', '-m', $stashMessage)
    if ($stash.Code -ne 0) { throw "Could not stash local changes. Nothing was switched.`n$($stash.Output)" }
    $result = Invoke-GitCapture $Path (@('switch') + $SwitchArguments)
    if ($result.Code -ne 0) {
        $restore = Invoke-GitCapture $Path @('stash', 'pop')
        $note = if ($restore.Code -eq 0) { 'Your changes were restored.' } else { "Your changes are kept in the stash ($stashMessage)." }
        throw "Switch failed. $note`n$($result.Output)"
    }
    $pop = Invoke-GitCapture $Path @('stash', 'pop')
    if ($pop.Code -eq 0) {
        return @{ message = "Switched to $Label. Your changes were stashed and restored."; output = "$($result.Output)`n$($pop.Output)".Trim(); conflicts = @(); stashKept = $false }
    }
    $conflicts = @((Get-GitOperationState $Path).conflicts)
    if ($conflicts.Count) {
        return @{ message = "Switched to $Label, but restoring your changes conflicted in $($conflicts.Count) file(s). Resolve them in File Status; a copy stays in the stash."; output = $pop.Output; conflicts = $conflicts; stashKept = $true }
    }
    return @{ message = "Switched to $Label, but Git could not restore your changes automatically. They are safe in the stash ($stashMessage)."; output = $pop.Output; conflicts = @(); stashKept = $true }
}
