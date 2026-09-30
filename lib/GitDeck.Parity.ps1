# Git Deck file actions that Sourcetree offers from its context menus: ignore,
# stop tracking, remove untracked (to the Recycle Bin, unlike Sourcetree's delete),
# open a file as it was in a commit, and reset a file to a commit.
# Dot-sourced by git-dashboard-server.ps1. Windows PowerShell 5.1 compatible.

function Resolve-GitDeckRepoFile([string]$Path, [string]$File) {
    # Full path of a repository-relative file; refuses anything outside the working tree.
    if (-not $File -or $File -match "[`r`n]" -or $File.StartsWith('-')) { throw 'File path is required.' }
    $root = [IO.Path]::GetFullPath($Path).TrimEnd('\') + '\'
    $full = [IO.Path]::GetFullPath((Join-Path $Path ($File -replace '/', '\')))
    if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or $full.TrimEnd('\') -eq $root.TrimEnd('\')) { throw 'File is outside the repository.' }
    if ($full.StartsWith($root + '.git\', [StringComparison]::OrdinalIgnoreCase) -or $full.TrimEnd('\') -eq ($root + '.git')) { throw 'Git internals cannot be changed here.' }
    return $full
}

function Add-GitDeckIgnorePattern([string]$Path, [string]$Pattern) {
    $Pattern = $Pattern.Trim()
    if (-not $Pattern -or $Pattern.Length -gt 300 -or $Pattern -match "[`r`n]" -or $Pattern.StartsWith('#')) { throw 'Invalid ignore pattern.' }
    $ignorePath = Join-Path $Path '.gitignore'
    $text = if (Test-Path -LiteralPath $ignorePath -PathType Leaf) { [IO.File]::ReadAllText($ignorePath) } else { '' }
    $lines = @($text -split "`r?`n" | ForEach-Object { $_.Trim() })
    if ($lines -contains $Pattern) { return @{ message = "$Pattern is already in .gitignore."; output = $ignorePath } }
    $newline = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
    $prefix = if ($text -and -not $text.EndsWith("`n")) { $newline } else { '' }
    [IO.File]::AppendAllText($ignorePath, $prefix + $Pattern + $newline, (New-Object Text.UTF8Encoding($false)))
    # Ignoring does not untrack files that are already committed.
    $tracked = @((Invoke-GitCapture $Path @('-c', 'core.quotepath=off', 'ls-files', '--cached', '--ignored', '--exclude', $Pattern)).Output -split "`r?`n" | Where-Object { $_ })
    $note = if ($tracked.Count) { " $($tracked.Count) tracked file(s) match; use Stop tracking to remove them from Git." } else { '' }
    return @{ message = "Added $Pattern to .gitignore. Review and commit .gitignore.$note"; output = $ignorePath }
}

function Remove-GitDeckUntracked([string]$Path, [string]$File) {
    $full = Resolve-GitDeckRepoFile $Path $File
    $status = Invoke-GitCapture $Path @('-c', 'core.quotepath=off', 'status', '--porcelain=v1', '--untracked-files=all', '--', $File)
    $lines = @($status.Output -split "`r?`n" | Where-Object { $_ })
    if ($status.Code -ne 0 -or -not $lines.Count -or @($lines | Where-Object { -not $_.StartsWith('??') }).Count) { throw 'Only untracked files are removed here. Use Discard for tracked changes.' }
    Add-Type -AssemblyName Microsoft.VisualBasic
    $ui = [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs; $bin = [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
    if (Test-Path -LiteralPath $full -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($full, $ui, $bin) }
    elseif (Test-Path -LiteralPath $full -PathType Leaf) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($full, $ui, $bin) }
    else { throw 'File was not found.' }
    return @{ message = "Moved $File to the Recycle Bin."; output = $full }
}

function Stop-GitDeckTracking([string]$Path, [string]$File) {
    [void](Resolve-GitDeckRepoFile $Path $File)
    $tracked = Invoke-GitCapture $Path @('ls-files', '--error-unmatch', '--', $File)
    if ($tracked.Code -ne 0) { throw 'File is not tracked by Git.' }
    $output = Invoke-GitOrThrow $Path @('rm', '--cached', '-r', '--quiet', '--', $File)
    return @{ message = "Git stops tracking $File on the next commit. The file stays on disk; add it to .gitignore to keep it out."; output = $output }
}

function Save-GitDeckRevision([string]$Path, [string]$Commit, [string]$File) {
    # Writes the file as it was in $Commit to a temp folder (binary-safe) and returns its path.
    Assert-CommitHash $Path $Commit
    [void](Resolve-GitDeckRepoFile $Path $File)
    $spec = "${Commit}:$File"
    if ((Invoke-GitCapture $Path @('cat-file', '-e', $spec)).Code -ne 0) { throw "$File does not exist in $Commit." }
    $folder = Join-Path ([IO.Path]::GetTempPath()) ("GitDeck\revisions\" + $Commit.Substring(0, [Math]::Min(10, $Commit.Length)))
    [void](New-Item -ItemType Directory -Path $folder -Force)
    $target = Join-Path $folder ([IO.Path]::GetFileName(($File -replace '/', '\')))
    $info = New-Object Diagnostics.ProcessStartInfo 'git.exe'
    $info.Arguments = "-C `"$Path`" cat-file blob `"$spec`""
    $info.UseShellExecute = $false; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true; $info.CreateNoWindow = $true
    $process = [Diagnostics.Process]::Start($info)
    $stream = [IO.File]::Create($target)
    try { $process.StandardOutput.BaseStream.CopyTo($stream) } finally { $stream.Dispose() }
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "Could not read $File from $Commit. $($process.StandardError.ReadToEnd())" }
    return $target
}

function Test-GitDeckRunnableFile([string]$File) {
    $extension = [IO.Path]::GetExtension($File).ToLowerInvariant()
    return $extension -in @('.exe', '.com', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta', '.msi', '.msp', '.scr', '.cpl', '.dll', '.lnk', '.url', '.reg', '.jar', '.appref-ms', '.application', '.gadget', '.inf', '.sct', '.pif', '')
}

function Restore-GitDeckFileAt([string]$Path, [string]$Commit, [string]$File) {
    Assert-CommitHash $Path $Commit
    [void](Resolve-GitDeckRepoFile $Path $File)
    if ((Invoke-GitCapture $Path @('cat-file', '-e', "${Commit}:$File")).Code -ne 0) { throw "$File does not exist in $Commit." }
    $status = Invoke-GitCapture $Path @('status', '--porcelain=v1', '--', $File)
    if ($status.Output) { throw "$File has uncommitted changes. Commit, stash or discard them first so nothing is lost." }
    $output = Invoke-GitOrThrow $Path @('restore', "--source=$Commit", '--worktree', '--', $File)
    return @{ message = "$File now matches $($Commit.Substring(0, [Math]::Min(8, $Commit.Length))). The change is in File Status; discard it to undo."; output = $output }
}

function Open-GitDeckExternalDiff([string]$Path, [string]$File, [string]$Commit) {
    # Sourcetree "External Diff": VS Code side by side. Without a commit: HEAD vs the working
    # file. With a commit: the file before that commit vs after it. Temp copies only.
    $code = Get-Command code.cmd -ErrorAction SilentlyContinue
    if (-not $code) { throw 'VS Code (code) was not found in PATH. Install VS Code with "Add to PATH".' }
    $full = Resolve-GitDeckRepoFile $Path $File
    $empty = Join-Path ([IO.Path]::GetTempPath()) 'GitDeck\revisions\empty'
    $blank = { param($name) [void](New-Item -ItemType Directory -Path $empty -Force); $f = Join-Path $empty $name; [IO.File]::WriteAllText($f, ''); $f }
    $name = [IO.Path]::GetFileName(($File -replace '/', '\'))
    $exists = { param($ref) (Invoke-GitCapture $Path @('cat-file', '-e', "${ref}:$File")).Code -eq 0 }
    if ($Commit) {
        Assert-CommitHash $Path $Commit
        $hash = (Invoke-GitOrThrow $Path @('rev-parse', $Commit)).Trim()
        $parent = Invoke-GitCapture $Path @('rev-parse', '--verify', '--quiet', "$hash^")
        $left = if ($parent.Code -eq 0 -and (& $exists $parent.Output.Trim())) { Save-GitDeckRevision $Path $parent.Output.Trim() $File } else { & $blank ("(none) " + $name) }
        $right = if (& $exists $hash) { Save-GitDeckRevision $Path $hash $File } else { & $blank ("(deleted) " + $name) }
        $label = "$($hash.Substring(0, 8))^ <-> $($hash.Substring(0, 8))"
    } else {
        $head = Invoke-GitCapture $Path @('rev-parse', '--verify', '--quiet', 'HEAD')
        $left = if ($head.Code -eq 0 -and (& $exists 'HEAD')) { Save-GitDeckRevision $Path $head.Output.Trim() $File } else { & $blank ("(new) " + $name) }
        $right = if (Test-Path -LiteralPath $full -PathType Leaf) { $full } else { & $blank ("(deleted) " + $name) }
        $label = 'HEAD <-> working copy'
    }
    Start-Process -FilePath $code.Source -ArgumentList @('--diff', ('"' + $left + '"'), ('"' + $right + '"'))
    return @{ message = "Opened $File in VS Code ($label)."; output = "$left`r`n$right" }
}

function Invoke-GitDeckParityAction($Body) {
    $path = [string]$Body.path
    switch ([string]$Body.action) {
        'ignore-add' { return Add-GitDeckIgnorePattern $path ([string]$Body.pattern) }
        'untracked-recycle' { return Remove-GitDeckUntracked $path ([string]$Body.file) }
        'untrack-file' { return Stop-GitDeckTracking $path ([string]$Body.file) }
        'file-restore-at' { return Restore-GitDeckFileAt $path ([string]$Body.commit) ([string]$Body.file) }
        'external-diff' { return Open-GitDeckExternalDiff $path ([string]$Body.file) ([string]$Body.commit) }
        'file-open-revision' {
            $saved = Save-GitDeckRevision $path ([string]$Body.commit) ([string]$Body.file)
            $short = ([string]$Body.commit).Substring(0, [Math]::Min(8, ([string]$Body.commit).Length))
            # Opening runs the default handler: never execute scripts or programs from history.
            if (Test-GitDeckRunnableFile $saved) {
                Start-Process explorer.exe -ArgumentList @('/select,', ('"' + $saved + '"'))
                return @{ message = "Saved $([string]$Body.file) as of $short and showed it in Explorer (runnable files are not opened automatically)."; output = $saved }
            }
            Start-Process -FilePath $saved
            return @{ message = "Opened $([string]$Body.file) as of $short (a copy in the temp folder)."; output = $saved }
        }
    }
    return $null
}
