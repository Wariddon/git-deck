# Git Deck pull with local changes: preview which uncommitted files overlap
# incoming commits, then pull with git's --autostash so local work is stashed
# and restored automatically. Dot-sourced by git-dashboard-server.ps1.
# Windows PowerShell 5.1 compatible.

function Get-GitDeckStatusPaths([string]$Text) {
    # porcelain v1 lines: "XY path" or "XY old -> new"; returns @{path;untracked}.
    foreach ($line in @(Get-GitDeckVisibleStatusLines $Text)) {
        if ($line.Length -lt 4) { continue }
        $file = $line.Substring(3)
        if ($file.Contains(' -> ')) { $file = $file.Substring($file.LastIndexOf(' -> ') + 4) }
        [pscustomobject]@{ path = $file.Trim('"'); untracked = $line.StartsWith('??') }
    }
}

function Resolve-GitDeckPullTarget([string]$Path, [string]$Remote, [string]$Branch) {
    # Returns the remote-tracking ref a pull would merge, or '' when unknown.
    if ($Remote -or $Branch) {
        Assert-RemoteName $Path $Remote; Assert-BranchName $Path $Branch
        return "$Remote/$Branch"
    }
    $upstream = Invoke-GitCapture $Path @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
    if ($upstream.Code -ne 0) { return '' }
    return $upstream.Output.Trim()
}

function Get-GitDeckPullPreview([string]$Path, [string]$Remote = '', [string]$Branch = '') {
    Assert-Registered $Path
    $status = Invoke-GitCapture $Path @('-c', 'core.quotepath=off', 'status', '--porcelain=v1')
    if ($status.Code -ne 0) { throw $status.Output }
    $dirty = @(Get-GitDeckStatusPaths $status.Output)
    $target = Resolve-GitDeckPullTarget $Path $Remote $Branch
    $known = $false; $behind = 0; $incoming = @()
    if ($target -and (Invoke-GitCapture $Path @('rev-parse', '--verify', '--quiet', "refs/remotes/$target^{commit}")).Code -eq 0) {
        $known = $true
        $behind = [int](Invoke-GitOrThrow $Path @('rev-list', '--count', "HEAD..refs/remotes/$target")).Trim()
        # Three-dot diff: only what changed upstream since the common ancestor.
        $incoming = @((Invoke-GitOrThrow $Path @('-c', 'core.quotepath=off', 'diff', '--name-only', "HEAD...refs/remotes/$target")) -split "`r?`n" | Where-Object { $_ })
    }
    $incomingSet = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $incoming) { [void]$incomingSet.Add($file) }
    $overlap = @($dirty | Where-Object { -not $_.untracked -and $incomingSet.Contains($_.path) } | ForEach-Object { $_.path })
    # git does not autostash untracked files, so an incoming file with the same name stops the pull.
    $blocking = @($dirty | Where-Object { $_.untracked -and $incomingSet.Contains($_.path) } | ForEach-Object { $_.path })
    return [ordered]@{
        target = $target; knownTarget = $known; behind = $behind
        dirty = @($dirty | ForEach-Object { $_.path }); incomingCount = $incoming.Count
        overlap = $overlap; blockingUntracked = $blocking
    }
}

function Invoke-GitDeckPull([string]$Path, [string]$Strategy, [bool]$Autostash, [string]$Remote = '', [string]$Branch = '') {
    if (-not $Strategy) { $Strategy = 'ff-only' }
    if ($Strategy -notin @('ff-only', 'rebase', 'merge')) { throw 'Invalid pull strategy.' }
    $flag = @{ 'ff-only' = '--ff-only'; 'rebase' = '--rebase'; 'merge' = '--no-rebase' }[$Strategy]
    $status = Invoke-GitCapture $Path @('status', '--porcelain')
    if ($status.Code -ne 0) { throw $status.Output }
    $dirty = @(Get-GitDeckVisibleStatusLines $status.Output).Count -gt 0
    if ($dirty -and -not $Autostash) { throw 'Commit or stash changes before pulling, or allow Git Deck to stash and restore them.' }
    $arguments = @('pull', $flag)
    if ($dirty) { $arguments += '--autostash' }
    if ($Remote -or $Branch) { Assert-RemoteName $Path $Remote; Assert-BranchName $Path $Branch; $arguments += @($Remote, $Branch) }
    $label = if ($Remote) { "$Remote/$Branch into the current branch" } else { 'the upstream branch' }
    $result = Invoke-GitCapture $Path $arguments
    if ($result.Code -ne 0) {
        if ((Get-GitOperationState $Path).active) { throw "Pull paused for conflicts. Resolve them in Safety Center.`n$($result.Output)" }
        throw $(if ($result.Output) { $result.Output } else { 'Git pull failed.' })
    }
    $output = if ($result.Output) { $result.Output } else { 'Already up to date.' }
    $conflicts = @((Invoke-GitCapture $Path @('-c', 'core.quotepath=off', 'diff', '--name-only', '--diff-filter=U')).Output -split "`r?`n" | Where-Object { $_ })
    if ($dirty -and $conflicts.Count) {
        return @{
            # Keep the key facts inside the 180-character feedback card.
            message = "Pull done, but restoring your local changes conflicted in $($conflicts.Count) file(s). Resolve them in File Status; a copy is kept in the stash (autostash)."
            output = $output; conflicts = $conflicts; stashKept = $true
        }
    }
    $restored = if ($dirty) { ' Local changes were stashed and restored.' } else { '' }
    return @{ message = "Pulled $label using $Strategy.$restored"; output = $output; conflicts = @(); stashKept = $false }
}

function Get-GitDeckLastFetchAt([string]$Path) {
    # FETCH_HEAD is rewritten by every fetch/pull, so its time is the last contact with a remote.
    $gitPath = Invoke-GitCapture $Path @('rev-parse', '--git-path', 'FETCH_HEAD')
    if ($gitPath.Code -ne 0 -or -not $gitPath.Output) { return $null }
    $file = $gitPath.Output.Trim()
    if (-not [IO.Path]::IsPathRooted($file)) { $file = Join-Path $Path $file }
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $null }
    return (Get-Item -LiteralPath $file).LastWriteTimeUtc.ToString('o')
}
