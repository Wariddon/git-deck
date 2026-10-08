[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F-]{36}$')][string]$JobId,
    [Parameter(Mandatory=$true)][string]$JobsRoot
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$jobsPath = [IO.Path]::GetFullPath($JobsRoot).TrimEnd('\')
$specPath = Join-Path $jobsPath ($JobId + '.spec.json')
$statusPath = Join-Path $jobsPath ($JobId + '.status.json')
$cancelPath = Join-Path $jobsPath ($JobId + '.cancel')
$utf8 = New-Object Text.UTF8Encoding($false)

function Write-JobStatus([string]$State,[int]$Progress,[string]$Message,[string]$Output='',[hashtable]$Result=$null) {
    $payload = [ordered]@{
        id = $JobId
        action = [string]$script:Spec.action
        path = [string]$script:Spec.path
        state = $State
        progress = [Math]::Max(0,[Math]::Min(100,$Progress))
        message = $Message
        output = $(if ($Output.Length -gt 200000) { $Output.Substring($Output.Length-200000) } else { $Output })
        result = $Result
        pid = $PID
        startedAt = $script:StartedAt
        updatedAt = [DateTime]::UtcNow.ToString('o')
        finishedAt = $(if ($State -in @('completed','failed','cancelled')) { [DateTime]::UtcNow.ToString('o') } else { $null })
    }
    $json = $payload | ConvertTo-Json -Depth 8 -Compress
    $tempPath = Join-Path $jobsPath ($JobId + '.' + $PID + '.tmp')
    [IO.File]::WriteAllText($tempPath,$json,$utf8)
    # The server may be reading the status file at this moment; try again shortly instead of failing the job.
    for ($attempt = 1; ; $attempt++) {
        try { Move-Item -LiteralPath $tempPath -Destination $statusPath -Force -ErrorAction Stop; break }
        catch {
            if ($attempt -ge 20) { if ($State -eq 'running') { Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue; return }; throw }
            Start-Sleep -Milliseconds 50
        }
    }
}

function Assert-NotCancelled {
    if (Test-Path -LiteralPath $cancelPath -PathType Leaf) { throw [OperationCanceledException]::new('Job cancelled by user.') }
}

function Invoke-Git([string]$WorkingPath,[string[]]$Arguments) {
    Assert-NotCancelled
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $items = if ($WorkingPath) { @(& git -c core.quotepath=false -C $WorkingPath @Arguments 2>&1) } else { @(& git -c core.quotepath=false @Arguments 2>&1) }
        $code = $LASTEXITCODE
        $text = ($items | ForEach-Object { if ($_ -is [Management.Automation.ErrorRecord]) { $_.Exception.Message } else { [string]$_ } } | Out-String).TrimEnd()
    } finally { $ErrorActionPreference = $previousPreference }
    return @{ Code=$code; Output=$text }
}

function Test-GitDeckProtectedStatusLine([string]$Line) {
    if (-not $Line -or -not $Line.StartsWith('? ')) { return $false }
    $path = $Line.Substring(2).Trim('"') -replace '\\','/'
    return ($path -match '(^|/)\.idea(?:/|$)' -or $path -match '(?i)\.iml$')
}

function Test-GitRepo([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return $false }
    & git -C $Path rev-parse --is-inside-work-tree *> $null
    return ($LASTEXITCODE -eq 0)
}

function Add-SavedRepository([string]$Path,[string]$RepoList) {
    $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path.TrimEnd('\')
    $mutex = New-Object Threading.Mutex($false,'Local\GitDeckRepoList')
    try {
        if (-not $mutex.WaitOne(10000)) { throw 'Timed out while updating the saved repository list.' }
        $repos = if (Test-Path -LiteralPath $RepoList -PathType Leaf) { @(Get-Content -Encoding UTF8 -LiteralPath $RepoList | ForEach-Object { $_.Trim() } | Where-Object { $_ }) } else { @() }
        if (-not ($repos | Where-Object { [string]::Equals($_,$resolved,[StringComparison]::OrdinalIgnoreCase) })) {
            [IO.File]::WriteAllLines($RepoList,@($repos)+$resolved,$utf8)
        }
    } finally {
        try { $mutex.ReleaseMutex() } catch {}
        $mutex.Dispose()
    }
    return $resolved
}

# Several repositories at once: each check is three short Git commands, so 129 repositories took
# about 25 seconds one by one. Results keep the saved order; progress counts finished checks.
function Get-RepositoryInfoParallel([string[]]$Targets, [int]$Threads = 6) {
    if (-not $Targets.Count) { return @() }
    $iss = [Management.Automation.Runspaces.InitialSessionState]::CreateDefault()
    foreach ($name in @('Assert-NotCancelled','Invoke-Git','Test-GitDeckProtectedStatusLine','Test-GitRepo','Get-RepositoryInfo')) {
        $iss.Commands.Add((New-Object Management.Automation.Runspaces.SessionStateFunctionEntry($name, (Get-Item "function:$name").Definition)))
    }
    $iss.Variables.Add((New-Object Management.Automation.Runspaces.SessionStateVariableEntry('cancelPath', $cancelPath, '')))
    $pool = [RunspaceFactory]::CreateRunspacePool(1, [Math]::Max(1, [Math]::Min($Threads, $Targets.Count)), $iss, $Host)
    $pool.Open()
    $work = New-Object 'System.Collections.Generic.List[object]'
    try {
        for ($index = 0; $index -lt $Targets.Count; $index++) {
            $shell = [PowerShell]::Create(); $shell.RunspacePool = $pool
            [void]$shell.AddScript('param($Path) Get-RepositoryInfo $Path').AddArgument($Targets[$index])
            $work.Add([pscustomobject]@{ shell = $shell; handle = $shell.BeginInvoke(); path = $Targets[$index] })
        }
        $results = New-Object 'object[]' $Targets.Count
        $lastReport = [DateTime]::MinValue
        for ($index = 0; $index -lt $work.Count; $index++) {
            $entry = $work[$index]
            while (-not $entry.handle.AsyncWaitHandle.WaitOne(250)) { Assert-NotCancelled }
            $output = $null
            try { $output = @($entry.shell.EndInvoke($entry.handle)) } catch { Assert-NotCancelled }
            $results[$index] = if ($output -and $output.Count) { $output[0] } else {
                [ordered]@{path=$entry.path;name=(Split-Path $entry.path -Leaf);valid=$false;branch='-';changes=0;ahead='-';behind='-';lastCommit='-';remote='';pending=$false}
            }
            # Progress a few times a second at most; every write competes with the server reading it.
            if ($index -eq $work.Count - 1 -or ([DateTime]::UtcNow - $lastReport).TotalMilliseconds -ge 400) {
                $lastReport = [DateTime]::UtcNow
                $progress = [int](3 + ((($index + 1) / [double][Math]::Max(1,$Targets.Count)) * 92))
                Write-JobStatus 'running' $progress "Checked $($index+1) of $($Targets.Count): $($entry.path)"
            }
        }
        return $results
    } finally {
        foreach ($entry in $work) { try { if (-not $entry.handle.IsCompleted) { $entry.shell.Stop() } } catch {}; $entry.shell.Dispose() }
        $pool.Close(); $pool.Dispose()
    }
}

function Get-RepositoryInfo([string]$Path) {
    $name = Split-Path $Path -Leaf
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return [ordered]@{path=$Path;name=$name;valid=$false;branch='-';changes=0;ahead='-';behind='-';lastCommit='-';remote='';pending=$false}
    }
    $status = Invoke-Git $Path @('status','--porcelain=v2','--branch')
    if ($status.Code -ne 0) { return [ordered]@{path=$Path;name=$name;valid=$false;branch='-';changes=0;ahead='-';behind='-';lastCommit='-';remote='';pending=$false} }
    $lines = if ($status.Output) { @($status.Output -split "`r?`n" | Where-Object { -not (Test-GitDeckProtectedStatusLine $_) }) } else { @() }
    $headLine = $lines | Where-Object { $_ -like '# branch.head *' } | Select-Object -First 1
    $oidLine = $lines | Where-Object { $_ -like '# branch.oid *' } | Select-Object -First 1
    $abLine = $lines | Where-Object { $_ -like '# branch.ab *' } | Select-Object -First 1
    $branch = if ($headLine) { $headLine.Substring(14).Trim() } else { '-' }
    if ($branch -eq '(detached)' -and $oidLine) { $branch = 'detached@' + $oidLine.Substring(13).Trim().Substring(0,7) }
    $changes = @($lines | Where-Object { $_ -and -not $_.StartsWith('#') }).Count
    $ahead = '-'; $behind = '-'
    if ($abLine -match '\+(\d+)\s+-(\d+)') { $ahead=$Matches[1]; $behind=$Matches[2] }
    $lastResult = Invoke-Git $Path @('log','-1','--format=%h %ad %s','--date=short')
    $last = $lastResult.Output.Trim(); if (-not $last) { $last='(no commits yet)' }
    $remoteResult = Invoke-Git $Path @('remote','get-url','origin')
    $remote = if ($remoteResult.Code -eq 0) { $remoteResult.Output.Trim() } else { '' }
    return [ordered]@{path=$Path;name=$name;valid=$true;branch=$branch;changes=$changes;ahead=$ahead;behind=$behind;lastCommit=$last;remote=$remote;pending=$false}
}

try {
    if (-not (Test-Path -LiteralPath $specPath -PathType Leaf)) { throw 'Job specification was not found.' }
    $script:Spec = Get-Content -Encoding UTF8 -LiteralPath $specPath -Raw | ConvertFrom-Json
    $script:StartedAt = [DateTime]::UtcNow.ToString('o')
    Write-JobStatus 'running' 2 'Starting Git job...'
    Assert-NotCancelled

    switch ([string]$script:Spec.action) {
        'clone' {
            $destination = [IO.Path]::GetFullPath([string]$script:Spec.path).TrimEnd('\')
            $url = [string]$script:Spec.url
            Write-JobStatus 'running' 10 'Cloning repository...'
            $git = Invoke-Git '' @('clone','--progress',$url,$destination)
            if ($git.Code -ne 0) { throw $(if ($git.Output) { $git.Output } else { 'Git clone failed.' }) }
            Assert-NotCancelled
            Write-JobStatus 'running' 92 'Saving repository in Git Deck...' $git.Output
            $saved = Add-SavedRepository $destination ([string]$script:Spec.repoList)
            Write-JobStatus 'completed' 100 'Repository cloned and added.' $git.Output @{path=$saved}
        }
        'fetch' {
            $repo = [string]$script:Spec.path
            if (-not (Test-GitRepo $repo)) { throw 'Repository folder is missing or invalid.' }
            Write-JobStatus 'running' 15 'Fetching remote branches and tags...'
            $git = Invoke-Git $repo @('fetch','--all','--prune','--progress')
            if ($git.Code -ne 0) { throw $(if ($git.Output) { $git.Output } else { 'Git fetch failed.' }) }
            $output = if ($git.Output) { $git.Output } else { 'Already up to date.' }
            Write-JobStatus 'completed' 100 'Fetch completed.' $output @{path=$repo}
        }
        'submodule-update' {
            $repo=[string]$script:Spec.path
            if(-not(Test-GitRepo $repo)){throw 'Repository folder is missing or invalid.'}
            Write-JobStatus 'running' 12 'Initializing and updating submodules...'
            $git=Invoke-Git $repo @('submodule','update','--init','--recursive','--progress')
            if($git.Code -ne 0){throw $(if($git.Output){$git.Output}else{'Submodule update failed.'})}
            Assert-NotCancelled
            Write-JobStatus 'completed' 100 'Submodules initialized and updated.' $(if($git.Output){$git.Output}else{'Submodules are up to date.'}) @{path=$repo}
        }
        'lfs-pull' {
            $repo=[string]$script:Spec.path;if(-not(Test-GitRepo $repo)){throw 'Repository folder is missing or invalid.'};Write-JobStatus 'running' 12 'Downloading Git LFS objects...';$git=Invoke-Git $repo @('lfs','pull');if($git.Code -ne 0){throw $(if($git.Output){$git.Output}else{'Git LFS Pull failed.'})};Write-JobStatus 'completed' 100 'Git LFS objects downloaded.' $git.Output @{path=$repo}
        }
        'lfs-prune' {
            $repo=[string]$script:Spec.path;if(-not(Test-GitRepo $repo)){throw 'Repository folder is missing or invalid.'};Write-JobStatus 'running' 15 'Pruning old Git LFS objects...';$git=Invoke-Git $repo @('lfs','prune');if($git.Code -ne 0){throw $(if($git.Output){$git.Output}else{'Git LFS Prune failed.'})};Write-JobStatus 'completed' 100 'Old Git LFS objects pruned.' $git.Output @{path=$repo}
        }
        'maintenance-gc' {
            $repo=[string]$script:Spec.path;if(-not(Test-GitRepo $repo)){throw 'Repository folder is missing or invalid.'};Write-JobStatus 'running' 15 'Optimizing Git object storage...';$git=Invoke-Git $repo @('gc');if($git.Code -ne 0){throw $(if($git.Output){$git.Output}else{'Repository optimization failed.'})};Write-JobStatus 'completed' 100 'Repository optimization completed.' $(if($git.Output){$git.Output}else{'Git object database optimized.'}) @{path=$repo}
        }
        'remote-prune' {
            $repo=[string]$script:Spec.path;$remote=[string]$script:Spec.remote;if(-not(Test-GitRepo $repo)){throw 'Repository folder is missing or invalid.'};if($remote -notmatch '^[A-Za-z0-9._-]+$'){throw 'Invalid remote name.'};Write-JobStatus 'running' 12 "Pruning stale refs from $remote...";$git=Invoke-Git $repo @('remote','prune',$remote);if($git.Code -ne 0){throw $(if($git.Output){$git.Output}else{'Remote prune failed.'})};Write-JobStatus 'completed' 100 "Remote $remote pruned." $(if($git.Output){$git.Output}else{'No stale refs.'}) @{path=$repo;remote=$remote}
        }
        'submodule-add' {
            $repo=[string]$script:Spec.path;$url=[string]$script:Spec.url;$target=[string]$script:Spec.target;if(-not(Test-GitRepo $repo)){throw 'Repository folder is missing or invalid.'};Write-JobStatus 'running' 10 "Adding submodule at $target...";$git=Invoke-Git $repo @('submodule','add','--progress','--',$url,$target);if($git.Code -ne 0){throw $(if($git.Output){$git.Output}else{'Submodule add failed.'})};Write-JobStatus 'completed' 100 'Submodule added. Commit .gitmodules and the submodule entry.' $git.Output @{path=$repo;target=$target}
        }
        'bundle-export' {
            $repo=[string]$script:Spec.path;$outputPath=[string]$script:Spec.outputPath;if(-not(Test-GitRepo $repo)){throw 'Repository folder is missing or invalid.'};Write-JobStatus 'running' 10 'Exporting all refs and objects to a Git bundle...';$git=Invoke-Git $repo @('bundle','create',$outputPath,'--all');if($git.Code -ne 0){throw $(if($git.Output){$git.Output}else{'Bundle export failed.'})};Write-JobStatus 'completed' 100 'Full repository bundle exported.' $outputPath @{path=$repo;outputPath=$outputPath}
        }
        'bulk-fetch' {
            $targets = @($script:Spec.repositories)
            if (-not $targets.Count) { throw 'No repositories were supplied for Bulk Fetch.' }
            $lines = New-Object 'System.Collections.Generic.List[string]'
            $success = 0
            for ($index=0; $index -lt $targets.Count; $index++) {
                Assert-NotCancelled
                $repo = [string]$targets[$index]
                $progress = [int](5 + (($index / [double]$targets.Count) * 90))
                Write-JobStatus 'running' $progress "Fetching $($index+1) of $($targets.Count): $repo" ($lines -join "`r`n")
                if (-not (Test-GitRepo $repo)) { $lines.Add("[SKIP] $repo - missing or invalid"); continue }
                $git = Invoke-Git $repo @('fetch','--all','--prune','--progress')
                if ($git.Code -eq 0) { $success++; $message = if ($git.Output) { $git.Output } else { 'Up to date' }; $lines.Add("[OK] $repo - $message") }
                else { $lines.Add("[FAIL] $repo - $($git.Output)") }
            }
            $message = "Bulk Fetch completed: $success of $($targets.Count) succeeded."
            Write-JobStatus 'completed' 100 $message ($lines -join "`r`n") @{success=$success;total=$targets.Count}
        }
        'refresh-repos' {
            $targets = @($script:Spec.repositories)
            $cachePath = [IO.Path]::GetFullPath([string]$script:Spec.cachePath)
            $items = New-Object 'System.Collections.Generic.List[object]'
            foreach ($item in (Get-RepositoryInfoParallel @($targets | ForEach-Object { [string]$_ }))) { $items.Add($item) }
            $itemArray = @($items | ForEach-Object { $_ })
            $cache = [ordered]@{cachedAt=[DateTime]::UtcNow.ToString('o');repos=$itemArray}
            $tempCache = $cachePath + '.' + $PID + '.tmp'
            [IO.File]::WriteAllText($tempCache,($cache | ConvertTo-Json -Depth 8 -Compress),$utf8)
            for ($attempt = 1; ; $attempt++) { try { Move-Item -LiteralPath $tempCache -Destination $cachePath -Force -ErrorAction Stop; break } catch { if ($attempt -ge 20) { throw }; Start-Sleep -Milliseconds 50 } }
            Write-JobStatus 'completed' 100 "Repository status updated for $($targets.Count) repositories." '' @{total=$targets.Count;cachedAt=$cache.cachedAt}
        }
        default { throw 'Unsupported background Git action.' }
    }
} catch [OperationCanceledException] {
    if (-not $script:Spec) { $script:Spec = [pscustomobject]@{action='unknown'} }
    if (-not $script:StartedAt) { $script:StartedAt = [DateTime]::UtcNow.ToString('o') }
    Write-JobStatus 'cancelled' 0 'Job cancelled.'
} catch {
    if (-not $script:Spec) { $script:Spec = [pscustomobject]@{action='unknown'} }
    if (-not $script:StartedAt) { $script:StartedAt = [DateTime]::UtcNow.ToString('o') }
    Write-JobStatus 'failed' 0 'Git job failed.' $_.Exception.Message
    exit 1
}
