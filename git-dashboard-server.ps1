[CmdletBinding()]
param([int]$Port = 8765,[switch]$NoBrowser,[int]$IdleShutdownSeconds = 0,[switch]$Serial)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$script:Root = $PSScriptRoot
. (Join-Path $PSScriptRoot 'git-workflow-tools.ps1')
. (Join-Path $PSScriptRoot 'git-diff-content.ps1')
. (Join-Path $PSScriptRoot 'lib\GitDeck.Runtime.ps1')
. (Join-Path $PSScriptRoot 'lib\GitDeck.Features.ps1')
. (Join-Path $PSScriptRoot 'lib\GitDeck.Pull.ps1')
. (Join-Path $PSScriptRoot 'lib\GitDeck.Switch.ps1')
. (Join-Path $PSScriptRoot 'lib\GitDeck.Parity.ps1')
. (Join-Path $PSScriptRoot 'lib\GitDeck.Export.ps1')
. (Join-Path $PSScriptRoot 'lib\GitDeck.CustomActions.ps1')
. (Join-Path $PSScriptRoot 'lib\GitDeck.Ai.ps1')
$script:WebRoot = Join-Path $PSScriptRoot 'web'
$script:RepoList = Join-Path $PSScriptRoot 'git-repositories.txt'
$script:ScanList = Join-Path $PSScriptRoot 'git-scan-locations.txt'
$script:RepoCache = Join-Path $PSScriptRoot 'git-repository-cache.json'
$script:Glab = Join-Path $PSScriptRoot 'bin\glab.exe'
$script:JobsRoot = Join-Path $PSScriptRoot 'jobs'
$script:JobWorker = Join-Path $PSScriptRoot 'git-job-worker.ps1'
$script:ActionJournal = Join-Path $PSScriptRoot 'git-action-journal.json'
$script:UiState = Join-Path $PSScriptRoot 'git-deck-ui-state.json'
$script:ExportsRoot = Join-Path $PSScriptRoot 'exports'
$script:SelectedPatch = ''
$script:Running = $true
$script:BaseUrl = "http://127.0.0.1:$Port/"
[void](New-Item -ItemType Directory -Path $script:JobsRoot -Force)
[void](New-Item -ItemType Directory -Path $script:ExportsRoot -Force)
# Script variables copied into each parallel request runspace.
$script:SharedVariableNames = @('Root','WebRoot','RepoList','ScanList','RepoCache','Glab','JobsRoot','JobWorker','ActionJournal','UiState','ExportsRoot','BaseUrl','Port','ImmutableCache','StaticTypes','SecretRules')

function Get-Repositories {
    if (-not (Test-Path -LiteralPath $script:RepoList -PathType Leaf)) { return @() }
    return @(Get-Content -LiteralPath $script:RepoList | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
}

function Save-Repositories([string[]]$Repositories) {
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllLines($script:RepoList, @($Repositories), $utf8)
}

function Get-ScanLocations {
    if (-not (Test-Path -LiteralPath $script:ScanList -PathType Leaf)) { return @() }
    return @(Get-Content -LiteralPath $script:ScanList | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
}

function Save-ScanLocations([string[]]$Locations) {
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllLines($script:ScanList, @($Locations), $utf8)
}

function Add-ScanLocation([string]$Path) {
    $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path.TrimEnd('\')
    $locations = @(Get-ScanLocations)
    if (-not ($locations | Where-Object { [string]::Equals($_,$resolved,[StringComparison]::OrdinalIgnoreCase) })) {
        Save-ScanLocations (@($locations) + $resolved)
    }
    return $resolved
}

function Test-GitRepository([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return $false }
    & git -C $Path rev-parse --is-inside-work-tree *> $null
    return ($LASTEXITCODE -eq 0)
}

function Invoke-GitCapture([string]$Path, [string[]]$Arguments) {
    $items = @(& git -C $Path @Arguments 2>&1)
    $code = $LASTEXITCODE
    $text = ($items | ForEach-Object {
        if ($_ -is [Management.Automation.ErrorRecord]) { $_.Exception.Message }
        else { [string]$_ }
    } | Out-String).TrimEnd()
    return @{ Code = $code; Output = $text }
}

function Test-GitDeckProtectedPath([string]$File) {
    if (-not $File) { return $false }
    $normalized = $File.Trim('"') -replace '\\','/'
    return ($normalized -match '(^|/)\.idea(?:/|$)' -or $normalized -match '(?i)\.iml$')
}

function Test-GitDeckProtectedStatusLine([string]$Line) {
    if (-not $Line) { return $false }
    if ($Line.StartsWith('?? ')) { return Test-GitDeckProtectedPath $Line.Substring(3) }
    if ($Line.StartsWith('? ')) { return Test-GitDeckProtectedPath $Line.Substring(2) }
    return $false
}

function Get-GitDeckVisibleStatusLines([string]$Text) {
    return @($Text -split "`r?`n" | Where-Object { $_ -and -not (Test-GitDeckProtectedStatusLine $_) })
}

function Invoke-GitDeckStageAll([string]$Path) {
    # Keep tracked IDE metadata stageable if a repository intentionally tracks it,
    # while protecting newly generated IntelliJ files from Stage All.
    $tracked = Invoke-GitCapture $Path @('add','-u','--')
    if ($tracked.Code -ne 0) { throw $(if ($tracked.Output) { $tracked.Output } else { 'Unable to stage tracked changes.' }) }
    $others = Invoke-GitCapture $Path @('add','-A','--','.',':(exclude,glob).idea/**',':(exclude,glob)**/.idea/**',':(exclude,glob)**/*.iml')
    if ($others.Code -ne 0) { throw $(if ($others.Output) { $others.Output } else { 'Unable to stage working changes.' }) }
    return @($tracked.Output,$others.Output | Where-Object { $_ }) -join "`r`n"
}

function Invoke-GlabCapture([string[]]$Arguments) {
    if (-not (Test-Path -LiteralPath $script:Glab -PathType Leaf)) { throw 'GitLab CLI is not installed in Git Deck.' }
    $text = (& $script:Glab @Arguments 2>&1 | Out-String).TrimEnd()
    return @{ Code=$LASTEXITCODE; Output=$text }
}

function Assert-GitLabHost([string]$HostName) {
    if (-not $HostName -or $HostName -notmatch '^[A-Za-z0-9.-]+$') { throw 'Invalid GitLab hostname.' }
}

function Get-GitLabHosts {
    $hosts = New-Object 'System.Collections.Generic.List[string]'
    foreach ($repo in @(Get-Repositories)) {
        $remote = Get-OriginUrl $repo
        $hostName = ''
        if ($remote -match '^(?:https?://|ssh://(?:git@)?)([^/:]+)') { $hostName=$Matches[1] }
        elseif ($remote -match '^git@([^:]+):') { $hostName=$Matches[1] }
        if ($hostName -and $hostName -notmatch '^(github\.com|bitbucket\.org)$' -and -not ($hosts -contains $hostName)) { $hosts.Add($hostName) }
    }
    if (-not $hosts.Count) { $hosts.Add('gitlab.com') }
    return @($hosts)
}

function Test-GlabAuth([string]$HostName) {
    Assert-GitLabHost $HostName
    if (-not (Test-Path -LiteralPath $script:Glab -PathType Leaf)) { return $false }
    $result = Invoke-GlabCapture @('auth','status','--hostname',$HostName)
    return ($result.Code -eq 0)
}

function Get-GitLabProjects([string]$HostName) {
    Assert-GitLabHost $HostName
    if (-not (Test-GlabAuth $HostName)) { throw "GitLab login is required for $HostName." }
    $endpoint = 'projects?membership=true&simple=true&per_page=100&order_by=last_activity_at&sort=desc'
    $result = Invoke-GlabCapture @('api','--hostname',$HostName,'--paginate','--output','json',$endpoint)
    if ($result.Code -ne 0) { throw $result.Output }
    if (-not $result.Output) { return @() }
    return @($result.Output | ConvertFrom-Json)
}

function Get-GitLabMergeRequests([string]$ProjectUrl) {
    if (-not $ProjectUrl -or $ProjectUrl -notmatch '^https?://') { throw 'Invalid GitLab project URL.' }
    $result = Invoke-GlabCapture @('mr','list','--repo',$ProjectUrl,'--output','json','--per-page','50')
    if ($result.Code -ne 0) { throw $result.Output }
    if (-not $result.Output) { return @() }
    return @($result.Output | ConvertFrom-Json)
}

function Get-GitLabProjectApi([string]$ProjectUrl) {
    if (-not $ProjectUrl -or $ProjectUrl -notmatch '^https?://') { throw 'Invalid GitLab project URL.' }
    $uri=[Uri]$ProjectUrl;Assert-GitLabHost $uri.Host;$project=$uri.AbsolutePath.Trim('/') -replace '\.git$',''
    if(-not $project){throw 'GitLab project path is missing.'}
    return [ordered]@{host=$uri.Host;encoded=[Uri]::EscapeDataString($project);path=$project}
}

function Get-GitLabPipelines([string]$ProjectUrl) {
    $project=Get-GitLabProjectApi $ProjectUrl
    $result=Invoke-GlabCapture @('api','--hostname',$project.host,'--output','json',("projects/$($project.encoded)/pipelines?per_page=20"))
    if($result.Code -ne 0){throw $result.Output};if(-not $result.Output){return @()};return @($result.Output|ConvertFrom-Json)
}

function Get-OriginUrl([string]$Path) {
    if (-not (Test-GitRepository $Path)) { return '' }
    $result = Invoke-GitCapture $Path @('remote','get-url','origin')
    if ($result.Code -ne 0) { return '' }
    return $result.Output.Trim()
}

function Get-RepositoryInfo([string]$Path) {
    $name = Split-Path $Path -Leaf
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return [ordered]@{ path=$Path; name=$name; valid=$false; branch='-'; changes=0; ahead='-'; behind='-'; lastCommit='-'; remote='' }
    }
    $status = Invoke-GitCapture $Path @('status','--porcelain=v2','--branch')
    if ($status.Code -ne 0) { return [ordered]@{ path=$Path; name=$name; valid=$false; branch='-'; changes=0; ahead='-'; behind='-'; lastCommit='-'; remote='' } }
    $lines = if ($status.Output) { @(Get-GitDeckVisibleStatusLines $status.Output) } else { @() }
    $headLine = $lines | Where-Object { $_ -like '# branch.head *' } | Select-Object -First 1
    $oidLine = $lines | Where-Object { $_ -like '# branch.oid *' } | Select-Object -First 1
    $abLine = $lines | Where-Object { $_ -like '# branch.ab *' } | Select-Object -First 1
    $branch = if ($headLine) { $headLine.Substring(14).Trim() } else { '-' }
    if ($branch -eq '(detached)' -and $oidLine) { $branch = 'detached@' + $oidLine.Substring(13).Trim().Substring(0,7) }
    $changes = @($lines | Where-Object { $_ -and -not $_.StartsWith('#') }).Count
    $ahead = '-'; $behind = '-'
    if ($abLine -match '\+(\d+)\s+-(\d+)') { $ahead=$Matches[1]; $behind=$Matches[2] }
    $last = (Invoke-GitCapture $Path @('log','-1','--format=%h %ad %s','--date=short')).Output.Trim()
    if (-not $last) { $last = '(no commits yet)' }
    $remoteResult = Invoke-GitCapture $Path @('remote','get-url','origin')
    $remote = if ($remoteResult.Code -eq 0) { $remoteResult.Output.Trim() } else { '' }
    return [ordered]@{ path=$Path; name=$name; valid=$true; branch=$branch; changes=$changes; ahead=$ahead; behind=$behind; lastCommit=$last; remote=$remote }
}

function Get-RepositoryDetails([string]$Path) {
    Assert-Registered $Path
    if (-not (Test-GitRepository $Path)) { throw 'Repository folder is missing or is not a Git working copy.' }

    $root = [IO.Path]::GetFullPath((Invoke-GitOrThrow $Path @('rev-parse','--show-toplevel')).Trim())
    $gitDirRaw = (Invoke-GitOrThrow $Path @('rev-parse','--git-dir')).Trim()
    $gitDir = [IO.Path]::GetFullPath($(if([IO.Path]::IsPathRooted($gitDirRaw)){$gitDirRaw}else{Join-Path $Path $gitDirRaw}))
    $branch = (Invoke-GitCapture $Path @('branch','--show-current')).Output.Trim()
    $head = (Invoke-GitCapture $Path @('rev-parse','--short','HEAD')).Output.Trim()
    if (-not $branch) { $branch = if ($head) { "detached@$head" } else { 'detached HEAD' } }

    $upstreamResult = Invoke-GitCapture $Path @('rev-parse','--abbrev-ref','--symbolic-full-name','@{u}')
    $upstream = if ($upstreamResult.Code -eq 0) { $upstreamResult.Output.Trim() } else { '' }
    $ahead = 0; $behind = 0
    if ($upstream) {
        $counts = Invoke-GitCapture $Path @('rev-list','--left-right','--count','HEAD...@{u}')
        if ($counts.Code -eq 0 -and $counts.Output -match '(\d+)\s+(\d+)') { $ahead=[int]$Matches[1]; $behind=[int]$Matches[2] }
    }

    $statusLines = @(Get-GitDeckVisibleStatusLines (Invoke-GitCapture $Path @('status','--porcelain=v1')).Output)
    $staged = 0; $unstaged = 0; $untracked = 0
    foreach ($line in $statusLines) {
        if ($line.StartsWith('??')) { $untracked++; continue }
        if ($line.Length -ge 2) {
            if ($line[0] -ne ' ') { $staged++ }
            if ($line[1] -ne ' ') { $unstaged++ }
        }
    }

    $remotes = New-Object 'System.Collections.Generic.List[object]'
    $remoteNames = @((Invoke-GitCapture $Path @('remote')).Output -split "`r?`n" | Where-Object { $_ })
    foreach ($remoteName in $remoteNames) {
        $fetchUrl = (Invoke-GitCapture $Path @('remote','get-url',$remoteName)).Output.Trim()
        $pushUrl = (Invoke-GitCapture $Path @('remote','get-url','--push',$remoteName)).Output.Trim()
        $remotes.Add([ordered]@{name=$remoteName;fetchUrl=$fetchUrl;pushUrl=$pushUrl})
    }

    $lastCommit = $null
    $lastResult = Invoke-GitCapture $Path @('log','-1','--date=iso-local','--format=%H%x1f%h%x1f%ad%x1f%an%x1f%s')
    if ($lastResult.Code -eq 0 -and $lastResult.Output) {
        $parts = $lastResult.Output.Trim() -split [char]31,5
        if ($parts.Count -ge 5) { $lastCommit=[ordered]@{fullHash=$parts[0];hash=$parts[1];date=$parts[2];author=$parts[3];subject=$parts[4]} }
    }

    $countLines = { param([string[]]$Arguments) @((Invoke-GitCapture $Path $Arguments).Output -split "`r?`n" | Where-Object { $_ }).Count }
    $branchCount = & $countLines @('for-each-ref','--format=%(refname)','refs/heads')
    $remoteBranchCount = & $countLines @('for-each-ref','--format=%(refname)','refs/remotes')
    $tagCount = & $countLines @('tag','--list')
    $stashCount = & $countLines @('stash','list')
    $shallowResult = Invoke-GitCapture $Path @('rev-parse','--is-shallow-repository')
    $operation = Get-GitOperationState $Path

    return [ordered]@{
        name=(Split-Path $root -Leaf);path=$root;gitDir=$gitDir;valid=$true;branch=$branch;upstream=$upstream
        ahead=$ahead;behind=$behind;changes=$statusLines.Count;staged=$staged;unstaged=$unstaged;untracked=$untracked
        remotes=$remotes.ToArray();lastCommit=$lastCommit;branchCount=$branchCount;remoteBranchCount=$remoteBranchCount
        tagCount=$tagCount;stashCount=$stashCount;shallow=($shallowResult.Output.Trim() -eq 'true');operation=$operation
    }
}

function Get-RepositoryCache {
    $saved = @(Get-Repositories)
    $cachedItems = @()
    $cachedAt = $null
    if (Test-Path -LiteralPath $script:RepoCache -PathType Leaf) {
        try {
            $cache = Get-Content -LiteralPath $script:RepoCache -Raw -ErrorAction Stop | ConvertFrom-Json
            $cachedItems = @($cache.repos)
            $cachedAt = [string]$cache.cachedAt
        } catch { $cachedItems = @(); $cachedAt = $null }
    }
    $items = New-Object 'System.Collections.Generic.List[object]'
    $missingFromCache = $false
    foreach ($path in $saved) {
        $match = $cachedItems | Where-Object { [string]::Equals([string]$_.path,$path,[StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
        if ($match) { $items.Add($match); continue }
        $missingFromCache = $true
        $name = Split-Path $path -Leaf
        $exists = Test-Path -LiteralPath $path -PathType Container
        $items.Add([ordered]@{path=$path;name=$name;valid=$exists;branch='-';changes='-';ahead='-';behind='-';lastCommit='Waiting for first status check';remote='';pending=$true})
    }
    $cachedPaths = @($cachedItems | ForEach-Object { [string]$_.path })
    $listChanged = $missingFromCache -or @($cachedPaths | Where-Object { $candidate=$_; -not ($saved | Where-Object { [string]::Equals($_,$candidate,[StringComparison]::OrdinalIgnoreCase) }) }).Count -gt 0
    $ageMinutes = [double]::PositiveInfinity
    if ($cachedAt) { try { $ageMinutes = ([DateTime]::UtcNow - [DateTime]::Parse($cachedAt).ToUniversalTime()).TotalMinutes } catch {} }
    $itemArray = @($items | ForEach-Object { $_ })
    return [ordered]@{repos=$itemArray;scanLocations=@(Get-ScanLocations);cachedAt=$cachedAt;fromCache=$true;stale=($listChanged -or $ageMinutes -ge 15);cacheAgeMinutes=$(if([double]::IsPositiveInfinity($ageMinutes)){$null}else{[Math]::Round([Math]::Max(0,$ageMinutes),1)})}
}

function Invoke-GitOrThrow([string]$Path, [string[]]$Arguments) {
    $result = Invoke-GitCapture $Path $Arguments
    if ($result.Code -ne 0) { throw $(if ($result.Output) { $result.Output } else { 'Git command failed.' }) }
    return $result.Output
}

function Assert-CleanWorkingTree([string]$Path, [string]$Message='Commit or stash local changes first.') {
    $status = Invoke-GitCapture $Path @('status','--porcelain')
    if ($status.Code -ne 0) { throw $status.Output }
    if (@(Get-GitDeckVisibleStatusLines $status.Output).Count) { throw $Message }
}

function Assert-BranchName([string]$Path, [string]$Name) {
    if (-not $Name) { throw 'Branch name is required.' }
    $check = Invoke-GitCapture $Path @('check-ref-format','--branch',$Name)
    if ($check.Code -ne 0) { throw 'Invalid branch name.' }
}

function Assert-TagName([string]$Path, [string]$Name) {
    if (-not $Name) { throw 'Tag name is required.' }
    $check = Invoke-GitCapture $Path @('check-ref-format',('refs/tags/'+$Name))
    if ($check.Code -ne 0) { throw 'Invalid tag name.' }
}

function Assert-RemoteName([string]$Path,[string]$Name) {
    if (-not $Name -or $Name -notmatch '^[A-Za-z0-9._-]+$') { throw 'Invalid remote name.' }
    $remotes = @((Invoke-GitCapture $Path @('remote')).Output -split "`r?`n" | Where-Object { $_ })
    if (-not ($remotes | Where-Object { [string]::Equals($_,$Name,[StringComparison]::Ordinal) })) { throw "Remote $Name was not found." }
}

function Assert-StashRef([string]$Ref) {
    if ($Ref -notmatch '^stash@\{\d+\}$') { throw 'Invalid stash reference.' }
}

function Get-GitOperationState([string]$Path) {
    $gitDirResult = Invoke-GitCapture $Path @('rev-parse','--git-dir')
    if ($gitDirResult.Code -ne 0) { return [ordered]@{active=$false;type='';conflicts=@()} }
    $gitDir = $gitDirResult.Output.Trim()
    if (-not [IO.Path]::IsPathRooted($gitDir)) { $gitDir = Join-Path $Path $gitDir }
    $type = ''
    if (Test-Path -LiteralPath (Join-Path $gitDir 'MERGE_HEAD')) { $type='merge' }
    elseif ((Test-Path -LiteralPath (Join-Path $gitDir 'rebase-merge')) -or (Test-Path -LiteralPath (Join-Path $gitDir 'rebase-apply'))) { $type='rebase' }
    elseif (Test-Path -LiteralPath (Join-Path $gitDir 'CHERRY_PICK_HEAD')) { $type='cherry-pick' }
    elseif (Test-Path -LiteralPath (Join-Path $gitDir 'REVERT_HEAD')) { $type='revert' }
    $conflicts = @((Invoke-GitCapture $Path @('diff','--name-only','--diff-filter=U')).Output -split "`r?`n" | Where-Object { $_ })
    return [ordered]@{active=[bool]$type;type=$type;conflicts=$conflicts;resolved=($type -and -not $conflicts.Count)}
}

function Invoke-GitPatch([string]$Path,[string]$Patch,[bool]$Cached,[bool]$Reverse) {
    if (-not $Patch -or $Patch.Length -gt 1000000) { throw 'Patch is empty or too large.' }
    if (-not $Patch.StartsWith('diff --git ')) { throw 'Invalid Git patch.' }
    $temp = Join-Path ([IO.Path]::GetTempPath()) ('git-deck-'+[Guid]::NewGuid().ToString()+'.patch')
    try {
        [IO.File]::WriteAllText($temp,$Patch,(New-Object Text.UTF8Encoding($false)))
        $args=New-Object 'System.Collections.Generic.List[string]';$args.Add('apply');$args.Add('--recount');$args.Add('--whitespace=nowarn')
        if($Cached){$args.Add('--cached')};if($Reverse){$args.Add('--reverse')};if($Reverse -and -not $Cached){$args.Add('--ignore-space-change')};$args.Add($temp)
        return Invoke-GitOrThrow $Path $args.ToArray()
    } finally { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
}

function Get-SetupReadiness {
    $git=Get-Command git -ErrorAction SilentlyContinue
    $name=$false;$email=$false;$version='unavailable'
    if($git){
        $version=([string](& git --version 2>$null)).Trim()
        $name=[bool]([string](& git config --global --get user.name 2>$null)).Trim()
        $email=[bool]([string](& git config --global --get user.email 2>$null)).Trim()
    }
    return @{appVersion='1.1.0';gitAvailable=[bool]$git;gitVersion=$version;powerShellVersion=$PSVersionTable.PSVersion.ToString();globalIdentityReady=($name -and $email);gitlabCliAvailable=(Test-Path -LiteralPath $script:Glab -PathType Leaf);serviceReady=$true;port=$Port}
}

function Get-PushPreview([string]$Path,[string]$Remote,[string]$Local,[string]$Target) {
    Assert-Registered $Path
    $remotes=@((Invoke-GitOrThrow $Path @('remote')) -split "`r?`n")
    if($Remote -notin $remotes -or $Remote.StartsWith('-')){throw 'Invalid remote'}
    foreach($branchName in @($Local,$Target)){
        if(-not $branchName -or $branchName.StartsWith('-')){throw 'Invalid branch'}
        if((Invoke-GitCapture $Path @('check-ref-format',('refs/heads/'+$branchName))).Code -ne 0){throw 'Invalid branch'}
    }
    $source=Invoke-GitOrThrow $Path @('rev-parse','--verify',('refs/heads/'+$Local+'^{commit}'))
    $remoteRef='refs/remotes/'+$Remote+'/'+$Target
    $targetResult=Invoke-GitCapture $Path @('rev-parse','--verify',($remoteRef+'^{commit}'))
    $known=$targetResult.Code -eq 0
    $ahead=$null;$behind=$null;$commits=@()
    if($known){
        $range=$targetResult.Output.Trim()+'...'+$source.Trim()
        $counts=(Invoke-GitOrThrow $Path @('rev-list','--left-right','--count',$range)).Trim() -split '\s+'
        $behind=[int]$counts[0];$ahead=[int]$counts[1]
        $commits=@((Invoke-GitOrThrow $Path @('log','-15','--format=%h %s',($targetResult.Output.Trim()+'..'+$source.Trim()))) -split "`r?`n" | Where-Object {$_})
    }
    $fetchPath=(Invoke-GitOrThrow $Path @('rev-parse','--git-path','FETCH_HEAD')).Trim()
    if(-not [IO.Path]::IsPathRooted($fetchPath)){$fetchPath=Join-Path $Path $fetchPath}
    $fetchedAt=$null;if(Test-Path -LiteralPath $fetchPath){$fetchedAt=(Get-Item -LiteralPath $fetchPath).LastWriteTimeUtc.ToString('o')}
    return @{local=$Local;target=$Target;remote=$Remote;knownTarget=$known;ahead=$ahead;behind=$behind;commits=$commits;lastFetchAt=$fetchedAt;note='Local tracking refs only; FETCH_HEAD may belong to another remote. Fetch the selected remote to verify current remote state.'}
}

function Get-WorkspaceDetails([string]$Path,[bool]$IncludeExtras=$true) {
    Assert-Registered $Path
    $statusResult = Invoke-GitCapture $Path @('status','--porcelain=v1')
    if ($statusResult.Code -ne 0) { throw $statusResult.Output }
    $files = New-Object 'System.Collections.Generic.List[object]'
    $protectedPaths = New-Object 'System.Collections.Generic.List[string]'
    foreach ($line in @($statusResult.Output -split "`r?`n" | Where-Object { $_ })) {
        if (Test-GitDeckProtectedStatusLine $line) { $protectedPaths.Add($line.Substring(3)); continue }
        if ($line.Length -lt 4) { continue }
        $indexStatus=$line.Substring(0,1);$worktreeStatus=$line.Substring(1,1)
        $files.Add([ordered]@{status=$line.Substring(0,2);path=$line.Substring(3);indexStatus=$indexStatus;worktreeStatus=$worktreeStatus;staged=($indexStatus -ne ' ' -and $indexStatus -ne '?');unstaged=($worktreeStatus -ne ' ' -or $line.StartsWith('??'))})
    }
    $branch = (Invoke-GitOrThrow $Path @('branch','--show-current')).Trim()
    $branches = New-Object 'System.Collections.Generic.List[object]'
    $branchText = Invoke-GitOrThrow $Path @('for-each-ref','--format=%(refname:short)|%(HEAD)|%(upstream:short)|%(upstream:track)','refs/heads')
    foreach ($line in @($branchText -split "`r?`n" | Where-Object { $_ })) {
        $parts = $line -split '\|',4
        $track=if($parts.Count -gt 3){$parts[3]}else{''};$ahead=0;$behind=0
        if($track -match 'ahead (\d+)'){$ahead=[int]$Matches[1]};if($track -match 'behind (\d+)'){$behind=[int]$Matches[1]}
        $branches.Add([ordered]@{name=$parts[0];current=($parts[1] -eq '*');upstream=$(if($parts.Count -gt 2){$parts[2]}else{''});ahead=$(if($track -match 'gone'){$null}else{$ahead});behind=$(if($track -match 'gone'){$null}else{$behind})})
    }
    $remoteBranches = New-Object 'System.Collections.Generic.List[object]'
    $remoteBranchText = Invoke-GitOrThrow $Path @('for-each-ref','--format=%(refname:short)|%(objectname:short)','refs/remotes')
    foreach ($line in @($remoteBranchText -split "`r?`n" | Where-Object { $_ })) {
        $parts=$line -split '\|',2
        if ($parts[0] -like '*/HEAD' -or $parts[0] -notmatch '/') { continue }
        $remoteBranches.Add([ordered]@{name=$parts[0];hash=$(if($parts.Count -gt 1){$parts[1]}else{''})})
    }
    $history = New-Object 'System.Collections.Generic.List[object]'
    $historyText = Invoke-GitCapture $Path @('log','--all','--topo-order','-250','--date=short','--format=%h%x1f%H%x1f%P%x1f%ad%x1f%an%x1f%s%x1f%D%x1f%at')
    if ($historyText.Code -eq 0) {
        foreach ($line in @($historyText.Output -split "`r?`n" | Where-Object { $_ })) {
            $parts = $line -split ([char]31),8
            if ($parts.Count -ge 7) { $history.Add([ordered]@{hash=$parts[0];fullHash=$parts[1];parents=@($parts[2] -split ' ' | Where-Object { $_ });date=$parts[3];author=$parts[4];subject=$parts[5];decorations=$parts[6];time=$(if($parts.Count -gt 7){[long]$parts[7]}else{0})}) }
        }
    }
    $tagDetails = New-Object 'System.Collections.Generic.List[object]'
    $tagText = (Invoke-GitCapture $Path @('for-each-ref','--sort=-creatordate','--format=%(refname:short)|%(objectname:short)|%(*objectname:short)|%(creatordate:short)|%(contents:subject)','refs/tags')).Output
    foreach ($line in @($tagText -split "`r?`n" | Where-Object { $_ } | Select-Object -First 200)) {
        $parts=$line -split '\|',5
        $peeled=$(if($parts.Count -gt 2){$parts[2]}else{''})
        $tagDetails.Add([ordered]@{name=$parts[0];hash=$(if($peeled){$peeled}else{$parts[1]});date=$(if($parts.Count -gt 3){$parts[3]}else{''});message=$(if($parts.Count -gt 4){$parts[4]}else{''});annotated=[bool]$peeled})
    }
    $tags = @($tagDetails | ForEach-Object { $_.name })
    $stashes = New-Object 'System.Collections.Generic.List[object]'
    $stashText = (Invoke-GitCapture $Path @('stash','list','--format=%gd%x1f%s')).Output
    foreach ($line in @($stashText -split "`r?`n" | Where-Object { $_ })) {
        $parts=$line -split ([char]31),2
        $stashes.Add([ordered]@{ref=$parts[0];message=$(if($parts.Count -gt 1){$parts[1]}else{''})})
    }
    $remotes = New-Object 'System.Collections.Generic.List[object]'
    $remoteNames = @((Invoke-GitCapture $Path @('remote')).Output -split "`r?`n" | Where-Object { $_ })
    foreach ($remoteName in $remoteNames) {
        $fetchUrl=(Invoke-GitCapture $Path @('remote','get-url',$remoteName)).Output.Trim()
        $pushUrl=(Invoke-GitCapture $Path @('remote','get-url','--push',$remoteName)).Output.Trim()
        $remotes.Add([ordered]@{name=$remoteName;fetchUrl=$fetchUrl;pushUrl=$pushUrl})
    }
    $sync=[ordered]@{upstream='';ahead=0;behind=0;outgoing=@();incoming=@()}
    $upstreamResult=Invoke-GitCapture $Path @('rev-parse','--abbrev-ref','--symbolic-full-name','@{u}')
    if($upstreamResult.Code -eq 0){
        $sync.upstream=$upstreamResult.Output.Trim()
        $counts=Invoke-GitCapture $Path @('rev-list','--left-right','--count','HEAD...@{u}')
        if($counts.Code -eq 0){$parts=$counts.Output.Trim() -split '\s+';if($parts.Count -ge 2){$sync.ahead=[int]$parts[0];$sync.behind=[int]$parts[1]}}
        $sync.outgoing=@((Invoke-GitCapture $Path @('log','--format=%h %s','-8','@{u}..HEAD')).Output -split "`r?`n" | Where-Object {$_})
        $sync.incoming=@((Invoke-GitCapture $Path @('log','--format=%h %s','-8','HEAD..@{u}')).Output -split "`r?`n" | Where-Object {$_})
    }
    $headMessage=(Invoke-GitCapture $Path @('log','-1','--format=%B')).Output.Trim()
    $operation=Get-GitOperationState $Path
    $userName=(Invoke-GitCapture $Path @('config','--get','user.name')).Output.Trim();$userEmail=(Invoke-GitCapture $Path @('config','--get','user.email')).Output.Trim()
    $ignorePath=Join-Path $Path '.gitignore';$gitignore='';if(Test-Path -LiteralPath $ignorePath -PathType Leaf){$info=Get-Item -LiteralPath $ignorePath;if($info.Length -le 200000){$gitignore=[IO.File]::ReadAllText($ignorePath)}}
    $submodules=New-Object 'System.Collections.Generic.List[object]'
    $lfsVersion=@{Code=1;Output=''};$lfsCount=0
    if($IncludeExtras){
        $submoduleText=(Invoke-GitCapture $Path @('submodule','status','--recursive')).Output
        foreach($line in @($submoduleText -split "`r?`n"|Where-Object{$_})){if($line -match '^(.)([0-9a-fA-F]+)\s+(\S+)(?:\s+\((.+)\))?'){$submodules.Add([ordered]@{state=$Matches[1];hash=$Matches[2].Substring(0,[Math]::Min(8,$Matches[2].Length));path=$Matches[3];description=$Matches[4]})}}
        $lfsVersion=Invoke-GitCapture $Path @('lfs','version')
        if($lfsVersion.Code -eq 0){$lfsCount=@((Invoke-GitCapture $Path @('lfs','ls-files','--name-only')).Output -split "`r?`n"|Where-Object{$_}).Count}
    }
    $previousResult=Invoke-GitCapture $Path @('rev-parse','--symbolic-full-name','@{-1}')
    $previousBranch='';if($previousResult.Code -eq 0 -and $previousResult.Output.Trim().StartsWith('refs/heads/')){$previousBranch=$previousResult.Output.Trim().Substring(11)}
    return [ordered]@{previousBranch=$previousBranch;branch=$branch;files=$files.ToArray();protectedUntracked=[ordered]@{count=$protectedPaths.Count;paths=$protectedPaths.ToArray()};branches=$branches.ToArray();remoteBranches=$remoteBranches.ToArray();history=$history.ToArray();tags=@($tags);tagDetails=$tagDetails.ToArray();stashes=$stashes.ToArray();remotes=$remotes.ToArray();remote=(Get-OriginUrl $Path);sync=$sync;lastFetchAt=(Get-GitDeckLastFetchAt $Path);operation=$operation;headMessage=$headMessage;settings=[ordered]@{extrasLoaded=$IncludeExtras;userName=$userName;userEmail=$userEmail;gitignore=$gitignore;submodules=$submodules.ToArray();lfsAvailable=($lfsVersion.Code -eq 0);lfsVersion=$lfsVersion.Output.Trim();lfsFiles=$lfsCount}}
}

function Get-CommitHistory([string]$Path,[string]$Scope,[string]$Ref,[bool]$IncludeRemote,[string]$Order,[int]$Skip=0,[string]$Query='') {
    Assert-Registered $Path
    if($Skip -lt 0 -or $Skip -gt 1000000){throw 'Invalid history offset.'}
    if($Query.Length -gt 200){throw 'Search text must not exceed 200 characters.'}
    $args = New-Object 'System.Collections.Generic.List[string]'
    $args.Add('log')
    if ($Scope -eq 'current') { $args.Add('HEAD') }
    elseif ($Scope -eq 'ref') {
        if (-not $Ref -or $Ref.StartsWith('-')) { throw 'Invalid branch or ref.' }
        $verified = Invoke-GitCapture $Path @('rev-parse','--verify',($Ref+'^{commit}'))
        $hash = $verified.Output.Trim()
        if ($verified.Code -ne 0 -or $hash -notmatch '^[0-9a-fA-F]{40}$') { throw 'Branch or ref was not found.' }
        $args.Add($hash)
    } elseif ($IncludeRemote) { $args.Add('--all') }
    else { $args.Add('--branches') }
    $args.Add($(if($Order -eq 'date'){'--date-order'}else{'--topo-order'}))
    $args.Add('-251');$args.Add("--skip=$Skip")
    if($Query){$args.Add('--fixed-strings');$args.Add('--regexp-ignore-case');$args.Add("--grep=$Query")}
    $args.Add('--date=short');$args.Add('--format=%h%x1f%H%x1f%P%x1f%ad%x1f%an%x1f%s%x1f%D%x1f%at')
    $result = Invoke-GitCapture $Path $args.ToArray()
    if ($result.Code -ne 0) { throw $result.Output }
    $history = New-Object 'System.Collections.Generic.List[object]'
    foreach ($line in @($result.Output -split "`r?`n" | Where-Object { $_ })) {
        $parts = $line -split ([char]31),8
        if ($parts.Count -ge 7) { $history.Add([ordered]@{hash=$parts[0];fullHash=$parts[1];parents=@($parts[2] -split ' ' | Where-Object { $_ });date=$parts[3];author=$parts[4];subject=$parts[5];decorations=$parts[6];time=$(if($parts.Count -gt 7){[long]$parts[7]}else{0})}) }
    }
    return $history.ToArray()
}

function Get-ReflogEntries([string]$Path) {
    Assert-Registered $Path
    $result=Invoke-GitCapture $Path @('reflog','show','--all','-120','--date=iso-local','--format=%h%x1f%H%x1f%gd%x1f%cd%x1f%gs')
    if($result.Code -ne 0){throw $result.Output}
    $entries=New-Object 'System.Collections.Generic.List[object]'
    foreach($line in @($result.Output -split "`r?`n"|Where-Object{$_})){
        $parts=$line -split ([char]31),5
        if($parts.Count -eq 5){$entries.Add([ordered]@{hash=$parts[0];fullHash=$parts[1];selector=$parts[2];date=$parts[3];message=$parts[4]})}
    }
    return $entries.ToArray()
}

function Get-WorkingDiff([string]$Path,[string]$File,[bool]$Staged) {
    Assert-Registered $Path
    $status=Invoke-GitCapture $Path @('status','--porcelain=v1')
    if($status.Code -ne 0){throw $status.Output}
    $item=$null
    foreach($line in @($status.Output -split "`r?`n")){
        if($line.Length -ge 4 -and -not (Test-GitDeckProtectedStatusLine $line) -and [string]::Equals($line.Substring(3),$File,[StringComparison]::Ordinal)){
            $item=@{status=$line.Substring(0,2)};break
        }
    }
    if(-not $item){throw 'File is not part of the current working changes.'}
    if($File -match ' -> '){throw 'Rename diff preview is not available yet.'}
    $root=[IO.Path]::GetFullPath($Path).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar;$full=[IO.Path]::GetFullPath((Join-Path $Path $File))
    if(-not $full.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid file path.'}
    if($item.status -eq '??'){
        if(-not (Test-Path -LiteralPath $full -PathType Leaf)){throw 'Untracked file was not found.'}
        $info=Get-Item -LiteralPath $full
        if($info.Length -gt 300000){return [ordered]@{diff='Untracked file is larger than 300 KB. Open it in VS Code to inspect.';binary=$true}}
        try{$lines=@(Get-Content -LiteralPath $full -ErrorAction Stop | Select-Object -First 4000);$text=($lines | ForEach-Object {'+ '+$_}) -join "`r`n";return [ordered]@{diff=("--- /dev/null`r`n+++ "+$File+"`r`n"+$text);binary=$false}}catch{return [ordered]@{diff='Binary or unreadable untracked file.';binary=$true}}
    }
    $args=if($Staged){@('diff','--cached','--no-ext-diff','--unified=4','--',$File)}else{@('diff','--no-ext-diff','--unified=4','--',$File)}
    $result=Invoke-GitCapture $Path $args
    if($result.Code -ne 0){throw $result.Output}
    $text=$result.Output;if(-not $text){$text='No diff in this area. The file may be staged or unstaged in the other section.'}
    if($text.Length -gt 500000){$text=$text.Substring(0,500000)+"`r`n… diff truncated at 500 KB …"}
    return [ordered]@{diff=$text;binary=$false}
}

function Assert-CommitHash([string]$Path, [string]$Hash) {
    if ($Hash -notmatch '^[0-9a-fA-F]{4,40}$') { throw 'Invalid commit hash.' }
    $check=Invoke-GitCapture $Path @('cat-file','-e',($Hash+'^{commit}'))
    if ($check.Code -ne 0) { throw 'Commit was not found.' }
}

function Get-CommitDetails([string]$Path,[string]$Hash) {
    Assert-Registered $Path; Assert-CommitHash $Path $Hash
    $meta=Invoke-GitOrThrow $Path @('show','-s','--date=iso-local','--format=%H%x1f%h%x1f%P%x1f%an%x1f%ad%x1f%s',$Hash)
    $parts=$meta -split ([char]31),6
    $body=(Invoke-GitOrThrow $Path @('show','-s','--format=%B',$Hash)).Trim()
    $files=New-Object 'System.Collections.Generic.List[object]'
    $fileText=Invoke-GitOrThrow $Path @('diff-tree','--root','--first-parent','-m','--no-commit-id','--name-status','-z','-r','--find-renames',$Hash)
    $tokens=@($fileText -split [char]0);$index=0
    while($index -lt $tokens.Count-1){
        $status=$tokens[$index++];$oldPath='';$file=$tokens[$index++]
        if($status -match '^[RC]'){$oldPath=$file;$file=$tokens[$index++]}
        $files.Add([ordered]@{status=$status;path=$file;oldPath=$oldPath;added=$null;removed=$null;binary=$false})
    }
    $stats=Invoke-GitOrThrow $Path @('diff-tree','--root','--first-parent','-m','--no-commit-id','--numstat','-z','-r','--find-renames',$Hash)
    $tokens=@($stats -split [char]0);$index=0
    while($index -lt $tokens.Count){
        $columns=$tokens[$index++] -split "`t",3;if($columns.Count -ne 3){continue};$file=$columns[2]
        if(-not $file){$index++;$file=$tokens[$index++]}
        foreach($item in $files){if($item.path -ceq $file){$item.binary=$columns[0] -eq '-';if(-not $item.binary){$item.added=[int]$columns[0];$item.removed=[int]$columns[1]}}}
    }
    return [ordered]@{fullHash=$parts[0];hash=$parts[1];parents=@($parts[2] -split ' ' | Where-Object { $_ });author=$parts[3];date=$parts[4];subject=$parts[5];body=$body;files=$files.ToArray()}
}

function Get-CommitDiff([string]$Path,[string]$Hash,[string]$File,[bool]$IgnoreWhitespace=$false) {
    Assert-Registered $Path; Assert-CommitHash $Path $Hash
    if(-not $File){throw 'File path is required.'}
    $details=Get-CommitDetails $Path $Hash
    $allowed=@($details.files | ForEach-Object { @($_.path,$_.oldPath) } | Where-Object { $_ })
    if(-not ($allowed | Where-Object { [string]::Equals($_,$File,[StringComparison]::Ordinal) })){throw 'File is not part of this commit.'}
    $selected=@($details.files | Where-Object { $_.path -ceq $File -or $_.oldPath -ceq $File })[0]
    $filePaths=@($selected.path);if($selected.oldPath){$filePaths+=@($selected.oldPath)}
    $whitespace=if($IgnoreWhitespace){@('-w')}else{@()}
    $output=Invoke-GitOrThrow $Path (@('diff-tree','--root','--first-parent','-m','--no-commit-id','-r','-p','--find-renames','--unified=4')+$whitespace+@($Hash,'--')+$filePaths)
    $truncated=$false
    if($output.Length -gt 500000){$output=$output.Substring(0,500000)+"`r`n… diff truncated at 500 KB …";$truncated=$true}
    return [ordered]@{diff=$output;truncated=$truncated}
}

function Get-StashDiff([string]$Path,[string]$Ref) {
    Assert-Registered $Path;Assert-StashRef $Ref
    $output=Invoke-GitOrThrow $Path @('stash','show','--stat','--patch','--find-renames',$Ref)
    if($output.Length -gt 500000){$output=$output.Substring(0,500000)+"`r`n… diff truncated at 500 KB …"}
    return [ordered]@{diff=$output}
}

function Get-FileHistory([string]$Path,[string]$File) {
    Assert-Registered $Path;if(-not $File -or $File -match "[`r`n]"){throw 'File path is required.'}
    $output=Invoke-GitOrThrow $Path @('log','--follow','-100','--date=short','--format=%h%x1f%H%x1f%ad%x1f%an%x1f%s','--',$File)
    $items=New-Object 'System.Collections.Generic.List[object]'
    foreach($line in @($output -split "`r?`n"|Where-Object{$_})){$parts=$line -split ([char]31),5;if($parts.Count -eq 5){$items.Add([ordered]@{hash=$parts[0];fullHash=$parts[1];date=$parts[2];author=$parts[3];subject=$parts[4]})}}
    return @($items)
}

function Get-FileBlame([string]$Path,[string]$File) {
    Assert-Registered $Path;if(-not $File -or $File -match "[`r`n]"){throw 'File path is required.'}
    $output=Invoke-GitOrThrow $Path @('blame','--date=short','--line-porcelain','--',$File)
    if($output.Length -gt 700000){$output=$output.Substring(0,700000)+"`r`n… blame truncated …"}
    return [ordered]@{text=$output}
}

function Resolve-GitRef([string]$Path,[string]$Ref) {
    if (-not $Ref -or $Ref.StartsWith('-') -or $Ref -match "[`r`n]") { throw 'Invalid Git reference.' }
    $result=Invoke-GitCapture $Path @('rev-parse','--verify',($Ref+'^{commit}'))
    $hash=$result.Output.Trim()
    if($result.Code -ne 0 -or $hash -notmatch '^[0-9a-fA-F]{40}$'){throw "Git reference $Ref was not found."}
    return $hash
}

function Get-GitToolsState([string]$Path) {
    Assert-Registered $Path
    $objects=Invoke-GitCapture $Path @('count-objects','-vH')
    $bisect=Invoke-GitCapture $Path @('bisect','log')
    $lfs=Invoke-GitCapture $Path @('lfs','track')
    $attributes=Join-Path $Path '.gitattributes';$attributeText='';if(Test-Path -LiteralPath $attributes -PathType Leaf){$attributeText=Get-Content -LiteralPath $attributes -Raw -ErrorAction SilentlyContinue}
    $patterns=New-Object 'System.Collections.Generic.List[string]';foreach($line in @($attributeText -split "`r?`n"|Where-Object{$_ -and $_ -notmatch '^\s*#' -and $_ -match 'filter=lfs'})){if($line -match '^\s*(\S+)\s+'){$patterns.Add($Matches[1])}}
    return [ordered]@{objects=$(if($objects.Code -eq 0){$objects.Output}else{'Repository statistics unavailable.'});bisectActive=($bisect.Code -eq 0);bisectLog=$(if($bisect.Code -eq 0){$bisect.Output}else{''});lfsAvailable=($lfs.Code -eq 0);lfsPatterns=$patterns.ToArray()}
}

function Convert-LogLines([string]$Text) {
    $items=New-Object 'System.Collections.Generic.List[object]'
    foreach($line in @($Text -split "`r?`n"|Where-Object{$_})){
        $parts=$line -split ([char]31),6
        if($parts.Count -eq 6){$items.Add([ordered]@{hash=$parts[0];fullHash=$parts[1];date=$parts[2];author=$parts[3];subject=$parts[4];decorations=$parts[5]})}
    }
    return $items.ToArray()
}

function Get-BranchCompare([string]$Path,[string]$Source,[string]$Target,[string]$Remote='origin') {
    Assert-Registered $Path
    $sourceHash=Resolve-GitRef $Path $Source;$targetHash=Resolve-GitRef $Path $Target
    if($sourceHash -eq $targetHash){$base=$sourceHash}else{$base=(Invoke-GitOrThrow $Path @('merge-base',$targetHash,$sourceHash)).Trim()}
    $countResult=Invoke-GitCapture $Path @('rev-list','--left-right','--count',($targetHash+'...'+$sourceHash));$behind=0;$ahead=0
    if($countResult.Code -eq 0){$parts=$countResult.Output.Trim() -split '\s+';if($parts.Count -ge 2){$behind=[int]$parts[0];$ahead=[int]$parts[1]}}
    $log=Invoke-GitCapture $Path @('log','--date=short','--format=%h%x1f%H%x1f%ad%x1f%an%x1f%s%x1f%D','-120',($targetHash+'..'+$sourceHash))
    if($log.Code -ne 0){throw $log.Output}
    $fileResult=Invoke-GitCapture $Path @('diff','--name-status','--find-renames',($targetHash+'...'+$sourceHash));if($fileResult.Code -ne 0){throw $fileResult.Output}
    $files=New-Object 'System.Collections.Generic.List[object]';foreach($line in @($fileResult.Output -split "`r?`n"|Where-Object{$_})){$parts=$line -split "`t";if($parts.Count -ge 2){$files.Add([ordered]@{status=$parts[0];path=$parts[-1];oldPath=$(if($parts.Count -gt 2){$parts[1]}else{''})})}}
    $mergeTree=Invoke-GitCapture $Path @('merge-tree','--write-tree',$targetHash,$sourceHash);$conflicts=$(if($mergeTree.Code -eq 0){$false}elseif($mergeTree.Code -eq 1){$true}else{$null})
    $dirty=[bool](Invoke-GitCapture $Path @('status','--porcelain')).Output
    $remoteExists=$false
    if($Remote -and $Source -match '^[A-Za-z0-9._/-]+$'){$remoteRef=Invoke-GitCapture $Path @('show-ref','--verify','--quiet',('refs/remotes/'+$Remote+'/'+$Source));$remoteExists=($remoteRef.Code -eq 0)}
    $checks=@(
      [ordered]@{key='changes';ok=(-not $dirty);level=$(if($dirty){'block'}else{'ok'});label='Working tree';detail=$(if($dirty){'Commit or stash local changes first.'}else{'Clean'})},
      [ordered]@{key='commits';ok=($ahead -gt 0);level=$(if($ahead -gt 0){'ok'}else{'warn'});label='Commits for MR';detail="$ahead commit(s) ahead of $Target"},
      [ordered]@{key='behind';ok=($behind -eq 0);level=$(if($behind -eq 0){'ok'}else{'warn'});label='Target updates';detail=$(if($behind){"$behind commit(s) from target are not in source"}else{'Source contains target history'})},
      [ordered]@{key='conflict';ok=($conflicts -ne $true);level=$(if($conflicts -eq $true){'block'}elseif($null -eq $conflicts){'warn'}else{'ok'});label='Merge conflicts';detail=$(if($conflicts -eq $true){'Potential conflicts detected'}elseif($null -eq $conflicts){'Conflict preview unavailable with this Git version'}else{'No conflict detected by merge-tree'})},
      [ordered]@{key='remote';ok=$remoteExists;level=$(if($remoteExists){'ok'}else{'warn'});label="$Remote/$Source";detail=$(if($remoteExists){'Remote branch exists'}else{'Will be pushed before creating MR'})}
    )
    return [ordered]@{source=$Source;target=$Target;sourceHash=$sourceHash;targetHash=$targetHash;base=$base;ahead=$ahead;behind=$behind;dirty=$dirty;conflicts=$conflicts;remoteExists=$remoteExists;checks=$checks;commits=@(Convert-LogLines $log.Output);files=$files.ToArray()}
}

function Get-CompareDiff([string]$Path,[string]$Source,[string]$Target,[string]$File) {
    if(-not $File -or $File -match "[`r`n]"){throw 'File path is required.'};$compare=Get-BranchCompare $Path $Source $Target 'origin'
    $allowed=@($compare.files|ForEach-Object{@($_.path,$_.oldPath)}|Where-Object{$_});if(-not ($allowed -contains $File)){throw 'File is not part of this comparison.'}
    $result=Invoke-GitCapture $Path @('diff','--find-renames','--unified=4',($compare.targetHash+'...'+$compare.sourceHash),'--',$File);if($result.Code -ne 0){throw $result.Output};$text=$result.Output;if($text.Length -gt 500000){$text=$text.Substring(0,500000)+"`r`n… diff truncated …"};return [ordered]@{diff=$text}
}

function Search-HistoryContent([string]$Path,[string]$Query,[string]$Mode) {
    Assert-Registered $Path;$Query=$Query.Trim();if(-not $Query -or $Query.Length -gt 200 -or $Query -match "[`r`n]"){throw 'Search text is required and must be under 200 characters.'}
    if($Mode -notin @('literal','regex')){$Mode='literal'}
    $needle=$(if($Mode -eq 'regex'){'-G'+$Query}else{'-S'+$Query})
    $result=Invoke-GitCapture $Path @('log','--all','--date=short','--format=%h%x1f%H%x1f%ad%x1f%an%x1f%s%x1f%D','-120',$needle)
    if($result.Code -ne 0){throw $result.Output};return @(Convert-LogLines $result.Output)
}

function Get-ConflictDetails([string]$Path,[string]$File) {
    Assert-Registered $Path;$operation=Get-GitOperationState $Path
    if(-not $operation.active -or -not ($operation.conflicts -contains $File)){throw 'File is not an active merge conflict.'}
    $readStage={param($stage)$result=Invoke-GitCapture $Path @('show',(":"+$stage+":"+$File));if($result.Code -eq 0){return $result.Output};return ''}
    $full=Join-Path $Path $File;$working=$(if(Test-Path -LiteralPath $full -PathType Leaf){[IO.File]::ReadAllText($full)}else{''})
    return [ordered]@{file=$File;operation=$operation.type;base=(& $readStage 1);ours=(& $readStage 2);theirs=(& $readStage 3);working=$working}
}

function Get-Worktrees([string]$Path) {
    Assert-Registered $Path;$result=Invoke-GitCapture $Path @('worktree','list','--porcelain');if($result.Code -ne 0){throw $result.Output}
    $items=New-Object 'System.Collections.Generic.List[object]';$current=$null
    foreach($line in @(($result.Output+"`n") -split "`r?`n")){
      if(-not $line){if($current){$items.Add($current);$current=$null};continue}
      $parts=$line -split ' ',2;$key=$parts[0];$value=$(if($parts.Count -gt 1){$parts[1]}else{''})
      if($key -eq 'worktree'){$current=[ordered]@{path=$value;head='';branch='';detached=$false;locked=$false;prunable=$false;isMain=[string]::Equals([IO.Path]::GetFullPath($value).TrimEnd('\'),[IO.Path]::GetFullPath($Path).TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase)}}
      elseif($current){if($key -eq 'HEAD'){$current.head=$value}elseif($key -eq 'branch'){$current.branch=$value -replace '^refs/heads/',''}elseif($key -eq 'detached'){$current.detached=$true}elseif($key -eq 'locked'){$current.locked=$true}elseif($key -eq 'prunable'){$current.prunable=$true}}
    }
    return $items.ToArray()
}

function Get-InteractiveRebasePlan([string]$Path,[string]$Base) {
    Assert-Registered $Path;$baseHash=Resolve-GitRef $Path $Base
    $ancestor=Invoke-GitCapture $Path @('merge-base','--is-ancestor',$baseHash,'HEAD');if($ancestor.Code -ne 0){throw 'Selected base is not an ancestor of HEAD.'}
    $result=Invoke-GitCapture $Path @('log','--reverse','--no-merges','--date=short','--format=%h%x1f%H%x1f%ad%x1f%an%x1f%s%x1f%D','-50',($baseHash+'..HEAD'));if($result.Code -ne 0){throw $result.Output}
    return [ordered]@{base=$Base;baseHash=$baseHash;commits=@(Convert-LogLines $result.Output)}
}

function Select-PatchFile {
    Add-Type -AssemblyName System.Windows.Forms;$dialog=New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title='Select a Git patch';$dialog.Filter='Git patches (*.patch;*.diff)|*.patch;*.diff|All files (*.*)|*.*';$dialog.CheckFileExists=$true
    try{if($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK){return ''};return $dialog.FileName}finally{$dialog.Dispose()}
}

function Get-GitLabInbox([string]$Path) {
    Assert-Registered $Path;$remote=Get-OriginUrl $Path;$web=ConvertTo-WebUrl $remote;if(-not $web){throw 'Remote is not a supported GitLab URL.'}
    $project=Get-GitLabProjectApi $web
    $mrResult=Invoke-GlabCapture @('api','--hostname',$project.host,'--output','json',("projects/$($project.encoded)/merge_requests?state=opened&scope=all&per_page=50&order_by=updated_at&sort=desc"));if($mrResult.Code -ne 0){throw $mrResult.Output}
    $pipelineResult=Invoke-GlabCapture @('api','--hostname',$project.host,'--output','json',("projects/$($project.encoded)/pipelines?per_page=20"));if($pipelineResult.Code -ne 0){throw $pipelineResult.Output}
    return [ordered]@{project=$web;host=$project.host;mergeRequests=$(if($mrResult.Output){@($mrResult.Output|ConvertFrom-Json)}else{@()});pipelines=$(if($pipelineResult.Output){@($pipelineResult.Output|ConvertFrom-Json)}else{@()})}
}

function Add-Repository([string]$Path) {
    $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path.TrimEnd('\')
    if (-not (Test-GitRepository $resolved)) { throw 'Folder is not a Git working tree.' }
    $repos = @(Get-Repositories)
    if (-not ($repos | Where-Object { [string]::Equals($_,$resolved,[StringComparison]::OrdinalIgnoreCase) })) {
        Save-Repositories (@($repos) + $resolved)
    }
    return $resolved
}

function Assert-Registered([string]$Path) {
    $match = @(Get-Repositories) | Where-Object { [string]::Equals($_,$Path,[StringComparison]::OrdinalIgnoreCase) }
    if (-not $match) { throw 'Repository is not registered in Git Deck.' }
    if (-not (Test-GitRepository $Path)) { throw 'Repository folder is missing or invalid.' }
}

function Assert-WorkingFile([string]$Path,[string]$File) {
    if(-not $File -or $File -match "[`r`n]"){throw 'File path is required.'}
    $status=Invoke-GitCapture $Path @('status','--porcelain=v1','--',$File)
    if($status.Code -ne 0 -or -not $status.Output){throw 'File is not part of the current working changes.'}
    if(Test-GitDeckProtectedPath $File -and $status.Output.StartsWith('??')){throw 'Generated IntelliJ metadata is protected from staging. Add it to .gitignore if this repository should ignore it for every Git client.'}
}

function ConvertTo-WebUrl([string]$Remote) {
    if ($Remote -match '^https?://') { return ($Remote -replace '\.git$','') }
    if ($Remote -match '^git@([^:]+):(.+)$') { return "https://$($Matches[1])/$($Matches[2] -replace '\.git$','')" }
    if ($Remote -match '^ssh://git@([^/]+)/(.+)$') { return "https://$($Matches[1])/$($Matches[2] -replace '\.git$','')" }
    return ''
}

function Select-ScanFolder {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Select a folder containing Git repositories'
    $dialog.ShowNewFolderButton = $false
    try {
        if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return '' }
        return $dialog.SelectedPath
    } finally { $dialog.Dispose() }
}

function Find-GitRepositories([string]$Root, [int]$MaxDepth=8) {
    $rootPath = (Resolve-Path -LiteralPath $Root -ErrorAction Stop).Path.TrimEnd('\')
    $driveRoot = [IO.Path]::GetPathRoot($rootPath).TrimEnd('\')
    if ([string]::Equals($rootPath,$driveRoot,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'Choose a project folder, not an entire drive.'
    }

    $skipNames = @('.git','node_modules','.next','dist','build','out','coverage','vendor','.cache','.gradle','target')
    $queue = New-Object 'System.Collections.Generic.Queue[object]'
    $queue.Enqueue([pscustomobject]@{Path=$rootPath;Depth=0})
    $found = New-Object 'System.Collections.Generic.List[string]'
    $visited = 0

    while ($queue.Count -gt 0) {
        $item = $queue.Dequeue()
        $visited++
        if ($visited -gt 10000) { throw 'Scan stopped after 10,000 folders. Choose a narrower folder.' }
        if (Test-Path -LiteralPath (Join-Path $item.Path '.git')) {
            if (Test-GitRepository $item.Path) { $found.Add($item.Path) }
            continue
        }
        if ($item.Depth -ge $MaxDepth) { continue }
        $children = @(Get-ChildItem -LiteralPath $item.Path -Directory -ErrorAction SilentlyContinue)
        foreach ($child in $children) {
            if ($skipNames -contains $child.Name) { continue }
            if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
            $queue.Enqueue([pscustomobject]@{Path=$child.FullName;Depth=($item.Depth+1)})
        }
    }
    return @($found | Sort-Object -Unique)
}

function Write-Response($Context, [byte[]]$Bytes, [string]$ContentType, [int]$StatusCode=200) {
    $response = $Context.Response
    try {
        $response.StatusCode = $StatusCode
        $response.ContentType = $ContentType
        $response.ContentEncoding = [Text.Encoding]::UTF8
        $response.Headers['Cache-Control'] = 'no-store'
        $response.Headers['X-Content-Type-Options'] = 'nosniff'
        $response.Headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"
        $response.ContentLength64 = $Bytes.Length
        $response.OutputStream.Write($Bytes,0,$Bytes.Length)
    } catch [System.ObjectDisposedException] {
        # The browser navigated away while this response was being written.
    } catch [System.InvalidOperationException] {
        # The client disconnected after the response had already started.
    } catch [System.Net.HttpListenerException] {
        # A cancelled or closed browser request must not stop the local service.
    } finally {
        try { $response.Close() } catch {}
    }
}

function Write-Json($Context, $Data, [int]$StatusCode=200) {
    $json = $Data | ConvertTo-Json -Depth 6 -Compress
    Write-Response $Context ([Text.Encoding]::UTF8.GetBytes($json)) 'application/json; charset=utf-8' $StatusCode
}

function Write-StaticFile($Context, [string]$Name, [string]$ContentType) {
    $path = Join-Path $script:WebRoot $Name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Write-Json $Context @{error='File not found'} 404; return }
    Write-Response $Context ([IO.File]::ReadAllBytes($path)) $ContentType
}

function Read-JsonBody($Request) {
    $reader = New-Object IO.StreamReader($Request.InputStream,$Request.ContentEncoding)
    try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() }
    if (-not $body) { throw 'Request body is required.' }
    return $body | ConvertFrom-Json
}

function Assert-JobId([string]$JobId) {
    if ($JobId -notmatch '^[0-9a-fA-F-]{36}$') { throw 'Invalid job ID.' }
}

function Write-JsonFile([string]$Path,$Data) {
    $json = $Data | ConvertTo-Json -Depth 8 -Compress
    [IO.File]::WriteAllText($Path,$json,(New-Object Text.UTF8Encoding($false)))
}

function Get-ActionJournal {
    if (-not (Test-Path -LiteralPath $script:ActionJournal -PathType Leaf)) { return @() }
    try {
        # Windows PowerShell 5.1 passes a JSON array down the pipeline as ONE object, so entries were
        # never enumerated (Undo never found the last action) and saving nested them as {"value":[...]}.
        # Flatten both shapes into plain entries.
        $parsed = Get-Content -LiteralPath $script:ActionJournal -Raw -ErrorAction Stop | ConvertFrom-Json
        $flat = New-Object System.Collections.ArrayList
        $add = {
            param($node)
            foreach ($item in @($node)) {
                if ($null -eq $item) { continue }
                if ($item -is [array]) { & $add $item }
                elseif ($item.PSObject.Properties['value'] -and -not $item.PSObject.Properties['id']) { & $add $item.value }
                else { [void]$flat.Add($item) }
            }
        }
        & $add $parsed
        return $flat.ToArray()
    }
    catch { return @() }
}

function Add-ActionJournalEntry($Entry) {
    $items = @($Entry) + @(Get-ActionJournal | Select-Object -First 199)
    Write-JsonFile $script:ActionJournal $items
}

function Get-GitSnapshot([string]$Path) {
    Assert-Registered $Path
    $head = Invoke-GitCapture $Path @('rev-parse','HEAD')
    $branch = Invoke-GitCapture $Path @('branch','--show-current')
    return [ordered]@{ head=$(if($head.Code -eq 0){$head.Output.Trim()}else{''}); branch=$(if($branch.Code -eq 0){$branch.Output.Trim()}else{''}) }
}

function Get-ActionJournalEntry([string]$Path,[string]$Id) {
    if ($Id -notmatch '^[0-9a-fA-F-]{36}$') { throw 'Invalid operation journal ID.' }
    $entry = @(Get-ActionJournal | Where-Object { $_.id -eq $Id -and [string]::Equals([string]$_.path,$Path,[StringComparison]::OrdinalIgnoreCase) }) | Select-Object -First 1
    if (-not $entry) { throw 'Operation journal entry was not found for this repository.' }
    return $entry
}

function Invoke-ActionWithJournal($Body) {
    $action = [string]$Body.action
    $path = [string]$Body.path
    $tracked = @('commit','pull','pull-ref','branch-create','branch-create-at','branch-switch','branch-track','checkout-commit','merge','rebase-start','rebase-interactive','operation-continue','reset-commit','cherry-pick','cherry-pick-many','revert-commit') -contains $action
    $before = $null
    if ($tracked -and $path -and (Test-GitRepository $path)) { $before = Get-GitSnapshot $path }
    $result = Invoke-Action $Body
    if ($tracked -and $before -and -not $result.async -and (Test-GitRepository $path)) {
        $after = Get-GitSnapshot $path
        if ($before.head -ne $after.head -or $before.branch -ne $after.branch) {
            Add-ActionJournalEntry ([ordered]@{id=[Guid]::NewGuid().ToString();path=$path;repository=(Split-Path -Leaf $path);action=$action;beforeHead=$before.head;afterHead=$after.head;beforeBranch=$before.branch;afterBranch=$after.branch;createdAt=[DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss');summary=[string]$result.message})
        }
    }
    return $result
}

function Get-GitJob([string]$JobId) {
    Assert-JobId $JobId
    $statusPath = Join-Path $script:JobsRoot ($JobId + '.status.json')
    if (-not (Test-Path -LiteralPath $statusPath -PathType Leaf)) { throw 'Git job was not found.' }
    for ($attempt=0; $attempt -lt 3; $attempt++) {
        try { return (Get-Content -LiteralPath $statusPath -Raw -ErrorAction Stop | ConvertFrom-Json) }
        catch { if ($attempt -eq 2) { throw 'Git job status is temporarily unavailable.' }; Start-Sleep -Milliseconds 30 }
    }
}

function Get-GitJobs {
    $items=New-Object 'System.Collections.Generic.List[object]'
    foreach($file in @(Get-ChildItem -LiteralPath $script:JobsRoot -Filter '*.status.json' -File -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending|Select-Object -First 40)){
        try{
            $job=Get-Content -LiteralPath $file.FullName -Raw|ConvertFrom-Json
            $items.Add([ordered]@{id=[string]$job.id;action=[string]$job.action;path=[string]$job.path;state=[string]$job.state;progress=[int]$job.progress;message=[string]$job.message;startedAt=[string]$job.startedAt;updatedAt=[string]$job.updatedAt;finishedAt=[string]$job.finishedAt})
        }catch{}
    }
    return $items.ToArray()
}

function Get-ActiveRepoJob([string]$Action,[string]$Path) {
    foreach($job in @(Get-GitJobs)){
        if($job.action -eq $Action -and $job.state -in @('queued','running') -and [string]::Equals([string]$job.path,$Path,[StringComparison]::OrdinalIgnoreCase)){return $job}
    }
    return $null
}

function Get-WindowsIntegrationState {
    $exe=Join-Path $script:Root 'GitDeck.exe'
    $folderKey='HKCU:\Software\Classes\Directory\shell\GitDeck'
    $backgroundKey='HKCU:\Software\Classes\Directory\Background\shell\GitDeck'
    return [ordered]@{installed=((Test-Path $folderKey)-and(Test-Path $backgroundKey));exePresent=(Test-Path -LiteralPath $exe -PathType Leaf);exePath=$exe}
}

function Start-GitJob([hashtable]$Spec,[string]$InitialMessage) {
    if (-not (Test-Path -LiteralPath $script:JobWorker -PathType Leaf)) { throw 'Background Git worker is missing.' }
    $jobId = [Guid]::NewGuid().ToString()
    $specPath = Join-Path $script:JobsRoot ($jobId + '.spec.json')
    $statusPath = Join-Path $script:JobsRoot ($jobId + '.status.json')
    $Spec.id = $jobId
    Write-JsonFile $specPath $Spec
    $startedAt = [DateTime]::UtcNow.ToString('o')
    Write-JsonFile $statusPath ([ordered]@{id=$jobId;action=$Spec.action;path=[string]$Spec.path;state='queued';progress=0;message=$InitialMessage;output='';result=$null;pid=0;startedAt=$startedAt;updatedAt=$startedAt;finishedAt=$null})
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$script:JobWorker,'-JobId',$jobId,'-JobsRoot',$script:JobsRoot) -WindowStyle Hidden -PassThru
    Write-JsonFile $statusPath ([ordered]@{id=$jobId;action=$Spec.action;path=[string]$Spec.path;state='queued';progress=0;message=$InitialMessage;output='';result=$null;pid=$process.Id;startedAt=$startedAt;updatedAt=[DateTime]::UtcNow.ToString('o');finishedAt=$null})
    return @{async=$true;jobId=$jobId;message=$InitialMessage}
}

function Get-ActiveGitJob([string]$Action) {
    foreach ($file in @(Get-ChildItem -LiteralPath $script:JobsRoot -Filter '*.status.json' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)) {
        try {
            $job = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
            if ($job.action -eq $Action -and $job.state -in @('queued','running')) { return $job }
        } catch {}
    }
    return $null
}

function Stop-GitJob([string]$JobId) {
    $job = Get-GitJob $JobId
    if ($job.state -in @('completed','failed','cancelled')) { return @{message="Job is already $($job.state).";job=$job} }
    $cancelPath = Join-Path $script:JobsRoot ($JobId + '.cancel')
    [IO.File]::WriteAllText($cancelPath,'cancel',(New-Object Text.UTF8Encoding($false)))
    $pidValue = [int]$job.pid
    if ($pidValue -gt 0) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue" -ErrorAction SilentlyContinue
        if ($process -and $process.CommandLine -like ('*git-job-worker.ps1*' + $JobId + '*')) { & taskkill.exe /PID $pidValue /T /F *> $null }
    }
    $cancelled = [ordered]@{id=$JobId;action=$job.action;state='cancelled';progress=$job.progress;message='Job cancelled.';output=$job.output;result=$null;pid=$pidValue;startedAt=$job.startedAt;updatedAt=[DateTime]::UtcNow.ToString('o');finishedAt=[DateTime]::UtcNow.ToString('o')}
    Write-JsonFile (Join-Path $script:JobsRoot ($JobId + '.status.json')) $cancelled
    return @{message='Git job cancelled.';job=$cancelled}
}

function Invoke-Action($Body) {
    $action = [string]$Body.action
    $path = [string]$Body.path
    switch ($action) {
        'training-create' { return New-TrainingRepository }
        'ui-state-save' {
            $savedPath=([string]$Body.path).Trim();$tab=([string]$Body.tab).Trim();Assert-Registered $savedPath
            $allowed=@('changes','history','compare','gitlab-inbox','github','search-history','rebase','conflicts','health','worktrees','patches','branches','stashes','tags','remotes','recovery','tools','settings')
            if($tab -notin $allowed){throw 'Invalid workspace view.'}
            $openRepos=New-Object System.Collections.Generic.List[string]
            foreach($candidate in @($Body.openRepos)){
                $candidatePath=([string]$candidate).Trim()
                if(-not $candidatePath){continue}
                Assert-Registered $candidatePath
                if(-not ($openRepos|Where-Object{[string]::Equals($_,$candidatePath,[StringComparison]::OrdinalIgnoreCase)})){$openRepos.Add($candidatePath)}
            }
            if(-not ($openRepos|Where-Object{[string]::Equals($_,$savedPath,[StringComparison]::OrdinalIgnoreCase)})){$openRepos.Add($savedPath)}
            $persistedRepos=@($openRepos)
            Write-JsonFile $script:UiState ([ordered]@{schemaVersion=2;path=$savedPath;tab=$tab;openRepos=$persistedRepos;updatedAt=[DateTime]::UtcNow.ToString('o')})
            return @{message='Workspace view saved.'}
        }
        'ui-state-clear' {
            Write-JsonFile $script:UiState ([ordered]@{schemaVersion=2;path='';tab='history';openRepos=@();updatedAt=[DateTime]::UtcNow.ToString('o')})
            return @{message='Workspace view cleared.'}
        }
        'gitlab-login' {
            $hostName = [string]$Body.host
            Assert-GitLabHost $hostName
            if (-not (Test-Path -LiteralPath $script:Glab -PathType Leaf)) { throw 'GitLab CLI is not installed.' }
            $command = "& '$($script:Glab.Replace("'","''"))' auth login --hostname '$hostName'"
            Start-Process powershell.exe -ArgumentList @('-NoExit','-Command',('"'+$command+'"'))
            return @{message="GitLab login opened for $hostName. Complete it in the Terminal, then refresh."}
        }
        'gitlab-mr-approve' {
            $project=Get-GitLabProjectApi ([string]$Body.project);$iid=[string]$Body.iid;if($iid -notmatch '^\d+$'){throw 'Invalid merge request number.'}
            $result=Invoke-GlabCapture @('api','--hostname',$project.host,'-X','POST',("projects/$($project.encoded)/merge_requests/$iid/approve"));if($result.Code -ne 0){throw $result.Output};return @{message="Merge request !$iid approved.";output=$result.Output}
        }
        'gitlab-mr-merge' {
            $project=Get-GitLabProjectApi ([string]$Body.project);$iid=[string]$Body.iid;if($iid -notmatch '^\d+$'){throw 'Invalid merge request number.'}
            $result=Invoke-GlabCapture @('api','--hostname',$project.host,'-X','PUT',("projects/$($project.encoded)/merge_requests/$iid/merge"));if($result.Code -ne 0){throw $result.Output};return @{message="Merge request !$iid merged.";output=$result.Output}
        }
        'gitlab-mr-comment' {
            $project=Get-GitLabProjectApi ([string]$Body.project);$iid=[string]$Body.iid;$comment=([string]$Body.comment).Trim();if($iid -notmatch '^\d+$'){throw 'Invalid merge request number.'};if(-not $comment -or $comment.Length -gt 5000){throw 'Comment is empty or too long.'}
            $result=Invoke-GlabCapture @('api','--hostname',$project.host,'-X','POST','-f',("body=$comment"),("projects/$($project.encoded)/merge_requests/$iid/notes"));if($result.Code -ne 0){throw $result.Output};return @{message="Comment added to merge request !$iid.";output=$result.Output}
        }
        'gitlab-mr-close' {
            $project=Get-GitLabProjectApi ([string]$Body.project);$iid=[string]$Body.iid;if($iid -notmatch '^\d+$'){throw 'Invalid merge request number.'}
            $result=Invoke-GlabCapture @('api','--hostname',$project.host,'-X','PUT','-f','state_event=close',("projects/$($project.encoded)/merge_requests/$iid"));if($result.Code -ne 0){throw $result.Output};return @{message="Merge request !$iid closed.";output=$result.Output}
        }
        'gitlab-pipeline-retry' {
            $project=Get-GitLabProjectApi ([string]$Body.project);$id=[string]$Body.pipeline;if($id -notmatch '^\d+$'){throw 'Invalid pipeline ID.'}
            $result=Invoke-GlabCapture @('api','--hostname',$project.host,'-X','POST',("projects/$($project.encoded)/pipelines/$id/retry"));if($result.Code -ne 0){throw $result.Output};return @{message="Pipeline $id retry started.";output=$result.Output}
        }
        'create-mr' {
            Assert-Registered $path
            $target = ([string]$Body.target).Trim(); $title = ([string]$Body.title).Trim(); $description = [string]$Body.description;$source=([string]$Body.source).Trim();$remote=([string]$Body.remote).Trim();$assignee=([string]$Body.assignee).Trim();$reviewer=([string]$Body.reviewer).Trim();$labels=([string]$Body.labels).Trim();$milestone=([string]$Body.milestone).Trim();$template=([string]$Body.template).Trim()
            if (-not $target -or -not $title) { throw 'Target branch and merge request title are required.' }
            foreach($value in @($title,$assignee,$reviewer,$labels,$milestone,$template)){if($value.Length -gt 500){throw 'A merge request field is too long.'}}
            if(-not $source){$source=(Invoke-GitCapture $path @('branch','--show-current')).Output.Trim()}
            if(-not $source){throw 'Source branch is required.'};Assert-BranchName $path $source
            if($target -notmatch '^[A-Za-z0-9._/-]+$' -or $target.StartsWith('-')){throw 'Invalid target branch.'}
            if ([string]::Equals($source,$target,[StringComparison]::OrdinalIgnoreCase)) { throw 'Source and target branches must be different.' }
            $status = Invoke-GitCapture $path @('status','--porcelain')
            if ($status.Output) { throw 'Commit or stash local changes before creating a merge request.' }
            if(-not $remote){$remote='origin'};Assert-RemoteName $path $remote
            $local=Invoke-GitCapture $path @('show-ref','--verify','--quiet',('refs/heads/'+$source))
            if($local.Code -eq 0){[void](Invoke-GitOrThrow $path @('push','-u',$remote,$source))}
            else{$remoteRef=Invoke-GitCapture $path @('show-ref','--verify','--quiet',('refs/remotes/'+$remote+'/'+$source));if($remoteRef.Code -ne 0){throw "Source branch $source was not found locally or on $remote."}}
            $mrArgs=New-Object 'System.Collections.Generic.List[string]';foreach($value in @('mr','create','--source-branch',$source,'--target-branch',$target,'--title',$title,'--description',$description)){[void]$mrArgs.Add($value)}
            if($assignee){[void]$mrArgs.Add('--assignee');[void]$mrArgs.Add($assignee)};if($reviewer){[void]$mrArgs.Add('--reviewer');[void]$mrArgs.Add($reviewer)};if($labels){[void]$mrArgs.Add('--label');[void]$mrArgs.Add($labels)};if($milestone){[void]$mrArgs.Add('--milestone');[void]$mrArgs.Add($milestone)};if($template){[void]$mrArgs.Add('--template');[void]$mrArgs.Add($template)}
            if([bool]$Body.draft){[void]$mrArgs.Add('--draft')};if([bool]$Body.squash){[void]$mrArgs.Add('--squash-before-merge')};if([bool]$Body.removeSource){[void]$mrArgs.Add('--remove-source-branch')};[void]$mrArgs.Add('--yes')
            Push-Location -LiteralPath $path
            try { $result = Invoke-GlabCapture $mrArgs.ToArray() }
            finally { Pop-Location }
            if ($result.Code -ne 0) { throw $result.Output }
            return @{message="Merge request created: $source → $target.";output=$result.Output}
        }
        'open-url' {
            $url=([string]$Body.url).Trim();if($url -notmatch '^https?://'){throw 'Only HTTP or HTTPS URLs can be opened.'};Start-Process $url;return @{message='URL opened in your browser.';output=$url}
        }
        'choose-folder' {
            $selected = Select-ScanFolder
            if (-not $selected) { throw 'Folder selection was cancelled.' }
            return @{ message='Folder selected.'; path=$selected }
        }
        'scan' {
            if (-not $path) { throw 'Folder to scan is required.' }
            $scanRoot = Add-ScanLocation $path
            $found = @(Find-GitRepositories $scanRoot 8)
            $repos = @(Get-Repositories)
            $combined = New-Object 'System.Collections.Generic.List[string]'
            foreach ($repo in @($repos)+@($found)) {
                if (-not ($combined | Where-Object { [string]::Equals($_,$repo,[StringComparison]::OrdinalIgnoreCase) })) { $combined.Add($repo) }
            }
            Save-Repositories @($combined)
            $resultText = if ($found.Count) { $found -join "`r`n" } else { 'No Git repositories found within 8 levels.' }
            return @{ message="Scan completed: $($found.Count) repositories found."; output=$resultText; found=$found; scanRoot=$scanRoot }
        }
        'forget-scan-location' {
            if (-not $path) { throw 'Scan location is required.' }
            $remaining = @(Get-ScanLocations | Where-Object { -not [string]::Equals($_,$path,[StringComparison]::OrdinalIgnoreCase) })
            Save-ScanLocations $remaining
            return @{ message='Scan location removed. Saved repositories were kept.' }
        }
        'bulk-fetch' {
            if(-not $path){throw 'Scan location is required.'}
            $root=(Resolve-Path -LiteralPath $path -ErrorAction Stop).Path.TrimEnd('\')
            $targets=@(Get-Repositories | Where-Object { $_ -eq $root -or $_.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) })
            if(-not $targets.Count){throw 'No saved repositories were found under this scan location.'}
            return Start-GitJob @{action='bulk-fetch';path=$root;repositories=@($targets)} "Bulk Fetch queued for $($targets.Count) repositories."
        }
        'refresh-repos' {
            $active = Get-ActiveGitJob 'refresh-repos'
            if ($active) { return @{async=$true;jobId=[string]$active.id;action='refresh-repos';message='Repository status refresh is already running.'} }
            $targets = @(Get-Repositories)
            return Start-GitJob @{action='refresh-repos';repositories=@($targets);cachePath=$script:RepoCache} "Checking $($targets.Count) repositories in the background."
        }
        'smart-fetch' {
            $active=Get-ActiveGitJob 'bulk-fetch';if($active){return @{async=$true;jobId=[string]$active.id;action='bulk-fetch';message='Smart Fetch is already running.'}}
            $targets=New-Object 'System.Collections.Generic.List[string]'
            foreach($candidate in @($Body.repositories)){
                $repoPath=([string]$candidate).Trim();if(-not $repoPath){continue};Assert-Registered $repoPath
                if(-not($targets|Where-Object{[string]::Equals($_,$repoPath,[StringComparison]::OrdinalIgnoreCase)})){$targets.Add($repoPath)}
            }
            if(-not $targets.Count){throw 'Smart Fetch has no matching repositories.'}
            if($targets.Count -gt 50){throw 'Smart Fetch is limited to 50 repositories per run.'}
            return Start-GitJob @{action='bulk-fetch';path='Smart Fetch';repositories=@($targets)} "Smart Fetch queued for $($targets.Count) repositories."
        }
        'add' {
            if (-not $path) { throw 'Repository folder is required.' }
            $saved = Add-Repository $path
            return @{ message='Repository added.'; output=$saved }
        }
        'create' {
            if(-not $path){throw 'Destination folder is required.'}
            $destination=[IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($path)).TrimEnd('\')
            $name=([string]$Body.name).Trim();if(-not $name){$name=Split-Path $destination -Leaf};if(-not $name -or $name -match '[<>:"/\\|?*\x00-\x1f]' -or $name -in @('.','..')){throw 'Invalid repository name.'}
            $defaultBranch=([string]$Body.defaultBranch).Trim();if(-not $defaultBranch){$defaultBranch='main'}
            $parent=Split-Path -Parent $destination;if(-not (Test-Path -LiteralPath $parent -PathType Container)){throw 'Destination parent folder does not exist.'}
            $branchCheck=Invoke-GitCapture $parent @('check-ref-format','--branch',$defaultBranch);if($branchCheck.Code -ne 0){throw 'Invalid default branch name.'}
            if((Test-Path -LiteralPath $destination) -and @(Get-ChildItem -LiteralPath $destination -Force -ErrorAction Stop).Count -gt 0){throw 'Destination exists and is not empty.'}
            $init=Invoke-GitCapture $parent @('init','-b',$defaultBranch,$destination);if($init.Code -ne 0){$init=Invoke-GitCapture $parent @('init',$destination);if($init.Code -ne 0){throw $init.Output};[void](Invoke-GitOrThrow $destination @('symbolic-ref','HEAD',('refs/heads/'+$defaultBranch)))}
            if([bool]$Body.readme){[IO.File]::WriteAllText((Join-Path $destination 'README.md'),("# $name`r`n"),(New-Object Text.UTF8Encoding($false)))}
            $template=([string]$Body.gitignoreTemplate).Trim().ToLowerInvariant();$ignore=''
            if($template -eq 'node'){$ignore="node_modules/`r`n.next/`r`ndist/`r`ncoverage/`r`n.env*`r`n!.env.example`r`n*.log`r`n"}
            elseif($template -eq 'java'){$ignore="target/`r`n.gradle/`r`nbuild/`r`n*.class`r`n*.jar`r`n.idea/`r`n*.iml`r`n"}
            elseif($template -eq 'dotnet'){$ignore="bin/`r`nobj/`r`n.vs/`r`n*.user`r`n*.suo`r`nTestResults/`r`n"}
            elseif($template -eq 'python'){$ignore="__pycache__/`r`n*.py[cod]`r`n.venv/`r`nvenv/`r`n.pytest_cache/`r`n.env`r`n"}
            elseif($template -and $template -ne 'none'){throw 'Unknown .gitignore template.'}
            if($ignore){[IO.File]::WriteAllText((Join-Path $destination '.gitignore'),$ignore,(New-Object Text.UTF8Encoding($false)))}
            $saved=Add-Repository $destination;return @{message="Repository $name created on branch $defaultBranch.";output="Initialized $saved`r`nReview README/.gitignore, then create the first commit.";path=$saved}
        }
        'clone' {
            $url = [string]$Body.url
            if (-not $url -or -not $path) { throw 'Remote URL and destination folder are required.' }
            $destination = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($path)).TrimEnd('\')
            if ((Test-Path -LiteralPath $destination) -and @(Get-ChildItem -LiteralPath $destination -Force).Count -gt 0) { throw 'Destination exists and is not empty.' }
            $parent = Split-Path -Parent $destination
            if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw 'Destination parent folder does not exist.' }
            return Start-GitJob @{action='clone';path=$destination;url=$url;repoList=$script:RepoList} 'Clone queued. Git Deck remains available while it runs.'
        }
        'cancel-job' {
            return Stop-GitJob ([string]$Body.jobId)
        }
        'remove' {
            $remaining = @(Get-Repositories | Where-Object { -not [string]::Equals($_,$path,[StringComparison]::OrdinalIgnoreCase) })
            Save-Repositories $remaining
            return @{ message='Removed from saved list. Repository files were not changed.' }
        }
        'shell-register' {
            $exe=Join-Path $script:Root 'GitDeck.exe';if(-not (Test-Path -LiteralPath $exe -PathType Leaf)){throw 'GitDeck.exe was not found. Build the Windows launcher first.'}
            foreach($key in @('HKCU:\Software\Classes\Directory\shell\GitDeck','HKCU:\Software\Classes\Directory\Background\shell\GitDeck')){[void](New-Item -Path $key -Force);Set-Item -Path $key -Value 'Open in Git Deck';New-ItemProperty -Path $key -Name 'Icon' -Value $exe -PropertyType String -Force|Out-Null;$command=Join-Path $key 'command';[void](New-Item -Path $command -Force);$argument=if($key -like '*Background*'){'%V'}else{'%1'};Set-Item -Path $command -Value ('"'+$exe+'" "'+$argument+'"')}
            return @{message='Explorer context menu installed for the current Windows user.';output='Right-click a folder or folder background -> Open in Git Deck'}
        }
        'shell-unregister' {
            foreach($key in @('HKCU:\Software\Classes\Directory\shell\GitDeck','HKCU:\Software\Classes\Directory\Background\shell\GitDeck')){if(Test-Path $key){Remove-Item -LiteralPath $key -Recurse -Force}}
            return @{message='Explorer context menu removed.';output='Git Deck application files were not removed.'}
        }
        # The custom actions list belongs to Git Deck, not to one repository.
        'custom-actions-save' { return Save-GitDeckCustomActions $Body.actions }
        default { Assert-Registered $path }
    }
    switch ($action) {
        'open-folder' { Start-Process explorer.exe -ArgumentList ('"'+$path+'"'); return @{message='Folder opened.'} }
        'open-working-file' {
            $file=[string]$Body.file;Assert-WorkingFile $path $file;$full=[IO.Path]::GetFullPath((Join-Path $path $file));Start-Process -FilePath $full;return @{message="Opened $file."}
        }
        'reveal-working-file' {
            $file=[string]$Body.file;Assert-WorkingFile $path $file;$full=[IO.Path]::GetFullPath((Join-Path $path $file));Start-Process explorer.exe -ArgumentList @('/select,',('"'+$full+'"'));return @{message="Revealed $file in Explorer."}
        }
        'open-terminal' {
            $terminal = Get-Command wt.exe -ErrorAction SilentlyContinue
            if ($terminal) { Start-Process $terminal.Source -ArgumentList @('-d',('"'+$path+'"')) } else { Start-Process powershell.exe -WorkingDirectory $path }
            return @{message='Terminal opened.'}
        }
        'open-code' {
            $code = Get-Command code.cmd -ErrorAction SilentlyContinue
            if (-not $code) { throw 'VS Code command was not found.' }
            Start-Process $code.Source -ArgumentList ('"'+$path+'"'); return @{message='VS Code opened.'}
        }
        'open-remote' {
            $remote = Get-OriginUrl $path; if (-not $remote) { throw 'origin is not configured.' }
            $webUrl = ConvertTo-WebUrl $remote; if (-not $webUrl) { throw 'Remote URL cannot be opened in a browser.' }
            Start-Process $webUrl; return @{message='Remote URL opened.';output=$webUrl}
        }
        'status' {
            $result = Invoke-GitCapture $path @('status','--short','--branch')
            if ($result.Code -ne 0) { throw $result.Output }
            return @{message='Status refreshed.';output=$result.Output}
        }
        'journal-recovery-branch' {
            $entry=Get-ActionJournalEntry $path ([string]$Body.id);if(-not $entry.beforeHead){throw 'This journal entry has no recoverable commit.'}
            $name=([string]$Body.branch).Trim();Assert-BranchName $path $name;$output=Invoke-GitOrThrow $path @('branch',$name,[string]$entry.beforeHead)
            return @{message="Recovery branch $name created without moving HEAD.";output=$(if($output){$output}else{"$name -> $($entry.beforeHead)"})}
        }
        'journal-restore-head' {
            $entry=Get-ActionJournalEntry $path ([string]$Body.id);Assert-CleanWorkingTree $path 'Commit or stash changes before restoring HEAD.';$current=Get-GitSnapshot $path
            if($current.head -ne [string]$entry.afterHead -or $current.branch -ne [string]$entry.afterBranch){throw 'Current HEAD no longer matches the state immediately after this action. Create a recovery branch instead so newer work is not overwritten.'}
            if($entry.beforeBranch -and $entry.beforeBranch -ne $entry.afterBranch){$exists=Invoke-GitCapture $path @('show-ref','--verify','--quiet',('refs/heads/'+[string]$entry.beforeBranch));if($exists.Code -ne 0){throw 'The previous branch no longer exists. Create a recovery branch instead.'};$output=Invoke-GitOrThrow $path @('switch',[string]$entry.beforeBranch)}else{$output=Invoke-GitOrThrow $path @('reset','--hard',[string]$entry.beforeHead)}
            return @{message="Restored the state before $($entry.action).";output=$(if($output){$output}else{"HEAD -> $($entry.beforeHead)"})}
        }
        'conflict-resolve' {
            $file=[string]$Body.file;$mode=([string]$Body.mode).Trim();$operation=Get-GitOperationState $path
            # Any unmerged file can be resolved, also after a stash restore (no merge/rebase in progress).
            if(-not ($operation.conflicts -contains $file)){throw 'File is not an active merge conflict.'}
            if($mode -notin @('ours','theirs','both','manual')){throw 'Invalid conflict resolution mode.'}
            if($mode -in @('ours','theirs')){[void](Invoke-GitOrThrow $path @('checkout',('--'+$mode),'--',$file))}
            else{
                $root=[IO.Path]::GetFullPath($path).TrimEnd('\')+'\';$full=[IO.Path]::GetFullPath((Join-Path $path $file));if(-not $full.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid conflicted file path.'}
                if($mode -eq 'both'){$details=Get-ConflictDetails $path $file;$content=$details.ours+"`r`n"+$details.theirs}else{$content=[string]$Body.content}
                if($content.Length -gt 1000000){throw 'Resolved content is larger than 1 MB.'};[IO.File]::WriteAllText($full,$content,(New-Object Text.UTF8Encoding($false)))
            }
            [void](Invoke-GitOrThrow $path @('add','--',$file));return @{message="$file resolved with $mode and staged.";output="Resolved and staged: $file"}
        }
        'worktree-add' {
            $destination=([string]$Body.destination).Trim();$branch=([string]$Body.branch).Trim();$create=[bool]$Body.create
            if(-not $destination -or -not [IO.Path]::IsPathRooted($destination)){throw 'An absolute destination folder is required.'};$destination=[IO.Path]::GetFullPath($destination).TrimEnd('\')
            $parent=Split-Path -Parent $destination;if(-not (Test-Path -LiteralPath $parent -PathType Container)){throw 'Worktree parent folder does not exist.'};if((Test-Path -LiteralPath $destination) -and @(Get-ChildItem -LiteralPath $destination -Force -ErrorAction SilentlyContinue).Count){throw 'Worktree destination is not empty.'}
            if($create){Assert-BranchName $path $branch;$exists=Invoke-GitCapture $path @('show-ref','--verify','--quiet',('refs/heads/'+$branch));if($exists.Code -eq 0){throw "Local branch $branch already exists."};$start=([string]$Body.start).Trim();if(-not $start){$start='HEAD'};[void](Resolve-GitRef $path $start);$output=Invoke-GitOrThrow $path @('worktree','add','-b',$branch,$destination,$start)}
            else{Assert-BranchName $path $branch;$exists=Invoke-GitCapture $path @('show-ref','--verify','--quiet',('refs/heads/'+$branch));if($exists.Code -ne 0){throw 'Existing local branch was not found.'};$output=Invoke-GitOrThrow $path @('worktree','add',$destination,$branch)}
            [void](Add-Repository $destination);return @{message="Worktree created at $destination.";output=$output}
        }
        'worktree-remove' {
            $destination=([string]$Body.destination).Trim();$worktrees=@(Get-Worktrees $path);$item=$worktrees|Where-Object{[string]::Equals([string]$_.path,$destination,[StringComparison]::OrdinalIgnoreCase)}|Select-Object -First 1
            if(-not $item){throw 'Worktree was not found.'};if($item.isMain){throw 'The main working tree cannot be removed here.'}
            $output=Invoke-GitOrThrow $path @('worktree','remove',$item.path);$remaining=@(Get-Repositories|Where-Object{-not [string]::Equals($_,$item.path,[StringComparison]::OrdinalIgnoreCase)});Save-Repositories $remaining
            return @{message="Worktree removed: $($item.path).";output=$output}
        }
        'worktree-prune' { $output=Invoke-GitOrThrow $path @('worktree','prune','--verbose');return @{message='Stale worktree records pruned.';output=$(if($output){$output}else{'No stale worktrees.'})} }
        'patch-choose' {
            $selected=Select-PatchFile;if(-not $selected){throw 'Patch selection was cancelled.'};$script:SelectedPatch=$selected
            $check=Invoke-GitCapture $path @('apply','--check',$selected);return @{message=$(if($check.Code -eq 0){'Patch is ready to apply.'}else{'Patch cannot be applied cleanly.'});output=$check.Output;path=$selected;valid=($check.Code -eq 0)}
        }
        'patch-export' {
            $commit=([string]$Body.commit).Trim();Assert-CommitHash $path $commit;$short=(Invoke-GitOrThrow $path @('rev-parse','--short',$commit)).Trim();$repoName=(Split-Path $path -Leaf) -replace '[^A-Za-z0-9._-]','-';$outputPath=Resolve-ExportPath $Body 'Save patch' 'Git patch (*.patch)|*.patch|All files (*.*)|*.*' ($repoName+'-'+$short+'.patch')
            if(-not $outputPath){return @{message='Export cancelled.';cancelled=$true}}
            $patchText=Invoke-GitOrThrow $path @('format-patch','-1','--stdout',$commit);[IO.File]::WriteAllText($outputPath,$patchText,(New-Object Text.UTF8Encoding($false)));return @{message="Patch saved to $outputPath";output=$outputPath;path=$outputPath}
        }
        'patch-apply-file' {
            $selected=([string]$Body.patchPath).Trim();if(-not $selected -or -not [string]::Equals($selected,$script:SelectedPatch,[StringComparison]::OrdinalIgnoreCase)){throw 'Choose the patch file from Git Deck again.'};if(-not (Test-Path -LiteralPath $selected -PathType Leaf)){throw 'Patch file was not found.'};if((Get-Item -LiteralPath $selected).Length -gt 5000000){throw 'Patch file is larger than 5 MB.'}
            $check=Invoke-GitCapture $path @('apply','--check',$selected);if($check.Code -ne 0){throw $check.Output};$args=if([bool]$Body.stage){@('apply','--index',$selected)}else{@('apply',$selected)};$output=Invoke-GitOrThrow $path $args;$script:SelectedPatch='';return @{message='Patch applied successfully.';output=$(if($output){$output}else{$selected})}
        }
        'rebase-interactive' {
            $base=([string]$Body.base).Trim();$plan=Get-InteractiveRebasePlan $path $base;$expected=@($plan.commits|ForEach-Object{$_.fullHash});$steps=@($Body.steps)
            if(-not $expected.Count){throw 'There are no commits to rebase.'};if($steps.Count -ne $expected.Count){throw 'Interactive rebase plan does not include every commit.'}
            $seen=New-Object 'System.Collections.Generic.List[string]';$lines=New-Object 'System.Collections.Generic.List[string]';$firstKept=$true
            foreach($step in $steps){$hash=[string]$step.hash;$action=([string]$step.action).Trim();if($action -notin @('pick','squash','fixup','drop')){throw 'Unsupported rebase action.'};if(-not ($expected -contains $hash) -or $seen.Contains($hash)){throw 'Interactive rebase plan contains an invalid or duplicate commit.'};$seen.Add($hash)
                if($firstKept -and $action -in @('squash','fixup')){throw 'The first kept commit cannot be squash or fixup.'};if($action -ne 'drop'){$firstKept=$false};$subject=(@($plan.commits|Where-Object{$_.fullHash -eq $hash})[0].subject -replace "[`r`n]",' ');$lines.Add("$action $hash $subject")}
            Assert-CleanWorkingTree $path 'Commit or stash changes before interactive rebase.';$planFile=Join-Path ([IO.Path]::GetTempPath()) ('git-deck-rebase-'+[Guid]::NewGuid().ToString()+'.txt');$editorFile=$planFile+'.cmd'
            try{[IO.File]::WriteAllLines($planFile,$lines,(New-Object Text.UTF8Encoding($false)));[IO.File]::WriteAllText($editorFile,("@echo off`r`ncopy /Y `"$planFile`" `"%~1`" >nul`r`n"),(New-Object Text.ASCIIEncoding));$oldEditor=$env:GIT_SEQUENCE_EDITOR;$env:GIT_SEQUENCE_EDITOR='"'+$editorFile+'"';$result=Invoke-GitCapture $path @('rebase','-i',$plan.baseHash)}finally{$env:GIT_SEQUENCE_EDITOR=$oldEditor;Remove-Item -LiteralPath $planFile,$editorFile -Force -ErrorAction SilentlyContinue}
            if($result.Code -ne 0){$operation=Get-GitOperationState $path;if($operation.active){throw "Interactive rebase paused. Resolve conflicts in Conflict Center, then Continue or Abort.`n$($result.Output)"};throw $result.Output};return @{message='Interactive rebase completed.';output=$result.Output}
        }
        'fetch' {
            $active=Get-ActiveRepoJob 'fetch' $path;if($active){return @{async=$true;jobId=[string]$active.id;action='fetch';message='Fetch is already running for this repository.'}}
            return Start-GitJob @{action='fetch';path=$path} 'Fetch queued. You can keep using Git Deck.'
        }
        'stage-file' {
            $file=[string]$Body.file;Assert-WorkingFile $path $file
            $output=Invoke-GitOrThrow $path @('add','--',$file)
            return @{message="Staged $file.";output=$(if($output){$output}else{"Staged: $file"})}
        }
        'files-bulk' {
            $mode=([string]$Body.mode).Trim();if($mode -notin @('stage','unstage','discard')){throw 'Invalid bulk file operation.'};$files=@($Body.files|ForEach-Object{([string]$_).Trim()}|Where-Object{$_}|Select-Object -Unique);if(-not $files.Count){throw 'Select at least one file.'};if($files.Count -gt 500){throw 'Too many files selected.'}
            foreach($file in $files){Assert-WorkingFile $path $file;if($mode -eq 'discard'){$status=(Invoke-GitCapture $path @('status','--porcelain=v1','--',$file)).Output;if($status.StartsWith('??')){throw "Untracked file cannot be discarded by Git Deck: $file"}}}
            foreach($file in $files){if($mode -eq 'stage'){[void](Invoke-GitOrThrow $path @('add','--',$file))}elseif($mode -eq 'unstage'){$result=Invoke-GitCapture $path @('restore','--staged','--',$file);if($result.Code -ne 0){$result=Invoke-GitCapture $path @('reset','HEAD','--',$file)};if($result.Code -ne 0){throw $result.Output}}else{[void](Invoke-GitOrThrow $path @('restore','--source=HEAD','--staged','--worktree','--',$file))}}
            return @{message="$mode completed for $($files.Count) files.";output=($files -join "`r`n")}
        }
        'discard-file' {
            $file=[string]$Body.file;Assert-WorkingFile $path $file
            $status=(Invoke-GitCapture $path @('status','--porcelain=v1','--',$file)).Output
            if($status.StartsWith('??')){throw 'Untracked files are not deleted by Git Deck. Delete it from Explorer or VS Code.'}
            $output=Invoke-GitOrThrow $path @('restore','--source=HEAD','--staged','--worktree','--',$file)
            return @{message="Discarded tracked changes in $file.";output=$(if($output){$output}else{"Restored: $file"})}
        }
        'apply-patch' {
            $patch=[string]$Body.patch;$mode=([string]$Body.mode).Trim()
            if($mode -notin @('stage','unstage','discard')){throw 'Invalid patch operation.'}
            $output=if($mode -eq 'stage'){Invoke-GitPatch $path $patch $true $false}elseif($mode -eq 'unstage'){Invoke-GitPatch $path $patch $true $true}else{Invoke-GitPatch $path $patch $false $true}
            return @{message="Patch $mode completed.";output=$(if($output){$output}else{"Selected hunk was $mode successfully."})}
        }
        'unstage-file' {
            $file=[string]$Body.file;Assert-WorkingFile $path $file
            $result=Invoke-GitCapture $path @('restore','--staged','--',$file)
            if($result.Code -ne 0){$result=Invoke-GitCapture $path @('reset','HEAD','--',$file)}
            if($result.Code -ne 0){throw $result.Output}
            return @{message="Unstaged $file. Working file was kept.";output=$(if($result.Output){$result.Output}else{"Unstaged: $file"})}
        }
        'stage-all' {
            $output=Invoke-GitDeckStageAll $path
            return @{message='All working changes staged. Generated IntelliJ files were protected.';output=$(if($output){$output}else{'All visible changes staged; .idea and *.iml stayed untracked.'})}
        }
        'unstage-all' {
            $output=Invoke-GitOrThrow $path @('reset')
            return @{message='All files unstaged. Working files were kept.';output=$(if($output){$output}else{'All files unstaged.'})}
        }
        'pull' {
            return Invoke-GitDeckPull $path ([string]$Body.strategy).Trim() ([bool]$Body.autostash)
        }
        'pull-ref' {
            $remoteName=([string]$Body.remote).Trim();$branchName=([string]$Body.branch).Trim()
            if(-not $remoteName -or -not $branchName){throw 'Remote and branch are required.'}
            return Invoke-GitDeckPull $path ([string]$Body.strategy).Trim() ([bool]$Body.autostash) $remoteName $branchName
        }
        'push' {
            $branch = (Invoke-GitOrThrow $path @('branch','--show-current')).Trim()
            if (-not $branch) { throw 'Cannot push from detached HEAD.' }
            $upstream = Invoke-GitCapture $path @('rev-parse','--abbrev-ref','--symbolic-full-name','@{u}')
            if ($upstream.Code -eq 0) { $output = Invoke-GitOrThrow $path @('push') }
            else {
                if (-not (Get-OriginUrl $path)) { throw 'origin is not configured.' }
                $output = Invoke-GitOrThrow $path @('push','-u','origin',$branch)
            }
            return @{message='Push completed.';output=$(if($output){$output}else{'Push completed.'})}
        }
        'push-selection' {
            $remote=([string]$Body.remote).Trim();Assert-RemoteName $path $remote;$items=@($Body.branches);$pushTags=[bool]$Body.pushTags;$forceWithLease=[bool]$Body.forceWithLease
            if(-not $items.Count -and -not $pushTags){throw 'Select at least one branch or Push all tags.'};if($items.Count -gt 50){throw 'At most 50 branches can be pushed at once.'}
            $validated=New-Object 'System.Collections.Generic.List[object]'
            foreach($item in $items){$local=([string]$item.local).Trim();$remoteBranch=([string]$item.remote).Trim();$track=[bool]$item.track;Assert-BranchName $path $local;Assert-BranchName $path $remoteBranch;$exists=Invoke-GitCapture $path @('show-ref','--verify','--quiet',('refs/heads/'+$local));if($exists.Code -ne 0){throw "Local branch was not found: $local"};$validated.Add([ordered]@{local=$local;remote=$remoteBranch;track=$track})}
            $outputs=New-Object 'System.Collections.Generic.List[string]';$completed=0
            foreach($item in $validated){$args=New-Object 'System.Collections.Generic.List[string]';$args.Add('push');if($forceWithLease){$args.Add('--force-with-lease')};if($item.track){$args.Add('--set-upstream')};$args.Add($remote);$args.Add("$($item.local):refs/heads/$($item.remote)");$result=Invoke-GitCapture $path $args.ToArray();if($result.Code -ne 0){$prefix=if($completed){"$completed branch(es) were pushed before this failure.`n"}else{''};throw "$prefix$($result.Output)"};$completed++;$outputs.Add($(if($result.Output){$result.Output}else{"Pushed $($item.local) -> $remote/$($item.remote)"}))}
            if($pushTags){$args=@('push');if($forceWithLease){$args+=@('--force-with-lease')};$args+=@($remote,'--tags');$tagResult=Invoke-GitCapture $path $args;if($tagResult.Code -ne 0){$prefix=if($completed){"Branches completed, but tags failed.`n"}else{''};throw "$prefix$($tagResult.Output)"};$outputs.Add($(if($tagResult.Output){$tagResult.Output}else{"Pushed tags to $remote"}))}
            $summary=@();if($completed){$summary+="$completed branch(es)"};if($pushTags){$summary+='all tags'};return @{message=('Pushed '+($summary -join ' and ')+' to '+$remote+'.');output=($outputs -join "`r`n")}
        }
        'commit' {
            $message = ([string]$Body.message).Trim()
            if (-not $message) { throw 'Commit message is required.' }
            if ($message.Length -gt 500) { throw 'Commit message is too long.' }
            $amend=[bool]$Body.amend
            $status = Invoke-GitCapture $path @('status','--porcelain')
            $visibleStatus = @(Get-GitDeckVisibleStatusLines $status.Output)
            if (-not $visibleStatus.Count -and -not $amend) { throw 'There are no visible changes to commit. Generated IntelliJ files are protected.' }
            $staged=Invoke-GitCapture $path @('diff','--cached','--quiet')
            if($staged.Code -notin @(0,1)){throw 'Unable to verify staged changes. Nothing was committed.'}
            if($staged.Code -eq 0 -and -not $amend){throw 'No staged changes. Review and stage files before committing.'}
            if($amend){$output=Invoke-GitOrThrow $path @('commit','--amend','-m',$message);return @{message='Latest commit amended locally. Nothing was pushed.';output=$output}}
            $output = Invoke-GitOrThrow $path @('commit','-m',$message)
            return @{message='Changes committed locally. Staged files were used when present; nothing was pushed.';output=$output}
        }
        'branch-create' {
            $branchName = ([string]$Body.branch).Trim()
            Assert-BranchName $path $branchName
            # A new branch starts at HEAD, so uncommitted changes simply come along (as in plain git).
            if ((Get-GitOperationState $path).active) { throw 'Finish or abort the merge, rebase or cherry-pick in progress first.' }
            $output = Invoke-GitOrThrow $path @('switch','-c',$branchName)
            return @{message="Created and switched to $branchName.";output=$output}
        }
        'checkout-commit' {
            $commit=([string]$Body.commit).Trim();Assert-CommitHash $path $commit
            $result=Invoke-GitDeckSwitch $path @('--detach',$commit) ([string]$Body.localChanges) ($commit.Substring(0,[Math]::Min(8,$commit.Length))+' (detached HEAD)')
            return $result
        }
        'branch-push' {
            $branchName=([string]$Body.branch).Trim();$remote=([string]$Body.remote).Trim();Assert-BranchName $path $branchName;if(-not $remote){$remote='origin'};Assert-RemoteName $path $remote
            $exists=Invoke-GitCapture $path @('show-ref','--verify','--quiet',('refs/heads/'+$branchName));if($exists.Code -ne 0){throw 'Local branch was not found.'}
            $output=Invoke-GitOrThrow $path @('push','-u',$remote,$branchName)
            return @{message="Pushed $branchName to $remote.";output=$(if($output){$output}else{"Pushed $remote/$branchName"})}
        }
        'branch-create-at' {
            $branchName=([string]$Body.branch).Trim();$commit=([string]$Body.commit).Trim();Assert-BranchName $path $branchName
            # A branch or tag name (menus, Git-flow) is resolved to its commit first.
            if($commit -and $commit -notmatch '^[0-9a-fA-F]{4,40}$'){$commit=Resolve-GitRef $path $commit}
            Assert-CommitHash $path $commit
            $exists=Invoke-GitCapture $path @('show-ref','--verify','--quiet',('refs/heads/'+$branchName));if($exists.Code -eq 0){throw "Local branch $branchName already exists."}
            $output=Invoke-GitOrThrow $path @('branch',$branchName,$commit)
            return @{message="Recovery branch $branchName created at $commit. Current branch was not changed.";output=$(if($output){$output}else{"Created $branchName at $commit"})}
        }
        'branch-switch' {
            $branchName = ([string]$Body.branch).Trim()
            Assert-BranchName $path $branchName
            $exists = Invoke-GitCapture $path @('show-ref','--verify','--quiet',('refs/heads/'+$branchName))
            if ($exists.Code -ne 0) { throw 'Local branch was not found.' }
            return Invoke-GitDeckSwitch $path @($branchName) ([string]$Body.localChanges) $branchName
        }
        'branch-track' {
            $remoteBranch = ([string]$Body.branch).Trim()
            if ($remoteBranch -notmatch '^[A-Za-z0-9._/-]+$' -or $remoteBranch -notmatch '/') { throw 'Invalid remote branch.' }
            $exists = Invoke-GitCapture $path @('show-ref','--verify','--quiet',('refs/remotes/'+$remoteBranch))
            if ($exists.Code -ne 0) { throw 'Remote branch was not found. Fetch first.' }
            $localName = $remoteBranch.Substring($remoteBranch.IndexOf('/')+1)
            Assert-BranchName $path $localName
            $localExists = Invoke-GitCapture $path @('show-ref','--verify','--quiet',('refs/heads/'+$localName))
            if ($localExists.Code -eq 0) { throw "Local branch $localName already exists. Switch to it from Local branches." }
            $result = Invoke-GitDeckSwitch $path @('--track',$remoteBranch) ([string]$Body.localChanges) "$localName (tracking $remoteBranch)"
            $result.message = $result.message -replace '^Switched to ', 'Created and switched to '
            return $result
        }
        'branch-rename' {
            $old=([string]$Body.branch).Trim();$new=([string]$Body.newName).Trim();Assert-BranchName $path $old;Assert-BranchName $path $new
            $exists=Invoke-GitCapture $path @('show-ref','--verify','--quiet',('refs/heads/'+$old));if($exists.Code -ne 0){throw 'Local branch was not found.'}
            $output=Invoke-GitOrThrow $path @('branch','-m',$old,$new)
            return @{message="Renamed branch $old to $new.";output=$output}
        }
        'branch-delete' {
            $branchName=([string]$Body.branch).Trim();$force=[bool]$Body.force;Assert-BranchName $path $branchName
            $current=(Invoke-GitOrThrow $path @('branch','--show-current')).Trim();if($branchName -eq $current){throw 'Switch away before deleting the current branch.'}
            $output=Invoke-GitOrThrow $path @('branch',$(if($force){'-D'}else{'-d'}),$branchName)
            return @{message="Deleted local branch $branchName.";output=$output}
        }
        'branch-delete-remote' {
            $remote=([string]$Body.remote).Trim();$branchName=([string]$Body.branch).Trim();Assert-RemoteName $path $remote;Assert-BranchName $path $branchName
            $output=Invoke-GitOrThrow $path @('push',$remote,'--delete',$branchName)
            return @{message="Deleted $remote/$branchName from remote.";output=$output}
        }
        'branch-set-upstream' {
            $branchName=([string]$Body.branch).Trim();$upstream=([string]$Body.upstream).Trim();Assert-BranchName $path $branchName
            if($upstream -notmatch '^[A-Za-z0-9._/-]+/[A-Za-z0-9._/-]+$'){throw 'Invalid upstream branch.'}
            $output=Invoke-GitOrThrow $path @('branch','--set-upstream-to',$upstream,$branchName)
            return @{message="Set $branchName to track $upstream.";output=$output}
        }
        'branch-unset-upstream' {
            $branchName=([string]$Body.branch).Trim();Assert-BranchName $path $branchName
            $output=Invoke-GitOrThrow $path @('branch','--unset-upstream',$branchName);return @{message="Removed upstream from $branchName.";output=$output}
        }
        'merge' {
            $branchName = ([string]$Body.branch).Trim()
            if (-not $branchName) { throw 'Branch to merge is required.' }
            Assert-CleanWorkingTree $path 'Commit or stash changes before merging.'
            $exists = Invoke-GitCapture $path @('rev-parse','--verify',($branchName+'^{commit}'))
            if ($exists.Code -ne 0) { throw 'Branch or commit was not found.' }
            $mode=([string]$Body.mode).Trim();if(-not $mode){$mode='default'};if($mode -notin @('default','no-ff','squash','no-commit')){throw 'Invalid merge option.'}
            $args=New-Object 'System.Collections.Generic.List[string]';$args.Add('merge');$args.Add('--no-edit');if($mode -eq 'no-ff'){$args.Add('--no-ff')}elseif($mode -eq 'squash'){$args.Add('--squash')}elseif($mode -eq 'no-commit'){$args.Add('--no-commit')};$args.Add($branchName)
            $result=Invoke-GitCapture $path $args.ToArray();if($result.Code -ne 0){$operation=Get-GitOperationState $path;if($operation.active){throw "Merge needs attention. Resolve conflicts in Safety Center, then Continue or Abort.`n$($result.Output)"};throw $result.Output}
            return @{message="Merged $branchName into the current branch using $mode.";output=$result.Output}
        }
        'rebase-start' {
            $target=([string]$Body.branch).Trim();if(-not $target){throw 'Rebase target is required.'};Assert-CleanWorkingTree $path 'Commit or stash changes before rebasing.'
            $check=Invoke-GitCapture $path @('rev-parse','--verify',($target+'^{commit}'));if($check.Code -ne 0){throw 'Rebase target was not found.'}
            $result=Invoke-GitCapture $path @('rebase',$target);if($result.Code -ne 0){$operation=Get-GitOperationState $path;if($operation.active){throw "Rebase paused for conflicts. Resolve them in Safety Center.`n$($result.Output)"};throw $result.Output}
            return @{message="Rebased current branch onto $target.";output=$result.Output}
        }
        'stash-save' {
            $status = Invoke-GitCapture $path @('status','--porcelain')
            if (-not $status.Output) { throw 'There are no changes to stash.' }
            $message = ([string]$Body.message).Trim(); if (-not $message) { $message='Git Deck stash' }
            # keepIndex (Sourcetree: "Keep staged changes"): staged changes stay staged in the working tree too.
            $arguments = @('stash','push','-u'); if ([bool]$Body.keepIndex) { $arguments += '--keep-index' }
            $output = Invoke-GitOrThrow $path ($arguments + @('-m',$message))
            $kept = if ([bool]$Body.keepIndex) { ' Staged changes were kept.' } else { '' }
            return @{message="Changes saved to stash, including untracked files.$kept";output=$output}
        }
        'stash-pop' {
            # Like Sourcetree, a stash can be applied onto uncommitted work; git refuses if it would overwrite it.
            $stashRef = ([string]$Body.stash).Trim();Assert-StashRef $stashRef
            return Invoke-GitDeckStashRestore $path 'pop' $stashRef
        }
        'stash-apply' {
            $stashRef=([string]$Body.stash).Trim();Assert-StashRef $stashRef
            return Invoke-GitDeckStashRestore $path 'apply' $stashRef
        }
        'stash-drop' {
            $stashRef=([string]$Body.stash).Trim();Assert-StashRef $stashRef;$output=Invoke-GitOrThrow $path @('stash','drop',$stashRef);return @{message="$stashRef deleted.";output=$output}
        }
        'operation-continue' {
            $operation=Get-GitOperationState $path;if(-not $operation.active){throw 'There is no Git operation to continue.'};if($operation.conflicts.Count){throw 'Resolve and stage every conflicted file before continuing.'}
            $args=if($operation.type -eq 'merge'){@('commit','--no-edit')}elseif($operation.type -eq 'rebase'){@('-c','core.editor=true','rebase','--continue')}elseif($operation.type -eq 'cherry-pick'){@('cherry-pick','--continue')}else{@('revert','--continue')}
            $output=Invoke-GitOrThrow $path $args;return @{message="$($operation.type) continued successfully.";output=$output}
        }
        'operation-abort' {
            $operation=Get-GitOperationState $path;if(-not $operation.active){throw 'There is no Git operation to abort.'}
            $args=if($operation.type -eq 'merge'){@('merge','--abort')}elseif($operation.type -eq 'rebase'){@('rebase','--abort')}elseif($operation.type -eq 'cherry-pick'){@('cherry-pick','--abort')}else{@('revert','--abort')}
            $output=Invoke-GitOrThrow $path $args;return @{message="$($operation.type) aborted. Working tree restored to the pre-operation state.";output=$output}
        }
        'reset-commit' {
            $commit=([string]$Body.commit).Trim();$mode=([string]$Body.mode).Trim();Assert-CommitHash $path $commit;if($mode -notin @('soft','mixed','hard')){throw 'Invalid reset mode.'}
            if($mode -eq 'hard'){Assert-CleanWorkingTree $path 'Discard or stash working changes before hard reset.'}
            $output=Invoke-GitOrThrow $path @('reset',('--'+$mode),$commit);return @{message="Reset current branch to $commit using $mode mode.";output=$output}
        }
        'remote-add' {
            $name=([string]$Body.remote).Trim();$url=([string]$Body.url).Trim();if($name -notmatch '^[A-Za-z0-9._-]+$'){throw 'Invalid remote name.'};if(-not $url){throw 'Remote URL is required.'}
            $exists=Invoke-GitCapture $path @('remote','get-url',$name);if($exists.Code -eq 0){throw "Remote $name already exists."}
            $output=Invoke-GitOrThrow $path @('remote','add',$name,$url);return @{message="Added remote $name.";output=$output}
        }
        'remote-update' {
            $name=([string]$Body.remote).Trim();$fetchUrl=([string]$Body.fetchUrl).Trim();$pushUrl=([string]$Body.pushUrl).Trim();Assert-RemoteName $path $name;if(-not $fetchUrl){throw 'Fetch URL is required.'}
            $lines=New-Object 'System.Collections.Generic.List[string]';$lines.Add((Invoke-GitOrThrow $path @('remote','set-url',$name,$fetchUrl)));if($pushUrl){$lines.Add((Invoke-GitOrThrow $path @('remote','set-url','--push',$name,$pushUrl)))}
            return @{message="Updated remote $name.";output=($lines|Where-Object{$_}) -join "`r`n"}
        }
        'remote-delete' {
            $name=([string]$Body.remote).Trim();Assert-RemoteName $path $name;$output=Invoke-GitOrThrow $path @('remote','remove',$name);return @{message="Removed remote $name. Remote repository data was not deleted.";output=$output}
        }
        'settings-save-identity' {
            $name=([string]$Body.name).Trim();$email=([string]$Body.email).Trim();if(-not $name){throw 'User name is required.'};if($email -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$'){throw 'Valid email is required.'}
            [void](Invoke-GitOrThrow $path @('config','--local','user.name',$name));[void](Invoke-GitOrThrow $path @('config','--local','user.email',$email));return @{message='Repository-specific Git identity saved.';output="$name <$email>"}
        }
        'settings-save-gitignore' {
            $content=[string]$Body.content;if($content.Length -gt 200000){throw '.gitignore is too large.'};$ignorePath=Join-Path $path '.gitignore';[IO.File]::WriteAllText($ignorePath,$content,(New-Object Text.UTF8Encoding($false)));return @{message='.gitignore saved. Review and commit it like any other file.';output=$ignorePath}
        }
        'submodule-update' {
            Assert-CleanWorkingTree $path 'Commit or stash changes before updating submodules.';return Start-GitJob @{action='submodule-update';path=$path} 'Submodule update queued. Git Deck remains available while it runs.'
        }
        'submodule-add' {
            Assert-CleanWorkingTree $path 'Commit or stash changes before adding a submodule.';$url=([string]$Body.url).Trim();$target=([string]$Body.target).Trim().Replace('\','/')
            if(-not $url -or $url.Length -gt 2000 -or $url.StartsWith('-') -or $url -match "[`r`n]" -or $url -notmatch '^(https?://|ssh://|git@[^:]+:)'){throw 'Use an HTTPS or SSH Git URL.'}
            if(-not $target -or $target.Length -gt 300 -or $target.StartsWith('-') -or [IO.Path]::IsPathRooted($target) -or $target -match '(^|/)\.\.(/|$)|[`r`n]'){throw 'Submodule path must stay inside the repository.'}
            $root=[IO.Path]::GetFullPath($path).TrimEnd('\')+'\';$full=[IO.Path]::GetFullPath((Join-Path $path $target));if(-not $full.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'Submodule path must stay inside the repository.'}
            return Start-GitJob @{action='submodule-add';path=$path;url=$url;target=$target} 'Submodule add queued. Authentication may be requested by Git.'
        }
        'lfs-pull' { Assert-CleanWorkingTree $path 'Commit or stash changes before Git LFS Pull.';return Start-GitJob @{action='lfs-pull';path=$path} 'Git LFS Pull queued.' }
        'lfs-prune' { return Start-GitJob @{action='lfs-prune';path=$path} 'Git LFS Prune queued.' }
        'lfs-track' {
            $pattern=([string]$Body.pattern).Trim();if(-not $pattern -or $pattern.Length -gt 200 -or $pattern.StartsWith('-') -or $pattern -match "[`r`n]"){throw 'Enter a valid LFS pattern, for example *.psd.'};$check=Invoke-GitCapture $path @('lfs','version');if($check.Code -ne 0){throw 'Git LFS is not installed.'};$output=Invoke-GitOrThrow $path @('lfs','track',$pattern);return @{message="Git LFS now tracks $pattern. Commit .gitattributes next.";output=$output}
        }
        'lfs-untrack' {
            $pattern=([string]$Body.pattern).Trim();if(-not $pattern -or $pattern.Length -gt 200 -or $pattern.StartsWith('-') -or $pattern -match "[`r`n]"){throw 'Choose a valid tracked LFS pattern.'};$check=Invoke-GitCapture $path @('lfs','version');if($check.Code -ne 0){throw 'Git LFS is not installed.'};$output=Invoke-GitOrThrow $path @('lfs','untrack',$pattern);return @{message="Git LFS stopped tracking $pattern. Existing LFS history was not rewritten.";output=$output}
        }
        'maintenance-gc' { return Start-GitJob @{action='maintenance-gc';path=$path} 'Repository optimization queued.' }
        'remote-prune-preview' {
            $remote=([string]$Body.remote).Trim();Assert-RemoteName $path $remote;$result=Invoke-GitCapture $path @('remote','prune','--dry-run',$remote);if($result.Code -ne 0){throw $result.Output};return @{message="Prune preview for $remote completed. Nothing was changed.";output=$(if($result.Output){$result.Output}else{'No stale remote-tracking branches.'})}
        }
        'remote-prune' {
            $remote=([string]$Body.remote).Trim();Assert-RemoteName $path $remote;return Start-GitJob @{action='remote-prune';path=$path;remote=$remote} "Remote prune queued for $remote."
        }
        'bisect-start' {
            Assert-CleanWorkingTree $path 'Commit or stash changes before starting Bisect.';$good=Resolve-GitRef $path ([string]$Body.good);$bad=Resolve-GitRef $path ([string]$Body.bad);if($good -eq $bad){throw 'Good and bad revisions must be different.'};$active=Invoke-GitCapture $path @('bisect','log');if($active.Code -eq 0){throw 'A Bisect session is already active.'};$output=Invoke-GitOrThrow $path @('bisect','start',$bad,$good);return @{message='Bisect started. Test the checked-out commit, then mark it Good or Bad.';output=$output}
        }
        'bisect-good' { $active=Invoke-GitCapture $path @('bisect','log');if($active.Code -ne 0){throw 'No Bisect session is active.'};$output=Invoke-GitOrThrow $path @('bisect','good');return @{message='Marked current commit good. Bisect moved to the next candidate.';output=$output} }
        'bisect-bad' { $active=Invoke-GitCapture $path @('bisect','log');if($active.Code -ne 0){throw 'No Bisect session is active.'};$output=Invoke-GitOrThrow $path @('bisect','bad');return @{message='Marked current commit bad. Bisect moved to the next candidate.';output=$output} }
        'bisect-reset' { $active=Invoke-GitCapture $path @('bisect','log');if($active.Code -ne 0){throw 'No Bisect session is active.'};$output=Invoke-GitOrThrow $path @('bisect','reset');return @{message='Bisect ended and the previous branch was restored.';output=$output} }
        'archive-export' {
            $ref=([string]$Body.ref).Trim();if(-not $ref){$ref='HEAD'};$hash=Resolve-GitRef $path $ref;$short=$hash.Substring(0,8);$repoName=(Split-Path $path -Leaf)-replace '[^A-Za-z0-9._-]','-';$outputPath=Resolve-ExportPath $Body 'Save archive' 'ZIP archive (*.zip)|*.zip|All files (*.*)|*.*' ($repoName+'-'+$short+'.zip');if(-not $outputPath){return @{message='Export cancelled.';cancelled=$true}}
            $output=Invoke-GitOrThrow $path @('archive','--format=zip',('--output='+$outputPath),$hash);return @{message="Archive saved to $outputPath";output=$outputPath;path=$outputPath}
        }
        'bundle-export' {
            $repoName=(Split-Path $path -Leaf)-replace '[^A-Za-z0-9._-]','-';$outputPath=Resolve-ExportPath $Body 'Save bundle' 'Git bundle (*.bundle)|*.bundle|All files (*.*)|*.*' ($repoName+'-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.bundle');if(-not $outputPath){return @{message='Export cancelled.';cancelled=$true}};return Start-GitJob @{action='bundle-export';path=$path;outputPath=$outputPath} 'Full repository bundle export queued.'
        }
        'tag-create' {
            $tagName = ([string]$Body.tag).Trim(); $message = ([string]$Body.message).Trim();$target=([string]$Body.commit).Trim();$lightweight=[bool]$Body.lightweight;$move=[bool]$Body.move;$pushTag=[bool]$Body.push;$remoteName=([string]$Body.remote).Trim()
            Assert-TagName $path $tagName
            if (-not $target) { $target='HEAD' } else { Assert-CommitHash $path $target }
            $targetCheck=Invoke-GitCapture $path @('cat-file','-e',($target+'^{commit}'));if($targetCheck.Code -ne 0){throw 'Specific commit was not found.'}
            $existing=Invoke-GitCapture $path @('show-ref','--verify','--quiet',('refs/tags/'+$tagName));if($existing.Code -eq 0 -and -not $move){throw "Tag $tagName already exists. Enable Move existing tag to replace it."}
            $args=New-Object 'System.Collections.Generic.List[string]';$args.Add('tag');if($move){$args.Add('-f')};if(-not $lightweight){if(-not $message){$message="Tag $tagName"};$args.Add('-a');$args.Add('-m');$args.Add($message)};$args.Add($tagName);$args.Add($target)
            $output=Invoke-GitOrThrow $path $args.ToArray()
            $pushOutput=''
            if($pushTag){Assert-RemoteName $path $remoteName;$pushArgs=@('push',$remoteName,('refs/tags/'+$tagName));if($move){$pushArgs=@('push','--force',$remoteName,('refs/tags/'+$tagName))};$pushResult=Invoke-GitCapture $path $pushArgs;if($pushResult.Code -ne 0){throw "Tag $tagName was saved locally, but push failed.`n$($pushResult.Output)"};$pushOutput=$pushResult.Output}
            return @{message=$(if($pushTag){"Tag $tagName created and pushed to $remoteName."}elseif($move){"Tag $tagName moved locally."}else{"Tag $tagName created locally. It was not pushed."});output=(($output,$pushOutput|Where-Object{$_}) -join "`r`n")}
        }
        'tag-push' {
            $tagName=([string]$Body.tag).Trim();$remoteName=([string]$Body.remote).Trim();Assert-TagName $path $tagName;Assert-RemoteName $path $remoteName
            $exists=Invoke-GitCapture $path @('show-ref','--verify','--quiet',('refs/tags/'+$tagName));if($exists.Code -ne 0){throw "Local tag $tagName was not found."}
            $output=Invoke-GitOrThrow $path @('push',$remoteName,('refs/tags/'+$tagName))
            return @{message="Tag $tagName pushed to $remoteName.";output=$output}
        }
        'tag-push-all' {
            $remoteName=([string]$Body.remote).Trim();Assert-RemoteName $path $remoteName
            $output=Invoke-GitOrThrow $path @('push',$remoteName,'--tags')
            return @{message="All local tags pushed to $remoteName.";output=$output}
        }
        'tag-delete' {
            $tagName=([string]$Body.tag).Trim();$deleteLocal=[bool]$Body.deleteLocal;$deleteRemote=[bool]$Body.deleteRemote;$remoteName=([string]$Body.remote).Trim();Assert-TagName $path $tagName
            if(-not $deleteLocal -and -not $deleteRemote){throw 'Choose local or remote tag deletion.'}
            $lines=New-Object 'System.Collections.Generic.List[string]'
            if($deleteRemote){Assert-RemoteName $path $remoteName;$remoteOutput=Invoke-GitOrThrow $path @('push',$remoteName,'--delete',$tagName);$lines.Add($(if($remoteOutput){$remoteOutput}else{"Deleted remote tag $tagName from $remoteName."}))}
            if($deleteLocal){$localOutput=Invoke-GitOrThrow $path @('tag','-d',$tagName);$lines.Add($(if($localOutput){$localOutput}else{"Deleted local tag $tagName."}))}
            return @{message="Tag $tagName removed from $(if($deleteLocal -and $deleteRemote){'local and remote'}elseif($deleteRemote){$remoteName}else{'local'}).";output=($lines -join "`r`n")}
        }
        'discard-tracked' {
            $status = Invoke-GitCapture $path @('status','--porcelain')
            if (-not $status.Output) { throw 'There are no changes to discard.' }
            $output = Invoke-GitOrThrow $path @('reset','--hard','HEAD')
            return @{message='Tracked and staged changes were discarded. Untracked files were kept.';output=$output}
        }
        'cherry-pick' {
            $commit=([string]$Body.commit).Trim();Assert-CommitHash $path $commit
            Assert-CleanWorkingTree $path 'Commit or stash changes before cherry-pick.'
            $result=Invoke-GitCapture $path @('cherry-pick',$commit)
            if($result.Code -ne 0){$operation=Get-GitOperationState $path;if($operation.active){throw "Cherry-pick paused for conflicts. Resolve them in Safety Center.`n$($result.Output)"};throw $result.Output}
            return @{message="Cherry-picked commit $commit.";output=$result.Output}
        }
        'cherry-pick-many' {
            Assert-CleanWorkingTree $path 'Commit or stash changes before cherry-picking commits.';$commits=@($Body.commits|ForEach-Object{([string]$_).Trim()}|Where-Object{$_});if(-not $commits.Count){throw 'Select at least one commit.'};if($commits.Count -gt 100){throw 'At most 100 commits can be cherry-picked together.'};foreach($commit in $commits){Assert-CommitHash $path $commit}
            $args=@('cherry-pick')+$commits;$result=Invoke-GitCapture $path $args;if($result.Code -ne 0){$operation=Get-GitOperationState $path;if($operation.active){throw "Cherry-pick paused. Resolve conflicts in Conflict Center, then Continue or Abort.`n$($result.Output)"};throw $result.Output};return @{message="$($commits.Count) commits cherry-picked.";output=$result.Output}
        }
        'revert-commit' {
            $commit=([string]$Body.commit).Trim();Assert-CommitHash $path $commit
            Assert-CleanWorkingTree $path 'Commit or stash changes before reverting a commit.'
            $result=Invoke-GitCapture $path @('revert','--no-edit',$commit)
            if($result.Code -ne 0){$operation=Get-GitOperationState $path;if($operation.active){throw "Revert paused for conflicts. Resolve them in Safety Center.`n$($result.Output)"};throw $result.Output}
            return @{message="Created a new commit reverting $commit.";output=$result.Output}
        }
        default {
            $feature = Invoke-GitDeckFeatureAction $Body
            if ($null -ne $feature) { return $feature }
            $parity = Invoke-GitDeckParityAction $Body
            if ($null -ne $parity) { return $parity }
            $ai = Invoke-GitDeckAiAction $Body
            if ($null -ne $ai) { return $ai }
            $custom = Invoke-GitDeckCustomActionRequest $Body
            if ($null -ne $custom) { return $custom }
            throw 'Action is not allowed.'
        }
    }
}

function Invoke-GitDeckRequest($context) {
    # Handles read-only GET routes, plus the slow read-only AI action when it is
    # handed over with a parsed Body. Runs on the main thread or in the pool.
    $request = $context.Request
    $route = $request.Url.AbsolutePath
    if ($context.Body) { Write-Json $context (Invoke-Action $context.Body); return }
    switch ($route) {
        '/api/health' { Write-Json $context @{status='ok'} }
        '/api/repo/status-snapshot' { Write-Json $context (Get-WorkflowStatus $request.QueryString['path']) }
        '/api/repo/checkout-review' { Write-Json $context (Get-CheckoutReview $request.QueryString['path'] $request.QueryString['target']) }
        '/api/readiness' { Write-Json $context (Get-SetupReadiness) }
        '/api/custom-actions' { Write-Json $context @{ actions = @(Get-GitDeckCustomActions) } }
        '/api/repo/push-preview' { Write-Json $context (Get-PushPreview $request.QueryString['path'] $request.QueryString['remote'] $request.QueryString['local'] $request.QueryString['target']) }
        '/api/ui-state' { $ui=[ordered]@{schemaVersion=2;path='';tab='history';openRepos=@()};if(Test-Path -LiteralPath $script:UiState -PathType Leaf){try{$saved=Get-Content -LiteralPath $script:UiState -Raw|ConvertFrom-Json;$savedPath=if($saved.path){[string]$saved.path}else{''};$savedTab=if($saved.tab){[string]$saved.tab}else{'history'};[string[]]$savedOpenRepos=if($null-ne $saved.openRepos){@($saved.openRepos|ForEach-Object{[string]$_})}elseif($savedPath){@($savedPath)}else{@()};$savedSchemaVersion=if($saved.schemaVersion){[int]$saved.schemaVersion}else{1};$ui=[ordered]@{schemaVersion=$savedSchemaVersion;path=$savedPath;tab=$savedTab;openRepos=$savedOpenRepos}}catch{}};Write-Json $context @{view=$ui} }
        '/api/jobs' { Write-Json $context @{jobs=@(Get-GitJobs)} }
        '/api/integration' { Write-Json $context @{integration=(Get-WindowsIntegrationState)} }
        '/api/job' { Write-Json $context (Get-GitJob $request.QueryString['id']) }
        '/api/repos' { Write-Json $context (Get-RepositoryCache) }
        '/api/repo/details' { $repoPath=$request.QueryString['path']; Write-Json $context @{details=(Get-RepositoryDetails $repoPath)} }
        '/api/repo/workspace' { $repoPath=$request.QueryString['path']; Write-Json $context @{workspace=(Get-WorkspaceDetails $repoPath ($request.QueryString['extras'] -eq 'true'))} }
        '/api/repo/history' { $repoPath=$request.QueryString['path'];$scope=$request.QueryString['scope'];$ref=$request.QueryString['ref'];$includeRemote=($request.QueryString['includeRemote'] -ne 'false');$order=$request.QueryString['order'];$skip=0;if($request.QueryString['skip'] -and -not [int]::TryParse($request.QueryString['skip'],[ref]$skip)){throw 'Invalid history offset.'};$items=@(Get-CommitHistory $repoPath $scope $ref $includeRemote $order $skip $request.QueryString['q']);Write-Json $context @{history=@($items | Select-Object -First 250);hasMore=($items.Count -gt 250);nextSkip=($skip+[Math]::Min(250,$items.Count))} }
        '/api/repo/history-search' { $repoPath=$request.QueryString['path'];$query=$request.QueryString['q'];$mode=$request.QueryString['mode'];Write-Json $context @{history=@(Search-HistoryContent $repoPath $query $mode)} }
        '/api/repo/compare' { $repoPath=$request.QueryString['path'];$source=$request.QueryString['source'];$target=$request.QueryString['target'];$remote=$request.QueryString['remote'];Write-Json $context @{compare=(Get-BranchCompare $repoPath $source $target $remote)} }
        '/api/repo/compare-diff' { $repoPath=$request.QueryString['path'];$source=$request.QueryString['source'];$target=$request.QueryString['target'];$file=$request.QueryString['file'];Write-Json $context @{result=(Get-CompareDiff $repoPath $source $target $file)} }
        '/api/repo/conflict' { $repoPath=$request.QueryString['path'];$file=$request.QueryString['file'];Write-Json $context @{conflict=(Get-ConflictDetails $repoPath $file)} }
        '/api/repo/worktrees' { $repoPath=$request.QueryString['path'];Write-Json $context @{worktrees=@(Get-Worktrees $repoPath)} }
        '/api/repo/rebase-plan' { $repoPath=$request.QueryString['path'];$base=$request.QueryString['base'];Write-Json $context @{plan=(Get-InteractiveRebasePlan $repoPath $base)} }
        '/api/repo/journal' { $repoPath=$request.QueryString['path'];Assert-Registered $repoPath;Write-Json $context @{journal=@(Get-ActionJournal|Where-Object{[string]::Equals([string]$_.path,$repoPath,[StringComparison]::OrdinalIgnoreCase)}|Select-Object -First 50)} }
        '/api/repo/reflog' { $repoPath=$request.QueryString['path'];Write-Json $context @{reflog=@(Get-ReflogEntries $repoPath)} }
        '/api/repo/commit' { $repoPath=$request.QueryString['path'];$commit=$request.QueryString['commit'];if(Test-GitDeckFullHash $commit){Assert-Registered $repoPath;$details=Get-GitDeckImmutable ("commit|$repoPath|$commit") {Get-CommitDetails $repoPath $commit}}else{$details=Get-CommitDetails $repoPath $commit};Write-Json $context @{commit=$details} }
        '/api/repo/commit-content' { Write-Json $context (Get-CommitFileContent $request.QueryString['path'] $request.QueryString['commit'] $request.QueryString['file']) }
        '/api/repo/commit-diff' { $repoPath=$request.QueryString['path'];$commit=$request.QueryString['commit'];$file=$request.QueryString['file'];$ws=($request.QueryString['ignoreWhitespace'] -eq '1');if(Test-GitDeckFullHash $commit){Assert-Registered $repoPath;$diffResult=Get-GitDeckImmutable ("diff|$repoPath|$commit|$file|ws=$ws") {Get-CommitDiff $repoPath $commit $file $ws}}else{$diffResult=Get-CommitDiff $repoPath $commit $file $ws};Write-Json $context @{result=$diffResult} }
        '/api/repo/working-diff' { $repoPath=$request.QueryString['path'];$file=$request.QueryString['file'];$staged=($request.QueryString['staged'] -eq 'true');Write-Json $context @{result=(Get-WorkingDiff $repoPath $file $staged)} }
        '/api/repo/stash-diff' { $repoPath=$request.QueryString['path'];$stash=$request.QueryString['stash'];Write-Json $context @{result=(Get-StashDiff $repoPath $stash)} }
        '/api/repo/file-history' { $repoPath=$request.QueryString['path'];$file=$request.QueryString['file'];Write-Json $context @{history=@(Get-FileHistory $repoPath $file)} }
        '/api/repo/blame' { $repoPath=$request.QueryString['path'];$file=$request.QueryString['file'];Write-Json $context @{result=(Get-FileBlame $repoPath $file)} }
        '/api/repo/tools' { $repoPath=$request.QueryString['path'];Write-Json $context @{tools=(Get-GitToolsState $repoPath)} }
        '/api/gitlab/hosts' { Write-Json $context @{installed=(Test-Path -LiteralPath $script:Glab);hosts=@(Get-GitLabHosts | ForEach-Object { @{host=$_;authenticated=(Test-GlabAuth $_)} })} }
        '/api/gitlab/projects' { $hostName=$request.QueryString['host']; Write-Json $context @{projects=@(Get-GitLabProjects $hostName)} }
        '/api/gitlab/mrs' { $project=$request.QueryString['project']; Write-Json $context @{mergeRequests=@(Get-GitLabMergeRequests $project)} }
        '/api/gitlab/pipelines' { $project=$request.QueryString['project']; Write-Json $context @{pipelines=@(Get-GitLabPipelines $project)} }
        '/api/gitlab/inbox' { $repoPath=$request.QueryString['path'];Write-Json $context @{inbox=(Get-GitLabInbox $repoPath)} }
        '/api/repo/push-checks' { Write-Json $context @{pushChecks=(Get-PushChecks $request.QueryString['path'] $request.QueryString['remote'] $request.QueryString['local'] $request.QueryString['target'] ($request.QueryString['force'] -eq 'true'))} }
        '/api/repo/pull-preview' { Write-Json $context @{pull=(Get-GitDeckPullPreview $request.QueryString['path'] ([string]$request.QueryString['remote']) ([string]$request.QueryString['branch']))} }
        '/api/repo/undo-preview' { Write-Json $context @{undo=(Get-UndoPreview $request.QueryString['path'])} }
        '/api/ai/status' { $repoPath=[string]$request.QueryString['path'];if($repoPath){Assert-Registered $repoPath;$aiStatus=Get-GitDeckAiRepoStatus $repoPath}else{$aiStatus=Get-AiStatus};Write-Json $context @{ai=$aiStatus} }
        '/api/github/inbox' { Write-Json $context @{inbox=(Get-GitHubInbox $request.QueryString['path'])} }
        default { if (-not (Write-GitDeckStatic $context $route)) { Write-Json $context @{error='Not found'} 404 } }
    }
}

if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { Write-Host '[ERROR] Git was not found in PATH.' -ForegroundColor Red; exit 1 }
if (-not (Test-Path -LiteralPath (Join-Path $script:WebRoot 'index.html'))) { Write-Host '[ERROR] Web UI files are missing.' -ForegroundColor Red; exit 1 }
# Only GitDeck.exe passes -IdleShutdownSeconds, and it opens the window itself. Older launchers
# did not pass -NoBrowser, which opened a second window; never open one in that case.
if ($IdleShutdownSeconds -gt 0) { $NoBrowser = [switch]$true }

$listener = New-Object Net.HttpListener
$listener.Prefixes.Add($script:BaseUrl)
try { $listener.Start() }
catch {
    try { Invoke-WebRequest -Uri ($script:BaseUrl+'api/health') -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop | Out-Null; if(-not $NoBrowser){Open-GitDeckWindow $script:BaseUrl}; exit 0 }
    catch { Write-Host "[ERROR] Cannot start Git Deck on $($script:BaseUrl)" -ForegroundColor Red; Write-Host $_.Exception.Message; exit 1 }
}

# GET requests only read Git state and run in parallel; POST actions stay serial.
$pool = $null
if (-not $Serial) {
    try { $pool = New-GitDeckRequestPool 4 }
    catch { Write-Host "[WARN] Parallel requests disabled: $($_.Exception.Message)" -ForegroundColor Yellow; $pool = $null }
}

Write-Host "Git Deck is running at $($script:BaseUrl)" -ForegroundColor Green
Write-Host 'Close this window or press Ctrl+C to stop it.' -ForegroundColor DarkGray
if ($IdleShutdownSeconds -gt 0) { Write-Host "The server stops $IdleShutdownSeconds seconds after the last Git Deck window closes." -ForegroundColor DarkGray }
if(-not $NoBrowser){Open-GitDeckWindow $script:BaseUrl}

try {
    $pendingContext = $null
    while ($script:Running -and $listener.IsListening) {
        if (-not $pendingContext) { $pendingContext = $listener.BeginGetContext($null, $null) }
        if (-not $pendingContext.AsyncWaitHandle.WaitOne(250)) {
            # Idle tick: live events, finished pool requests and idle shutdown.
            Invoke-GitDeckEventPump
            Complete-GitDeckPooledRequests
            if (Test-GitDeckIdleShutdown $IdleShutdownSeconds) { Write-Host 'All Git Deck windows closed; stopping.' -ForegroundColor DarkGray; $script:Running = $false }
            continue
        }
        $context = $listener.EndGetContext($pendingContext)
        $pendingContext = $null
        $script:LastActivityAt = [DateTime]::UtcNow
        try {
            $request = $context.Request
            if (-not [Net.IPAddress]::IsLoopback($request.RemoteEndPoint.Address)) { Write-Json $context @{error='Local access only'} 403; continue }
            $route = $request.Url.AbsolutePath
            if ($request.HttpMethod -eq 'GET' -and $route -eq '/api/events') { Add-GitDeckEventClient $context }
            elseif ($request.HttpMethod -eq 'GET') {
                if ($pool -and $route.StartsWith('/api/')) { Start-GitDeckPooledRequest $pool $context }
                else { Invoke-GitDeckRequest $context }
            } elseif ($request.HttpMethod -eq 'POST' -and $route -eq '/api/action') {
                if ($request.Headers['X-Git-Deck'] -ne '1') { Write-Json $context @{error='Invalid local request'} 403; continue }
                $body = Read-JsonBody $request
                # AI requests can take a while and only read Git; keep other actions responsive.
                # ai-policy-set writes repository config, so it stays on the serial path.
                if ($pool -and [string]$body.action -like 'ai-*' -and [string]$body.action -ne 'ai-policy-set') { Start-GitDeckPooledRequest $pool ([pscustomobject]@{Request=$request;Response=$context.Response;Body=$body}) }
                else { Write-Json $context (Invoke-ActionWithJournal $body) }
            } else { Write-Json $context @{error='Method not allowed'} 405 }
        } catch {
            try { if ($context.Response.OutputStream.CanWrite) { Write-Json $context @{error=$_.Exception.Message} 400 } } catch {}
        }
        Complete-GitDeckPooledRequests
    }
} finally {
    Stop-GitDeckRuntime
    foreach ($item in $script:PendingRequests.ToArray()) { try { $item.Shell.Stop(); $item.Shell.Dispose() } catch {} }
    if ($pool) { $pool.Close(); $pool.Dispose() }
    $listener.Stop(); $listener.Close()
}
