# Run a repository's tests in the background and remember the result for the commit (web/test-run.js).
# Dot-sourced by git-dashboard-server.ps1 and git-job-worker.ps1, so it depends on nothing else.
# Windows PowerShell 5.1 compatible, ASCII only.

# The test command for a repository from its build files, or $null. A wrapper in the repository wins.
function Get-GitDeckTestCommand([string]$Path) {
    $has = { param($name) Test-Path -LiteralPath (Join-Path $Path $name) -PathType Leaf }
    if (& $has 'pom.xml') {
        if (& $has 'mvnw.cmd') { return @{ kind = 'maven'; command = 'mvnw.cmd test' } }
        return @{ kind = 'maven'; command = 'mvn test' }
    }
    if ((& $has 'build.gradle') -or (& $has 'build.gradle.kts')) {
        if (& $has 'gradlew.bat') { return @{ kind = 'gradle'; command = 'gradlew.bat test' } }
        return @{ kind = 'gradle'; command = 'gradle test' }
    }
    if (& $has 'go.mod') { return @{ kind = 'go'; command = 'go test ./...' } }
    if (& $has 'package.json') {
        $script = ''
        try {
            $package = Get-Content -Encoding UTF8 -LiteralPath (Join-Path $Path 'package.json') -Raw | ConvertFrom-Json
            if ($package.scripts) { $script = [string]$package.scripts.test }
        } catch { $script = '' }
        # "npm init" writes a test script that only fails: that is no test at all.
        if ($script -and $script -notmatch 'no test specified') {
            $runner = if (& $has 'pnpm-lock.yaml') { 'pnpm' } elseif (& $has 'yarn.lock') { 'yarn' } else { 'npm' }
            return @{ kind = 'node'; command = "$runner test" }
        }
    }
    if (& $has 'Cargo.toml') { return @{ kind = 'rust'; command = 'cargo test' } }
    if ((& $has 'pytest.ini') -or (& $has 'pyproject.toml') -or (& $has 'tox.ini')) { return @{ kind = 'python'; command = 'python -m pytest' } }
    if (@(Get-ChildItem -LiteralPath $Path -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in @('.sln', '.csproj') }).Count) { return @{ kind = 'dotnet'; command = 'dotnet test' } }
    return $null
}

function Assert-GitDeckTestCommand([string]$Command) {
    if (-not $Command -or $Command.Length -gt 400 -or $Command -match "[`r`n]") { throw 'The test command must be one line of at most 400 characters.' }
}

# What the state of the repository is right now: tests prove a commit only with a clean working tree.
function Get-GitDeckTestState([string]$Path) {
    $head = ([string](& git -C $Path rev-parse HEAD 2>$null)).Trim()
    $dirty = [bool]@(& git -C $Path status --porcelain 2>$null | Where-Object { $_ }).Count
    return @{ head = $head; dirty = $dirty }
}

# Names of the failing tests in the output of the common runners, in order, each once (at most 50).
function Get-GitDeckTestFailures([string]$Output) {
    $found = New-Object 'System.Collections.Generic.List[string]'
    $inMaven = $false
    foreach ($raw in ([string]$Output -split "`r?`n")) {
        $line = ($raw -replace "\x1b\[[0-9;]*[A-Za-z]", '').TrimEnd()
        $name = ''
        if ($line -match '^\[(ERROR|INFO)\]\s+(Failures|Errors):\s*$') { $inMaven = $true; continue }
        if ($inMaven) {
            if ($line -match '^\[(ERROR|INFO)\]\s{2,}(\S.*)$') { $name = $Matches[2] } else { $inMaven = $false }
        }
        if (-not $name) {
            if ($line -match '^\s*--- FAIL: (\S+)') { $name = $Matches[1] }
            elseif ($line -match '^\s*\S*\s*FAILED\s+(\S+::\S+)') { $name = $Matches[1] }
            elseif ($line -match '^\s*(\S.*\S) > (.*\S) FAILED\s*$') { $name = "$($Matches[1]) > $($Matches[2])" }
            elseif ($line -match ('^\s*' + [char]0x25CF + ' (\S.*\S)\s*$')) { $name = $Matches[1] }
            elseif ($line -match '^\s*(?:\S+\s+)?FAIL\s+(\S.* > .*\S)\s*$') { $name = $Matches[1] }
            elseif ($line -match '^test (\S+) \.\.\. FAILED\s*$') { $name = $Matches[1] }
            elseif ($line -match '^\s*Failed (\S+) \[') { $name = $Matches[1] }
            elseif ($line -match '^not ok \d+ - (\S.*)$') { $name = $Matches[1] }
        }
        if ($name -and -not $found.Contains($name)) { $found.Add($name); if ($found.Count -ge 50) { break } }
    }
    return $found.ToArray()
}

# True when the run found nothing to test: a pass then proves nothing.
function Test-GitDeckTestsMissing([string]$Output, [string]$Kind) {
    $text = [string]$Output
    if ($text -match 'No tests to run|No tests found|no tests ran|No test files found|Tests run: 0,|NO-SOURCE') { return $true }
    if ($Kind -eq 'go') {
        $packages = @($text -split "`r?`n" | Where-Object { $_ -match '^(ok|FAIL|\?)\s+\S' })
        return ($packages.Count -gt 0 -and @($packages | Where-Object { $_ -notmatch '^\?' -and $_ -notmatch '\[no test files\]' }).Count -eq 0)
    }
    return $false
}

# The last $Count lines (what a compile error or a crash leaves at the end of the output).
function Get-GitDeckOutputTail([string]$Output, [int]$Count = 40) {
    $lines = @(([string]$Output -replace "\x1b\[[0-9;]*[A-Za-z]", '').TrimEnd() -split "`r?`n")
    return (@($lines | Select-Object -Last $Count) -join "`n")
}

# Runs the command in the repository, writing its output to $LogPath. $OnTick runs about once a second
# while it works (progress, cancel) and may throw to stop it. Returns the exit code.
function Invoke-GitDeckTestProcess([string]$Path, [string]$Command, [string]$LogPath, [int]$TimeoutMinutes, [scriptblock]$OnTick) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $env:ComSpec
    # A cmd inside cmd, so the redirect covers all of "a && b". Output goes to a file: a chatty run can never block on a pipe.
    $info.Arguments = '/d /s /c "cmd /d /s /c "' + $Command + '" > "' + $LogPath + '" 2>&1"'
    $info.WorkingDirectory = $Path; $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    # Test runners that watch for changes (Jest, Vitest) stop after one run with CI set.
    $info.EnvironmentVariables['CI'] = 'true'
    $process = [System.Diagnostics.Process]::Start($info)
    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
    try {
        while (-not $process.WaitForExit(1000)) {
            if ((Get-Date) -gt $deadline) { throw "The tests did not finish within $TimeoutMinutes minutes and were stopped." }
            & $OnTick
        }
        # WaitForExit(int) can return before the exit code is readable.
        $process.WaitForExit()
        return $process.ExitCode
    }
    catch {
        if (-not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F *> $null }
        throw
    }
}

# Reads a log another process may still be writing.
function Read-GitDeckTestLog([string]$LogPath) {
    if (-not (Test-Path -LiteralPath $LogPath -PathType Leaf)) { return '' }
    try {
        $stream = New-Object IO.FileStream($LogPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
        try { $reader = New-Object IO.StreamReader($stream); return $reader.ReadToEnd() } finally { $stream.Dispose() }
    } catch { return '' }
}
