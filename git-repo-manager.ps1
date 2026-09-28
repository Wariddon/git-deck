[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$script:RepoListFile = Join-Path $PSScriptRoot 'git-repositories.txt'

function Write-Header([string]$Title) {
    Clear-Host
    Write-Host '============================================' -ForegroundColor DarkCyan
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host '============================================' -ForegroundColor DarkCyan
    Write-Host
}

function Pause-App {
    Write-Host
    [void](Read-Host 'Press Enter to continue')
}

function Get-Repositories {
    if (-not (Test-Path -LiteralPath $script:RepoListFile -PathType Leaf)) { return @() }
    return @(Get-Content -LiteralPath $script:RepoListFile |
        ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
}

function Save-Repositories([string[]]$Repositories) {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllLines($script:RepoListFile, @($Repositories), $utf8)
}

function Test-GitRepository([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return $false }
    & git -C $Path rev-parse --is-inside-work-tree *> $null
    return ($LASTEXITCODE -eq 0)
}

function Get-OriginUrl([string]$Path) {
    if (-not (Test-GitRepository $Path)) { return '' }
    $url = & git -C $Path remote get-url origin 2>$null
    if ($LASTEXITCODE -ne 0) { return '' }
    return ([string]$url).Trim()
}

function Add-RepositoryRecord([string]$Path) {
    $fullPath = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $repos = @(Get-Repositories)
    $found = $repos | Where-Object {
        [string]::Equals($_, $fullPath, [StringComparison]::OrdinalIgnoreCase)
    }
    if ($found) {
        Write-Host '[INFO] Repository is already registered.' -ForegroundColor Yellow
        Write-Host $fullPath
        return
    }
    Save-Repositories (@($repos) + $fullPath)
    Write-Host '[OK] Repository registered:' -ForegroundColor Green
    Write-Host $fullPath
}

function Get-RepositoryInfo([string]$Path) {
    if (-not (Test-GitRepository $Path)) {
        return [pscustomobject]@{ Path=$Path; Name=(Split-Path $Path -Leaf); Valid=$false }
    }
    $branch = ([string](& git -C $Path branch --show-current 2>$null)).Trim()
    if (-not $branch) {
        $hash = ([string](& git -C $Path rev-parse --short HEAD 2>$null)).Trim()
        $branch = "detached@$hash"
    }
    $changes = @(& git -C $Path status --porcelain 2>$null).Count
    $ahead = '-'; $behind = '-'
    & git -C $Path rev-parse --abbrev-ref '@{upstream}' *> $null
    if ($LASTEXITCODE -eq 0) {
        $counts = (([string](& git -C $Path rev-list --left-right --count 'HEAD...@{upstream}' 2>$null)).Trim() -split '\s+')
        if ($counts.Count -ge 2) { $ahead = $counts[0]; $behind = $counts[1] }
    }
    $last = ([string](& git -C $Path log -1 --format='%h %ad %s' --date=short 2>$null)).Trim()
    if (-not $last) { $last = '(no commits yet)' }
    return [pscustomobject]@{
        Path=$Path; Name=(Split-Path $Path -Leaf); Valid=$true; Branch=$branch
        Changes=$changes; Ahead=$ahead; Behind=$behind; LastCommit=$last
        Remote=(Get-OriginUrl $Path)
    }
}

function Show-RepositorySummary([string]$Path, [int]$Number) {
    $info = Get-RepositoryInfo $Path
    if (-not $info.Valid) {
        Write-Host "[$Number] $($info.Name)" -ForegroundColor Red
        Write-Host "    Path:   $Path"
        Write-Host '    Status: missing or not a Git repository' -ForegroundColor Red
        Write-Host
        return
    }
    $state = if ($info.Changes -eq 0) { 'clean' } else { "$($info.Changes) change(s)" }
    $color = if ($info.Changes -eq 0) { 'Green' } else { 'Yellow' }
    $remote = if ($info.Remote) { $info.Remote } else { '(origin is not configured)' }
    Write-Host "[$Number] $($info.Name)" -ForegroundColor Cyan
    Write-Host "    Path:   $($info.Path)"
    Write-Host "    Branch: $($info.Branch) | " -NoNewline
    Write-Host $state -ForegroundColor $color
    Write-Host "    Sync:   ahead $($info.Ahead), behind $($info.Behind)"
    Write-Host "    Commit: $($info.LastCommit)"
    Write-Host "    Remote: $remote"
    Write-Host
}

function Select-Repository([string[]]$Repositories, [string]$Title='Repositories') {
    Write-Header $Title
    if ($Repositories.Count -eq 0) {
        Write-Host '[INFO] No repositories found.' -ForegroundColor Yellow
        Pause-App
        return $null
    }
    for ($i=0; $i -lt $Repositories.Count; $i++) {
        $path = $Repositories[$i]
        $name = Split-Path $path -Leaf
        $remote = Get-OriginUrl $path
        $marker = if (Test-GitRepository $path) { 'OK' } else { 'MISSING' }
        $color = if ($marker -eq 'OK') { 'White' } else { 'Red' }
        Write-Host "[$($i+1)] [$marker] $name" -ForegroundColor $color
        Write-Host "    $path"
        Write-Host "    $(if ($remote) {$remote} else {'(no origin)'})" -ForegroundColor DarkGray
    }
    Write-Host "`n[0] Back"
    $raw = Read-Host 'Select repository'
    $number = 0
    if (-not [int]::TryParse($raw, [ref]$number) -or $number -lt 0 -or $number -gt $Repositories.Count) {
        Write-Host '[ERROR] Invalid selection.' -ForegroundColor Red
        Pause-App
        return $null
    }
    if ($number -eq 0) { return $null }
    return $Repositories[$number-1]
}

function Add-ExistingRepository {
    Write-Header 'Add existing repository'
    $path = (Read-Host 'Repository folder (full path)').Trim('"')
    if (-not $path) { return }
    try { $path = (Resolve-Path -LiteralPath $path -ErrorAction Stop).Path }
    catch {
        Write-Host '[ERROR] Folder does not exist.' -ForegroundColor Red
        Pause-App; return
    }
    if (-not (Test-GitRepository $path)) {
        Write-Host '[ERROR] Folder is not a Git working tree.' -ForegroundColor Red
        Pause-App; return
    }
    Add-RepositoryRecord $path
    Pause-App
}

function Clone-Repository {
    Write-Header 'Clone repository'
    $url = (Read-Host 'Repository URL').Trim()
    if (-not $url) { return }
    Write-Host 'Checking remote repository...'
    & git ls-remote $url HEAD *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host '[ERROR] Cannot access repository. Check URL, network, and credentials.' -ForegroundColor Red
        Pause-App; return
    }
    $destination = (Read-Host 'Destination folder (full path)').Trim('"')
    if (-not $destination) { return }
    $destination = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($destination)).TrimEnd('\')
    if ((Test-Path -LiteralPath $destination) -and
        @(Get-ChildItem -LiteralPath $destination -Force).Count -gt 0) {
        Write-Host '[ERROR] Destination exists and is not empty.' -ForegroundColor Red
        Pause-App; return
    }
    & git clone $url $destination
    if ($LASTEXITCODE -ne 0) {
        Write-Host '[ERROR] Clone failed. Repository was not registered.' -ForegroundColor Red
        Pause-App; return
    }
    Add-RepositoryRecord $destination
    Pause-App
}

function Show-Dashboard {
    Write-Header 'Repository dashboard'
    $repos = @(Get-Repositories)
    if ($repos.Count -eq 0) { Write-Host '[INFO] No repositories registered.' -ForegroundColor Yellow }
    for ($i=0; $i -lt $repos.Count; $i++) {
        Show-RepositorySummary $repos[$i] ($i+1)
    }
    Pause-App
}

function Search-Repositories {
    Write-Header 'Search repositories'
    $term = (Read-Host 'Search by name, path, or remote URL').Trim()
    if (-not $term) { return }
    $matches = @(Get-Repositories | Where-Object {
        $remote = Get-OriginUrl $_
        $_.IndexOf($term, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
        $remote.IndexOf($term, [StringComparison]::OrdinalIgnoreCase) -ge 0
    })
    $selected = Select-Repository $matches "Search: $term"
    if ($selected) { Show-RepositoryMenu $selected }
}

function Open-RepositoryFolder([string]$Path) {
    Start-Process explorer.exe -ArgumentList ('"' + $Path + '"')
}

function Open-RepositoryTerminal([string]$Path) {
    $terminal = Get-Command wt.exe -ErrorAction SilentlyContinue
    if ($terminal) { Start-Process $terminal.Source -ArgumentList @('-d', ('"' + $Path + '"')) }
    else { Start-Process powershell.exe -WorkingDirectory $Path }
}

function Open-RepositoryCode([string]$Path) {
    $code = Get-Command code.cmd -ErrorAction SilentlyContinue
    if (-not $code) {
        Write-Host '[ERROR] VS Code command was not found.' -ForegroundColor Red
        Pause-App; return
    }
    Start-Process $code.Source -ArgumentList ('"' + $Path + '"')
}

function ConvertTo-WebRemoteUrl([string]$Remote) {
    if ($Remote -match '^https?://') { return $Remote }
    if ($Remote -match '^git@([^:]+):(.+?)(?:\.git)?$') {
        $repoPath = $Matches[2] -replace '\.git$', ''
        return "https://$($Matches[1])/$repoPath"
    }
    if ($Remote -match '^ssh://git@([^/]+)/(.+?)(?:\.git)?$') {
        $repoPath = $Matches[2] -replace '\.git$', ''
        return "https://$($Matches[1])/$repoPath"
    }
    return ''
}

function Open-RepositoryRemote([string]$Path) {
    $remote = Get-OriginUrl $Path
    if (-not $remote) {
        Write-Host '[ERROR] origin is not configured.' -ForegroundColor Red
        Pause-App; return
    }
    $webUrl = ConvertTo-WebRemoteUrl $remote
    if (-not $webUrl) {
        Write-Host '[ERROR] Cannot convert this remote to a browser URL:' -ForegroundColor Red
        Write-Host $remote
        Pause-App; return
    }
    Start-Process $webUrl
}

function Show-RepositoryStatus([string]$Path) {
    Write-Header "Status: $(Split-Path $Path -Leaf)"
    Write-Host "Path:   $Path"
    Write-Host "Remote: $(Get-OriginUrl $Path)`n"
    & git -C $Path status --short --branch
    Pause-App
}

function Show-RepositoryLog([string]$Path) {
    Write-Header "Recent commits: $(Split-Path $Path -Leaf)"
    & git -C $Path log -10 --date=short --pretty=format:'%h %ad %s - %an'
    Write-Host
    Pause-App
}

function Fetch-Repository([string]$Path) {
    Write-Host "Fetching $(Split-Path $Path -Leaf)..." -ForegroundColor Cyan
    & git -C $Path fetch --all --prune
    if ($LASTEXITCODE -eq 0) { Write-Host '[OK] Fetch completed.' -ForegroundColor Green }
    else { Write-Host '[ERROR] Fetch failed.' -ForegroundColor Red }
    Pause-App
}

function Fetch-AllRepositories {
    Write-Header 'Fetch all repositories'
    foreach ($path in @(Get-Repositories)) {
        Write-Host "[$path]" -ForegroundColor Cyan
        if (-not (Test-GitRepository $path)) {
            Write-Host '  [SKIP] Missing or invalid repository.' -ForegroundColor Red; continue
        }
        if (-not (Get-OriginUrl $path)) {
            Write-Host '  [SKIP] origin is not configured.' -ForegroundColor Yellow; continue
        }
        & git -C $path fetch --all --prune
        if ($LASTEXITCODE -eq 0) { Write-Host '  [OK]' -ForegroundColor Green }
        else { Write-Host '  [FAILED]' -ForegroundColor Red }
        Write-Host
    }
    Pause-App
}

function Pull-Repository([string]$Path) {
    if (@(& git -C $Path status --porcelain).Count -gt 0) {
        Write-Host '[BLOCKED] Commit or stash local changes before pulling.' -ForegroundColor Yellow
        Pause-App; return
    }
    & git -C $Path rev-parse --abbrev-ref '@{upstream}' *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host '[BLOCKED] Current branch has no upstream.' -ForegroundColor Yellow
        Pause-App; return
    }
    & git -C $Path pull --ff-only
    if ($LASTEXITCODE -eq 0) { Write-Host '[OK] Pull completed.' -ForegroundColor Green }
    else { Write-Host '[ERROR] Pull failed. No merge commit was created.' -ForegroundColor Red }
    Pause-App
}

function Commit-Repository([string]$Path) {
    Write-Header "Commit: $(Split-Path $Path -Leaf)"
    $changes = @(& git -C $Path status --short)
    if ($changes.Count -eq 0) {
        Write-Host '[INFO] Working tree is clean.' -ForegroundColor Green
        Pause-App; return
    }
    $changes | ForEach-Object { Write-Host $_ }
    $message = (Read-Host "`nCommit message").Trim()
    if (-not $message) { Write-Host '[CANCELLED] Message is required.' -ForegroundColor Yellow; Pause-App; return }
    if ((Read-Host 'Stage ALL changes and commit? (y/N)') -ine 'y') {
        Write-Host '[CANCELLED] No files were staged.' -ForegroundColor Yellow; Pause-App; return
    }
    & git -C $Path add -A
    if ($LASTEXITCODE -ne 0) { Write-Host '[ERROR] Staging failed.' -ForegroundColor Red; Pause-App; return }
    & git -C $Path commit -m $message
    if ($LASTEXITCODE -eq 0) { Write-Host '[OK] Commit created. It has NOT been pushed.' -ForegroundColor Green }
    else { Write-Host '[ERROR] Commit failed.' -ForegroundColor Red }
    Pause-App
}

function Push-Repository([string]$Path) {
    Write-Header "Push: $(Split-Path $Path -Leaf)"
    & git -C $Path status --short --branch
    if ((Read-Host "`nPush this repository now? (y/N)") -ine 'y') {
        Write-Host '[CANCELLED] Nothing was pushed.' -ForegroundColor Yellow; Pause-App; return
    }
    & git -C $Path rev-parse --abbrev-ref '@{upstream}' *> $null
    if ($LASTEXITCODE -eq 0) { & git -C $Path push }
    else {
        $branch = ([string](& git -C $Path branch --show-current)).Trim()
        if (-not $branch) { Write-Host '[ERROR] HEAD is detached.' -ForegroundColor Red; Pause-App; return }
        & git -C $Path push -u origin $branch
    }
    if ($LASTEXITCODE -eq 0) { Write-Host '[OK] Push completed.' -ForegroundColor Green }
    else { Write-Host '[ERROR] Push failed.' -ForegroundColor Red }
    Pause-App
}

function Remove-RepositoryRecord([string]$Path) {
    Write-Host 'Only the saved entry is removed. Repository files will NOT be deleted.' -ForegroundColor Yellow
    if ((Read-Host "Remove '$(Split-Path $Path -Leaf)' from list? (y/N)") -ine 'y') { return $false }
    $remaining = @(Get-Repositories | Where-Object {
        -not [string]::Equals($_, $Path, [StringComparison]::OrdinalIgnoreCase)
    })
    Save-Repositories $remaining
    Write-Host '[OK] Entry removed. Repository files were not changed.' -ForegroundColor Green
    Pause-App
    return $true
}

function Show-RepositoryMenu([string]$Path) {
    while ($true) {
        Write-Header "Repository: $(Split-Path $Path -Leaf)"
        Write-Host "Path:   $Path"
        Write-Host "Remote: $(Get-OriginUrl $Path)`n"
        Write-Host '[1] Status'
        Write-Host '[2] Open folder'
        Write-Host '[3] Open Windows Terminal'
        Write-Host '[4] Open VS Code'
        Write-Host '[5] Open remote URL'
        Write-Host '[6] Fetch'
        Write-Host '[7] Pull (--ff-only)'
        Write-Host '[8] Recent commits'
        Write-Host '[9] Commit (stage all)'
        Write-Host '[10] Push'
        Write-Host '[11] Remove from list'
        Write-Host '[0] Back'
        switch (Read-Host "`nChoose an option") {
            '1' { Show-RepositoryStatus $Path }
            '2' { Open-RepositoryFolder $Path }
            '3' { Open-RepositoryTerminal $Path }
            '4' { Open-RepositoryCode $Path }
            '5' { Open-RepositoryRemote $Path }
            '6' { Fetch-Repository $Path }
            '7' { Pull-Repository $Path }
            '8' { Show-RepositoryLog $Path }
            '9' { Commit-Repository $Path }
            '10' { Push-Repository $Path }
            '11' { if (Remove-RepositoryRecord $Path) { return } }
            '0' { return }
        }
    }
}

function Manage-Repositories {
    $selected = Select-Repository @(Get-Repositories)
    if ($selected) { Show-RepositoryMenu $selected }
}

if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
    Write-Host '[ERROR] Git was not found in PATH.' -ForegroundColor Red
    Pause-App; exit 1
}

while ($true) {
    Write-Header 'Git Repository Manager'
    Write-Host '[1] Repositories'
    Write-Host '[2] Clone repository'
    Write-Host '[3] Add existing repository'
    Write-Host '[4] Dashboard'
    Write-Host '[5] Search repositories'
    Write-Host '[6] Fetch all repositories'
    Write-Host '[0] Exit'
    switch (Read-Host "`nChoose an option") {
        '1' { Manage-Repositories }
        '2' { Clone-Repository }
        '3' { Add-ExistingRepository }
        '4' { Show-Dashboard }
        '5' { Search-Repositories }
        '6' { Fetch-AllRepositories }
        '0' { exit 0 }
    }
}
