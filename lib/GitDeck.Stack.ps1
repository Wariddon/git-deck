# Stacked branches (web/stack.js): a chain of local branches where each one starts from the one before
# (base -> feature/PAY-1-api -> feature/PAY-1-ui -> ...), as Graphite and GitHub/GitLab stacked
# merge requests use. Shows the stack around the current branch, rebases the whole stack onto the
# base in one go (`rebase --update-refs`), and pushes it with --force-with-lease. Merge requests are
# created by the page through the existing create-mr action. Windows PowerShell 5.1 compatible.

function Get-GitDeckStackBase([string]$Path, [string]$Base) {
    $Base = ([string]$Base).Trim()
    if ($Base) {
        if ($Base.StartsWith('-') -or $Base -notmatch '^[A-Za-z0-9._/-]+$') { throw 'Base branch name is not valid.' }
        if ((Invoke-GitCapture $Path @('rev-parse', '--verify', '--quiet', "$Base^{commit}")).Code -ne 0) { throw "$Base was not found." }
        return $Base
    }
    foreach ($candidate in @('origin/develop', 'origin/main', 'origin/master', 'develop', 'main', 'master')) {
        if ((Invoke-GitCapture $Path @('rev-parse', '--verify', '--quiet', "$candidate^{commit}")).Code -eq 0) { return $candidate }
    }
    throw 'No base branch (develop, main or master) was found.'
}

function Get-GitDeckBranchStack([string]$Path, [string]$Base) {
    Assert-Registered $Path
    $Base = Get-GitDeckStackBase $Path $Base
    $current = ([string](Invoke-GitCapture $Path @('branch', '--show-current')).Output).Trim()
    if (-not $current) { throw 'Switch to a branch first (HEAD is detached).' }
    $baseShort = $Base -replace '^origin/', ''
    $format = '%(refname:short)%09%(upstream:short)%09%(upstream:track)%09%(contents:subject)'
    $parse = { param($lines) $out = @{}; foreach ($line in $lines) { $f = $line -split "`t"; if ($f[0] -eq $baseShort -or $f[0] -in @('develop', 'main', 'master')) { continue }; $out[$f[0]] = $f }; $out }
    # Below the current branch: branches merged into it but not into the base; above: branches containing it.
    $below = & $parse @(Get-GitDeckLines (Invoke-GitCapture $Path @('for-each-ref', "--format=$format", '--merged', $current, '--no-merged', $Base, 'refs/heads')))
    $above = & $parse @(Get-GitDeckLines (Invoke-GitCapture $Path @('for-each-ref', "--format=$format", '--contains', $current, 'refs/heads')))
    $all = @{}; foreach ($key in $below.Keys) { $all[$key] = $below[$key] }; foreach ($key in $above.Keys) { $all[$key] = $above[$key] }
    if (-not $all.ContainsKey($current)) { return [ordered]@{ base = $Base; current = $current; branches = @(); message = "$current has no commits that $Base does not have." } }
    # Order by the number of commits after the base; keep it a straight line (each contains the one before).
    $depth = @{}
    foreach ($name in $all.Keys) { $count = 0; [void][int]::TryParse(([string](Invoke-GitCapture $Path @('rev-list', '--count', "$Base..$name")).Output).Trim(), [ref]$count); $depth[$name] = $count }
    $ordered = @($all.Keys | Sort-Object { $depth[$_] }, { $_ })
    $chain = New-Object 'System.Collections.Generic.List[string]'
    foreach ($name in $ordered) {
        if ($chain.Count -and $depth[$name] -eq $depth[$chain[$chain.Count - 1]]) { continue }
        if ($chain.Count -and (Invoke-GitCapture $Path @('merge-base', '--is-ancestor', $chain[$chain.Count - 1], $name)).Code -ne 0) { if ($depth[$name] -gt $depth[$current]) { break } else { continue } }
        $chain.Add($name)
    }
    if (-not $chain.Contains($current)) { $chain = New-Object 'System.Collections.Generic.List[string]'; $chain.Add($current) }
    $branches = New-Object 'System.Collections.Generic.List[object]'
    for ($i = 0; $i -lt $chain.Count; $i++) {
        $name = $chain[$i]; $f = $all[$name]; $parent = if ($i) { $chain[$i - 1] } else { $Base }
        $ahead = 0; $behind = 0
        if ($f.Count -gt 2 -and $f[2] -match 'ahead (\d+)') { $ahead = [int]$Matches[1] }
        if ($f.Count -gt 2 -and $f[2] -match 'behind (\d+)') { $behind = [int]$Matches[1] }
        $own = 0; [void][int]::TryParse(([string](Invoke-GitCapture $Path @('rev-list', '--count', "$parent..$name")).Output).Trim(), [ref]$own)
        $branches.Add([ordered]@{ name = $name; parent = $parent; target = ($parent -replace '^origin/', ''); commits = $own; subject = $(if ($f.Count -gt 3) { $f[3] } else { '' })
            upstream = $(if ($f.Count -gt 1) { $f[1] } else { '' }); ahead = $ahead; behind = $behind; current = ($name -eq $current) })
    }
    $baseBehind = 0; [void][int]::TryParse(([string](Invoke-GitCapture $Path @('rev-list', '--count', "$($chain[0])..$Base")).Output).Trim(), [ref]$baseBehind)
    return [ordered]@{ base = $Base; current = $current; branches = $branches.ToArray(); baseAhead = $baseBehind; message = '' }
}

# Rebase the whole stack onto the base: `rebase --update-refs <base> <top>` moves every branch of the
# stack; the original branch is checked out again afterwards. Stops cleanly on a conflict.
function Invoke-GitDeckRestack([string]$Path, [string]$Base) {
    $stack = Get-GitDeckBranchStack $Path $Base
    if (-not @($stack.branches).Count) { throw $stack.message }
    $status = ([string](Invoke-GitCapture $Path @('status', '--porcelain', '--untracked-files=no')).Output).Trim()
    if ($status) { throw 'Commit or stash your changes before restacking.' }
    $top = @($stack.branches)[-1].name
    $before = ([string](Invoke-GitCapture $Path @('rev-parse', 'HEAD')).Output).Trim()
    $previousEditor = $env:GIT_EDITOR
    try {
        $env:GIT_EDITOR = ':'
        # --update-refs skips the branch checked out when the rebase starts, so start from the top.
        [void](Invoke-GitOrThrow $Path @('switch', '-q', $top))
        $rebase = Invoke-GitCapture $Path @('rebase', '--update-refs', $stack.base)
        if ($rebase.Code -ne 0) {
            [void](Invoke-GitCapture $Path @('rebase', '--abort'))
            [void](Invoke-GitCapture $Path @('switch', '-q', $stack.current))
            throw ('Restack stopped on a conflict and nothing was changed: ' + ([string]$rebase.Output).Split("`n")[0])
        }
    } finally { $env:GIT_EDITOR = $previousEditor }
    [void](Invoke-GitOrThrow $Path @('switch', '-q', $stack.current))
    return @{ message = "Rebased $(@($stack.branches).Count) branch(es) onto $($stack.base)."; output = ((@($stack.branches) | ForEach-Object { $_.name }) -join ' -> ') }
}

function Invoke-GitDeckStackPush([string]$Path, [string]$Base) {
    $stack = Get-GitDeckBranchStack $Path $Base
    $names = @($stack.branches | ForEach-Object { $_.name })
    if (-not $names.Count) { throw $stack.message }
    $output = Invoke-GitOrThrow $Path (@('push', '-u', '--force-with-lease', 'origin') + $names)
    return @{ message = "Pushed $($names.Count) branch(es) of the stack (force-with-lease)."; output = $output }
}
