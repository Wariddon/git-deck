# Smart absorb (like git-absorb / Sapling's absorb): staged changes go into the unpushed commits that
# last touched the same lines, as fixup commits squashed with `rebase --autosquash`. Changes whose
# lines come from several commits, from pushed commits or from new files stay staged for a normal
# commit. Nothing that is pushed is rewritten; Undo restores the previous commits.
# Windows PowerShell 5.1 compatible.

# Staged diff (one line of context) -> files with their header and hunks.
function ConvertFrom-GitDeckStagedDiff([string]$Text) {
    $files = New-Object 'System.Collections.Generic.List[object]'
    $file = $null; $hunk = $null
    foreach ($line in ($Text -split "`n")) {
        $line = $line.TrimEnd("`r")
        if ($line.StartsWith('diff --git ')) {
            $file = [ordered]@{ header = New-Object 'System.Collections.Generic.List[string]'; hunks = New-Object 'System.Collections.Generic.List[object]'; path = ''; isNew = $false; isDeleted = $false; binary = $false }
            $file.header.Add($line); $files.Add($file); $hunk = $null; continue
        }
        if (-not $file) { continue }
        if (-not $hunk) {
            if ($line.StartsWith('@@ ')) {
                if ($line -notmatch '^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@') { continue }
                $hunk = [ordered]@{ oldStart = [int]$Matches[1]; lines = New-Object 'System.Collections.Generic.List[string]' }
                $hunk.lines.Add($line); $file.hunks.Add($hunk); continue
            }
            $file.header.Add($line)
            if ($line -eq '--- /dev/null') { $file.isNew = $true }
            if ($line -eq '+++ /dev/null') { $file.isDeleted = $true }
            if ($line.StartsWith('Binary files') -or $line -eq 'GIT binary patch') { $file.binary = $true }
            if ($line.StartsWith('+++ b/')) { $file.path = $line.Substring(6) }
            elseif ($line.StartsWith('--- a/') -and -not $file.path) { $file.path = $line.Substring(6) }
            continue
        }
        if ($line.StartsWith('@@ ')) {
            if ($line -notmatch '^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@') { continue }
            $hunk = [ordered]@{ oldStart = [int]$Matches[1]; lines = New-Object 'System.Collections.Generic.List[string]' }
            $hunk.lines.Add($line); $file.hunks.Add($hunk); continue
        }
        $hunk.lines.Add($line)
    }
    return $files.ToArray()
}

# Old-file line numbers a hunk is about: the removed lines, or for a pure insertion the context lines
# around it (the lines it was written between).
function Get-GitDeckHunkOldLines($Hunk) {
    $removed = New-Object 'System.Collections.Generic.List[int]'; $context = New-Object 'System.Collections.Generic.List[int]'
    $old = [int]$Hunk.oldStart
    for ($i = 1; $i -lt $Hunk.lines.Count; $i++) {
        $line = $Hunk.lines[$i]
        if ($line.StartsWith('-')) { $removed.Add($old); $old++ }
        elseif ($line.StartsWith(' ')) { $context.Add($old); $old++ }
    }
    if ($removed.Count) { return $removed.ToArray() }
    return $context.ToArray()
}

function Get-GitDeckAbsorbPlan([string]$Path) {
    Assert-Registered $Path
    $diff = Invoke-GitCapture $Path @('-c', 'core.quotepath=false', 'diff', '--cached', '--no-color', '--no-ext-diff', '--no-renames', '-U1', '--src-prefix=a/', '--dst-prefix=b/')
    if ($diff.Code -ne 0) { throw $diff.Output }
    $text = [string]$diff.Output
    if (-not $text.Trim()) { return [ordered]@{ ready = $false; reason = 'Stage the changes to absorb first.'; targets = @(); unassigned = @() } }
    $upstream = Invoke-GitCapture $Path @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}')
    $range = if ($upstream.Code -eq 0) { @('HEAD', '--not', ([string]$upstream.Output).Trim(), '--remotes') } else { @('HEAD', '--not', '--remotes') }
    $commits = @(Get-GitDeckLines (Invoke-GitCapture $Path (@('rev-list', '--max-count=50') + $range)))
    if (-not $commits.Count) { return [ordered]@{ ready = $false; reason = 'There are no unpushed commits on this branch to absorb into.'; targets = @(); unassigned = @() } }
    if (@(Get-GitDeckLines (Invoke-GitCapture $Path (@('rev-list', '--merges', '--max-count=1') + $range))).Count) { return [ordered]@{ ready = $false; reason = 'The unpushed commits include a merge; absorb only works on a straight line of commits.'; targets = @(); unassigned = @() } }
    $order = @{}; for ($i = 0; $i -lt $commits.Count; $i++) { $order[$commits[$i]] = $i }
    $targets = [ordered]@{}; $unassigned = New-Object 'System.Collections.Generic.List[object]'
    foreach ($file in @(ConvertFrom-GitDeckStagedDiff $text)) {
        if ($file.isNew -or $file.isDeleted -or $file.binary -or -not $file.hunks.Count) { $unassigned.Add([ordered]@{ file = $file.path; reason = $(if ($file.isNew) { 'new file' } elseif ($file.isDeleted) { 'deleted file' } else { 'binary file' }) }); continue }
        foreach ($hunk in $file.hunks) {
            $lines = @(Get-GitDeckHunkOldLines $hunk)
            if (-not $lines.Count) { $unassigned.Add([ordered]@{ file = $file.path; reason = 'no lines to compare' }); continue }
            $from = ($lines | Measure-Object -Minimum).Minimum; $to = ($lines | Measure-Object -Maximum).Maximum
            $blame = Invoke-GitCapture $Path @('blame', '--porcelain', '-L', "$from,$to", 'HEAD', '--', $file.path)
            $owners = New-Object 'System.Collections.Generic.HashSet[string]'
            foreach ($row in (([string]$blame.Output) -split "`r?`n")) { if ($row -match '^([0-9a-f]{40}) \d+ (\d+)') { if ($lines -contains [int]$Matches[2]) { [void]$owners.Add($Matches[1]) } } }
            $owner = @($owners)
            if ($blame.Code -ne 0 -or $owner.Count -ne 1) { $unassigned.Add([ordered]@{ file = $file.path; reason = 'lines from several commits' }); continue }
            if (-not $order.ContainsKey($owner[0])) { $unassigned.Add([ordered]@{ file = $file.path; reason = 'lines from a pushed commit' }); continue }
            if (-not $targets.Contains($owner[0])) { $targets[$owner[0]] = [ordered]@{ commit = $owner[0]; files = [ordered]@{} } }
            if (-not $targets[$owner[0]].files.Contains($file.path)) { $targets[$owner[0]].files[$file.path] = [ordered]@{ header = $file.header; hunks = New-Object 'System.Collections.Generic.List[object]' } }
            $targets[$owner[0]].files[$file.path].hunks.Add($hunk)
        }
    }
    $list = New-Object 'System.Collections.Generic.List[object]'
    foreach ($commit in $targets.Keys) {
        $subject = ([string](Invoke-GitCapture $Path @('log', '-1', '--format=%s', $commit)).Output).Trim()
        $hunkCount = 0; foreach ($entry in $targets[$commit].files.Values) { $hunkCount += $entry.hunks.Count }
        $list.Add([ordered]@{ commit = $commit; short = $commit.Substring(0, 8); subject = $subject; order = $order[$commit]; files = @($targets[$commit].files.Keys); hunks = $hunkCount; patch = (ConvertTo-GitDeckAbsorbPatch $targets[$commit].files) })
    }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $fingerprint = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(([string](Invoke-GitCapture $Path @('rev-parse', 'HEAD')).Output).Trim() + "`n" + $text))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
    return [ordered]@{ ready = [bool]$list.Count; reason = $(if ($list.Count) { '' } else { 'No staged change belongs to a single unpushed commit.' }); fingerprint = $fingerprint
        targets = @($list | Sort-Object { $_.order }); unassigned = $unassigned.ToArray() }
}

function ConvertTo-GitDeckAbsorbPatch($Files) {
    $out = New-Object 'System.Collections.Generic.List[string]'
    foreach ($entry in $Files.Values) { foreach ($line in $entry.header) { $out.Add($line) }; foreach ($hunk in $entry.hunks) { foreach ($line in $hunk.lines) { $out.Add($line) } } }
    return ($out -join "`n") + "`n"
}

function Invoke-GitDeckAbsorb([string]$Path, [string]$Fingerprint) {
    $plan = Get-GitDeckAbsorbPlan $Path
    if (-not $plan.ready) { throw $plan.reason }
    if ($Fingerprint -and $plan.fingerprint -ne $Fingerprint) { throw 'The staged changes or the branch changed since the preview. Preview again.' }
    $temp = Join-Path ([IO.Path]::GetTempPath()) ('gitdeck-absorb-' + [guid]::NewGuid().ToString('N'))
    [void](New-Item -ItemType Directory -Path $temp)
    $utf8 = New-Object Text.UTF8Encoding($false)
    $origHead = ([string](Invoke-GitCapture $Path @('rev-parse', 'HEAD')).Output).Trim()
    $staged = Join-Path $temp 'staged.patch'
    [IO.File]::WriteAllText($staged, [string](Invoke-GitCapture $Path @('diff', '--cached', '--binary', '--no-color', '--no-ext-diff')).Output + "`n", $utf8)
    $previousSequence = $env:GIT_SEQUENCE_EDITOR; $previousEditor = $env:GIT_EDITOR
    try {
        # Unstage everything (the working files keep every change), then one fixup commit per target.
        [void](Invoke-GitOrThrow $Path @('reset', '-q'))
        $index = 0
        foreach ($target in $plan.targets) {
            $patch = Join-Path $temp ("target-$index.patch"); $index++
            [IO.File]::WriteAllText($patch, $target.patch, $utf8)
            [void](Invoke-GitOrThrow $Path @('apply', '--cached', '--recount', $patch))
            [void](Invoke-GitOrThrow $Path @('commit', '-q', '--no-verify', "--fixup=$($target.commit)"))
        }
        $oldest = @($plan.targets | Sort-Object { $_.order } -Descending)[0].commit
        $hasParent = (Invoke-GitCapture $Path @('rev-parse', '--verify', '--quiet', "$oldest^")).Code -eq 0
        $env:GIT_SEQUENCE_EDITOR = ':'; $env:GIT_EDITOR = ':'
        $rebase = Invoke-GitCapture $Path $(if ($hasParent) { @('rebase', '-q', '-i', '--autosquash', '--autostash', "$oldest^") } else { @('rebase', '-q', '-i', '--autosquash', '--autostash', '--root') })
        if ($rebase.Code -ne 0) {
            [void](Invoke-GitCapture $Path @('rebase', '--abort'))
            [void](Invoke-GitCapture $Path @('reset', '-q', '--soft', $origHead))
            [void](Invoke-GitCapture $Path @('reset', '-q'))
            [void](Invoke-GitCapture $Path @('apply', '--cached', $staged))
            throw ('Absorb stopped and everything was put back as it was: ' + ([string]$rebase.Output).Split("`n")[0])
        }
    } catch {
        # A failure before the rebase: restore the commit and the staged changes.
        $now = ([string](Invoke-GitCapture $Path @('rev-parse', 'HEAD')).Output).Trim()
        if ($now -ne $origHead -and -not ($_.Exception.Message -like 'Absorb stopped*')) {
            [void](Invoke-GitCapture $Path @('reset', '-q', '--soft', $origHead)); [void](Invoke-GitCapture $Path @('reset', '-q')); [void](Invoke-GitCapture $Path @('apply', '--cached', $staged))
        }
        throw
    } finally {
        $env:GIT_SEQUENCE_EDITOR = $previousSequence; $env:GIT_EDITOR = $previousEditor
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
    }
    $absorbed = 0; foreach ($target in $plan.targets) { $absorbed += $target.hunks }
    $left = @($plan.unassigned).Count
    return @{ message = "Absorbed $absorbed change(s) into $(@($plan.targets).Count) commit(s)." + $(if ($left) { " $left change(s) stay as working changes for a new commit." } else { '' }); output = (($plan.targets | ForEach-Object { "$($_.short) $($_.subject): $($_.hunks) change(s)" }) -join "`n") }
}
