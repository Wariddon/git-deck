# Custom actions, like Sourcetree's Tools > Options > Custom Actions: your own programs in the
# right-click menus, with $REPO, $SHA, $FILE and $BRANCH filled in from what you clicked.
# Saved next to the server in git-deck-custom-actions.json (git-ignored, never sent anywhere).
# Dot-sourced by git-dashboard-server.ps1. Windows PowerShell 5.1 compatible, ASCII only.

$script:CustomActionTargets = @('commit', 'file', 'branch', 'repo')
$script:CustomActionsFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'git-deck-custom-actions.json'

function Get-GitDeckCustomActions {
    if (-not (Test-Path -LiteralPath $script:CustomActionsFile -PathType Leaf)) { return @() }
    try { $parsed = Get-Content -LiteralPath $script:CustomActionsFile -Raw -ErrorAction Stop | ConvertFrom-Json } catch { return @() }
    $list = New-Object System.Collections.ArrayList
    # Windows PowerShell 5.1 hands a JSON array over as one object; enumerate both levels.
    foreach ($item in @($parsed)) { foreach ($entry in @($item)) { if ($entry -and $entry.id -and $entry.name -and $entry.command) { [void]$list.Add($entry) } } }
    return $list.ToArray()
}

function Save-GitDeckCustomActions($Actions) {
    $clean = New-Object System.Collections.ArrayList
    foreach ($action in @($Actions)) {
        if ($null -eq $action) { continue }
        $name = ([string]$action.name).Trim(); $command = ([string]$action.command).Trim(); $arguments = ([string]$action.arguments).Trim()
        if (-not $name -or $name.Length -gt 60) { throw 'Each custom action needs a name of at most 60 characters.' }
        if (-not $command -or $command.Length -gt 400 -or $command -match "[`r`n]") { throw "Custom action '$name' needs the program to run." }
        if ($arguments.Length -gt 1000 -or $arguments -match "[`r`n]") { throw "Parameters for '$name' must be one line of at most 1000 characters." }
        $targets = @(@($action.targets) | ForEach-Object { [string]$_ } | Where-Object { $script:CustomActionTargets -contains $_ } | Select-Object -Unique)
        if (-not $targets.Count) { throw "Choose where '$name' appears (commit, file, branch or repository)." }
        $id = [string]$action.id
        if ($id -notmatch '^[0-9a-fA-F-]{8,36}$') { $id = [guid]::NewGuid().ToString() }
        [void]$clean.Add([ordered]@{ id = $id; name = $name; command = $command; arguments = $arguments; targets = $targets; showOutput = [bool]$action.showOutput })
    }
    if ($clean.Count -gt 30) { throw 'At most 30 custom actions can be saved.' }
    $json = ConvertTo-Json -InputObject @($clean.ToArray()) -Depth 5
    if (-not $clean.Count) { $json = '[]' }
    [IO.File]::WriteAllText($script:CustomActionsFile, $json, (New-Object Text.UTF8Encoding($false)))
    return @{ message = "Saved $($clean.Count) custom action(s)."; actions = @(Get-GitDeckCustomActions) }
}

# Fills $REPO / $SHA / $FILE / $BRANCH, each as one quoted argument (quotes the user typed around a
# placeholder are absorbed, so "$FILE" and $FILE give the same result).
function Expand-GitDeckCustomArguments([string]$Arguments, [hashtable]$Values) {
    $result = $Arguments
    foreach ($key in @('REPO', 'SHA', 'FILE', 'BRANCH')) {
        $pattern = '"?\$' + $key + '\b"?'
        if ($result -notmatch $pattern) { continue }
        if (-not $Values.ContainsKey($key) -or -not $Values[$key]) { throw "This action uses `$$key, which is not available here." }
        $quoted = '"' + ([string]$Values[$key] -replace '"', '') + '"'
        $result = [regex]::Replace($result, $pattern, { param($m) $quoted })
    }
    return $result
}

function Invoke-GitDeckCustomAction([string]$Path, [string]$Id, $Body) {
    Assert-Registered $Path
    $action = @(Get-GitDeckCustomActions | Where-Object { [string]$_.id -eq $Id }) | Select-Object -First 1
    if (-not $action) { throw 'Custom action was not found. Open Custom actions and save it again.' }
    $values = @{ REPO = $Path }
    $sha = ([string]$Body.sha).Trim()
    if ($sha) { if ($sha -notmatch '^[0-9a-fA-F]{4,40}$') { throw 'Invalid commit hash.' }; $values.SHA = $sha }
    $file = [string]$Body.file
    if ($file) { $values.FILE = Resolve-GitDeckRepoFile $Path $file }
    $branch = ([string]$Body.branch).Trim()
    if ($branch) { if ($branch -notmatch '^[A-Za-z0-9._/@+-]+$' -or $branch.StartsWith('-')) { throw 'Invalid branch name.' }; $values.BRANCH = $branch }
    $arguments = Expand-GitDeckCustomArguments ([string]$action.arguments) $values
    $command = [string]$action.command
    if ([bool]$action.showOutput) {
        $info = New-Object System.Diagnostics.ProcessStartInfo
        $info.FileName = $command; $info.Arguments = $arguments; $info.WorkingDirectory = $Path
        $info.UseShellExecute = $false; $info.CreateNoWindow = $true
        $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
        $process = [System.Diagnostics.Process]::Start($info)
        $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(120000)) { try { $process.Kill() } catch { }; throw "$($action.name) did not finish within 2 minutes and was stopped." }
        $output = ($stdout.Result + "`n" + $stderr.Result).Trim()
        if ($process.ExitCode -ne 0) { throw "$($action.name) failed (exit code $($process.ExitCode)).`n$output" }
        return @{ message = "$($action.name) finished."; output = $(if ($output) { $output } else { 'No output.' }) }
    }
    if ($arguments) { Start-Process -FilePath $command -ArgumentList $arguments -WorkingDirectory $Path }
    else { Start-Process -FilePath $command -WorkingDirectory $Path }
    return @{ message = "Started $($action.name)." }
}

function Invoke-GitDeckCustomActionRequest($Body) {
    switch ([string]$Body.action) {
        'custom-actions-save' { return Save-GitDeckCustomActions $Body.actions }
        'custom-action-run' { return Invoke-GitDeckCustomAction ([string]$Body.path) ([string]$Body.id) $Body }
    }
    return $null
}
