# Power tools across repositories (web/power.js):
# - Save points: remember HEAD, branch and the uncommitted tracked changes of each repository (a stash
#   commit made with "git stash create", which does not touch the working tree), kept alive by a ref
#   refs/gitdeck/savepoints/<id>. Loading one puts the repository back exactly there.
# - Recent actions in every repository (the operation journal) for the Panic button.
# - Sibling patch: the diff of one commit, checked and applied in another repository.

function Assert-GitDeckSavePointId([string]$Id) {
    if ($Id -notmatch '^[A-Za-z0-9-]{6,64}$') { throw 'Invalid save point ID.' }
}

function New-GitDeckSavePoint([string]$Path, [string]$Id) {
    Assert-Registered $Path
    Assert-GitDeckSavePointId $Id
    $snapshot = Get-GitSnapshot $Path
    if (-not $snapshot.head) { throw 'This repository has no commit yet.' }
    # Output can carry line-ending warnings on Windows; the stash commit is the 40-hex line.
    $created = [string](Invoke-GitOrThrow $Path @('-c', 'core.safecrlf=false', 'stash', 'create', "Git Deck save point $Id"))
    $stash = ([regex]::Matches($created, '(?m)^[0-9a-f]{40}\s*$') | Select-Object -Last 1 | ForEach-Object { $_.Value.Trim() })
    if (-not $stash) { $stash = '' }
    $keep = if ($stash) { $stash } else { $snapshot.head }
    [void](Invoke-GitOrThrow $Path @('update-ref', "refs/gitdeck/savepoints/$Id", $keep))
    $untracked = @(Get-GitDeckLines (Invoke-GitCapture $Path @('ls-files', '--others', '--exclude-standard'))).Count
    return [ordered]@{ path = $Path; head = $snapshot.head; branch = $snapshot.branch; stash = $stash; untracked = $untracked }
}

function Restore-GitDeckSavePoint([string]$Path, [string]$Id, [string]$Head, [string]$Branch, [string]$Stash) {
    Assert-Registered $Path
    Assert-GitDeckSavePointId $Id
    Assert-CommitHash $Path $Head
    if ($Stash) { Assert-CommitHash $Path $Stash }
    $operation = Get-GitOperationState $Path
    if ($operation.active) { throw 'A merge, rebase or cherry-pick is in progress. Finish or abort it first.' }
    $log = New-Object 'System.Collections.Generic.List[string]'
    # Tracked changes are dropped here: the caller saved them in a fresh save point first.
    $log.Add([string](Invoke-GitOrThrow $Path @('reset', '--hard', '--quiet')))
    if ($Branch) {
        $exists = Invoke-GitCapture $Path @('show-ref', '--verify', '--quiet', "refs/heads/$Branch")
        if ($exists.Code -eq 0) { $log.Add([string](Invoke-GitOrThrow $Path @('checkout', '--quiet', $Branch))) }
        else { $log.Add([string](Invoke-GitOrThrow $Path @('checkout', '--quiet', '-b', $Branch, $Head))) }
        $log.Add([string](Invoke-GitOrThrow $Path @('reset', '--hard', '--quiet', $Head)))
    }
    else { $log.Add([string](Invoke-GitOrThrow $Path @('checkout', '--quiet', '--detach', $Head))) }
    if ($Stash) {
        $apply = Invoke-GitCapture $Path @('stash', 'apply', '--index', $Stash)
        if ($apply.Code -ne 0) { $apply = Invoke-GitCapture $Path @('stash', 'apply', $Stash) }
        if ($apply.Code -ne 0) { throw "Back at $Head, but the saved changes did not apply: $($apply.Output)" }
        $log.Add([string]$apply.Output)
    }
    return @{ message = "Loaded save point: $(if($Branch){$Branch}else{'detached'}) at $($Head.Substring(0,7))$(if($Stash){' with saved changes'})."; output = (($log | Where-Object { $_ }) -join "`n") }
}

function Remove-GitDeckSavePoint([string]$Path, [string]$Id) {
    Assert-Registered $Path
    Assert-GitDeckSavePointId $Id
    [void](Invoke-GitCapture $Path @('update-ref', '-d', "refs/gitdeck/savepoints/$Id"))
    return @{ message = 'Save point removed.' }
}

# Journal entries of every repository from the last $Minutes minutes, newest first.
function Get-GitDeckRecentJournal([int]$Minutes = 30) {
    if ($Minutes -lt 1 -or $Minutes -gt 1440) { $Minutes = 30 }
    $since = (Get-Date).ToUniversalTime().AddMinutes(-$Minutes)
    $items = New-Object 'System.Collections.Generic.List[object]'
    foreach ($entry in @(Get-ActionJournal)) {
        $at = [DateTime]::MinValue
        if (-not [DateTime]::TryParse([string]$entry.createdAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal, [ref]$at)) { continue }
        if ($at -lt $since) { continue }
        $items.Add([ordered]@{ id = [string]$entry.id; path = [string]$entry.path; repository = [string]$entry.repository; action = [string]$entry.action; beforeHead = [string]$entry.beforeHead; afterHead = [string]$entry.afterHead; beforeBranch = [string]$entry.beforeBranch; afterBranch = [string]$entry.afterBranch; createdAt = [string]$entry.createdAt })
    }
    return $items.ToArray()
}

# The diff of one commit as a patch "git apply" understands.
function Get-GitDeckCommitPatch([string]$Path, [string]$Commit) {
    Assert-Registered $Path
    Assert-CommitHash $Path $Commit
    $subject = ([string](Invoke-GitOrThrow $Path @('log', '-1', '--format=%s', $Commit))).Trim()
    # A merge commit's change is what it brought into the first parent.
    $parents = @(([string](Invoke-GitOrThrow $Path @('log', '-1', '--format=%P', $Commit))).Trim() -split ' ' | Where-Object { $_ })
    $patch = if ($parents.Count -gt 1) { [string](Invoke-GitOrThrow $Path @('-c', 'core.quotepath=off', 'diff', '--binary', '--no-color', $parents[0], $Commit)) }
             else { [string](Invoke-GitOrThrow $Path @('-c', 'core.quotepath=off', 'show', '--format=', '--binary', '--no-color', $Commit)) }
    if ($patch.Length -gt 1000000) { throw 'This commit is too large to copy to sibling repositories.' }
    $files = @(Get-GitDeckLines $(if ($parents.Count -gt 1) { Invoke-GitCapture $Path @('-c', 'core.quotepath=off', 'diff', '--name-only', $parents[0], $Commit) } else { Invoke-GitCapture $Path @('-c', 'core.quotepath=off', 'show', '--format=', '--name-only', $Commit) }))
    $start = $patch.IndexOf('diff --git ')
    if ($start -lt 0) { throw 'This commit changes no files.' }
    # git apply needs the last line ended; captured output loses the final newline.
    $text = $patch.Substring($start).Replace("`r`n", "`n")
    if (-not $text.EndsWith("`n")) { $text += "`n" }
    return [ordered]@{ commit = $Commit; subject = $subject; patch = $text; files = $files }
}

# Would the patch apply here? Plain first, then a three-way merge using the blobs Git knows.
function Test-GitDeckPatch([string]$Path, [string]$Patch) {
    Assert-Registered $Path
    if ($Patch -and -not $Patch.EndsWith("`n")) { $Patch += "`n" }
    if (-not $Patch -or $Patch.Length -gt 1000000 -or -not $Patch.StartsWith('diff --git ')) { throw 'Invalid Git patch.' }
    $temp = Join-Path ([IO.Path]::GetTempPath()) ('git-deck-check-' + [Guid]::NewGuid().ToString() + '.patch')
    try {
        [IO.File]::WriteAllText($temp, $Patch, (New-Object Text.UTF8Encoding($false)))
        $plain = Invoke-GitCapture $Path @('apply', '--check', '--recount', '--whitespace=nowarn', $temp)
        if ($plain.Code -eq 0) { return [ordered]@{ ok = $true; mode = 'clean'; output = '' } }
        $three = Invoke-GitCapture $Path @('apply', '--check', '--3way', '--recount', '--whitespace=nowarn', $temp)
        if ($three.Code -eq 0) { return [ordered]@{ ok = $true; mode = '3way'; output = [string]$three.Output } }
        return [ordered]@{ ok = $false; mode = ''; output = [string]$plain.Output }
    }
    finally { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
}

# Apply the patch to the working tree (and the index with -Stage), never committing.
function Invoke-GitDeckSiblingPatch([string]$Path, [string]$Patch, [bool]$Stage) {
    $check = Test-GitDeckPatch $Path $Patch
    if (-not $check.ok) { throw "The change does not fit this repository: $($check.output)" }
    $temp = Join-Path ([IO.Path]::GetTempPath()) ('git-deck-sibling-' + [Guid]::NewGuid().ToString() + '.patch')
    try {
        [IO.File]::WriteAllText($temp, $Patch, (New-Object Text.UTF8Encoding($false)))
        $args = New-Object 'System.Collections.Generic.List[string]'
        $args.Add('apply'); $args.Add('--recount'); $args.Add('--whitespace=nowarn')
        if ($check.mode -eq '3way') { $args.Add('--3way') } elseif ($Stage) { $args.Add('--index') }
        $args.Add($temp)
        $output = Invoke-GitOrThrow $Path $args.ToArray()
        return @{ message = "Change applied ($($check.mode)); review it in Changes and commit when ready."; output = $(if ($output) { $output } else { 'Applied.' }) }
    }
    finally { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
}
