# Updating Git Deck itself when its folder is a Git clone (web/update-check.js):
#   Get-GitDeckSelfUpdate    - fetches the Git Deck repository (at most every 6 hours) and says how
#                              many new commits its branch has on the remote
#   Invoke-GitDeckSelfUpdate - git pull --ff-only in the Git Deck folder, only with no local changes
# A release ZIP is not a Git clone: both report that and do nothing. Windows PowerShell 5.1 compatible.

function Get-GitDeckSelfRepo {
    $root = $script:Root
    if (-not $root -or -not (Test-Path -LiteralPath (Join-Path $root '.git'))) { return $null }
    $branch = ([string](Invoke-GitCapture $root @('branch', '--show-current')).Output).Trim()
    $upstream = Invoke-GitCapture $root @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}')
    return [ordered]@{ root = $root; branch = $branch; upstream = $(if ($upstream.Code -eq 0) { ([string]$upstream.Output).Trim() } else { '' }) }
}

function Get-GitDeckSelfUpdate([bool]$Force) {
    $self = Get-GitDeckSelfRepo
    if (-not $self) { return [ordered]@{ git = $false; behind = 0; message = 'Git Deck was not installed with git clone; download new versions from the Releases page.' } }
    if (-not $self.upstream) { return [ordered]@{ git = $true; behind = 0; branch = $self.branch; message = 'The Git Deck branch has no upstream to update from.' } }
    # FETCH_HEAD records the last fetch; fetching more often than every 6 hours gains nothing.
    $fetchHead = Join-Path $self.root '.git\FETCH_HEAD'
    $age = if (Test-Path -LiteralPath $fetchHead) { ([DateTime]::UtcNow - (Get-Item -LiteralPath $fetchHead).LastWriteTimeUtc).TotalHours } else { [double]::PositiveInfinity }
    $fetchError = ''
    if ($Force -or $age -ge 6) {
        $remote = ($self.upstream -split '/', 2)[0]
        $fetch = Invoke-GitCapture $self.root @('fetch', '--quiet', '--no-tags', $remote)
        if ($fetch.Code -ne 0) { $fetchError = ([string]$fetch.Output).Split("`n")[0] }
    }
    $count = ([string](Invoke-GitCapture $self.root @('rev-list', '--left-right', '--count', "HEAD...$($self.upstream)")).Output).Trim() -split '\s+'
    $ahead = 0; $behind = 0
    if ($count.Count -eq 2) { [void][int]::TryParse($count[0], [ref]$ahead); [void][int]::TryParse($count[1], [ref]$behind) }
    $dirty = @(([string](Invoke-GitCapture $self.root @('status', '--porcelain', '--untracked-files=no')).Output) -split "`r?`n" | Where-Object { $_ }).Count
    $latest = if ($behind) { ([string](Invoke-GitCapture $self.root @('log', '-1', '--format=%s', $self.upstream)).Output).Trim() } else { '' }
    return [ordered]@{ git = $true; branch = $self.branch; upstream = $self.upstream; behind = $behind; ahead = $ahead; dirty = $dirty; latest = $latest; fetchError = $fetchError }
}

function Invoke-GitDeckSelfUpdate {
    $self = Get-GitDeckSelfRepo
    if (-not $self) { throw 'Git Deck was not installed with git clone; download the new version from the Releases page.' }
    if (-not $self.upstream) { throw 'The Git Deck branch has no upstream to update from.' }
    $dirty = ([string](Invoke-GitCapture $self.root @('status', '--porcelain', '--untracked-files=no')).Output).Trim()
    if ($dirty) { throw "Files in the Git Deck folder were changed on this computer, so it was not updated automatically. Run git status in $($self.root)." }
    $pull = Invoke-GitCapture $self.root @('pull', '--ff-only', '--quiet')
    if ($pull.Code -ne 0) { throw ('Update failed: ' + ([string]$pull.Output).Split("`n")[0]) }
    return @{ message = 'Git Deck was updated. Close Git Deck and open it again to use the new version.'; output = ([string]$pull.Output) }
}
