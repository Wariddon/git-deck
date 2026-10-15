# Ticket workspaces (web/ticket-workspaces.js): one Git worktree per repository for a ticket, on
# branch feature/<KEY>, next to the repository (<parent>\<name>.worktrees\<KEY>), registered in Git
# Deck so every view sees it; and a coding agent (Claude Code, Codex, Gemini CLI, Aider) started in
# a terminal in that worktree. Nothing is pushed or committed here. Windows PowerShell 5.1 compatible.

$script:AgentCommands = @(
    @{ id = 'claude'; name = 'Claude Code'; names = @('claude'); extra = @('npm\claude.cmd', '.local\bin\claude.exe') },
    @{ id = 'codex'; name = 'Codex CLI'; names = @('codex'); extra = @('npm\codex.cmd') },
    @{ id = 'gemini'; name = 'Gemini CLI'; names = @('gemini'); extra = @('npm\gemini.cmd') },
    @{ id = 'aider'; name = 'Aider'; names = @('aider'); extra = @() }
)

function Get-GitDeckAgents {
    $found = New-Object 'System.Collections.Generic.List[object]'
    foreach ($agent in $script:AgentCommands) {
        $command = ''
        foreach ($name in $agent.names) { $hit = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1; if ($hit) { $command = $hit.Source; break } }
        if (-not $command) {
            foreach ($relative in $agent.extra) {
                foreach ($base in @($env:APPDATA, $env:USERPROFILE, $env:LOCALAPPDATA)) {
                    if (-not $base) { continue }
                    $candidate = Join-Path $base $relative
                    if (Test-Path -LiteralPath $candidate -PathType Leaf) { $command = $candidate; break }
                }
                if ($command) { break }
            }
        }
        if ($command) { $found.Add([ordered]@{ id = $agent.id; name = $agent.name; command = $command }) }
    }
    return $found.ToArray()
}

function Assert-GitDeckTicketWorkspaceKey([string]$Key) {
    if ($Key -notmatch '^[A-Z][A-Z0-9]{1,9}-\d{1,12}$') { throw 'Use a ticket key, for example PAY-1234.' }
}

# Where the worktree of a repository for a ticket goes, and the branch it uses.
function Get-GitDeckTicketWorkspacePlan([string]$Path, [string]$Key) {
    $root = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $name = Split-Path $root -Leaf
    $destination = Join-Path (Join-Path (Split-Path $root -Parent) "$name.worktrees") $Key
    return [ordered]@{ path = $root; destination = $destination; branch = "feature/$Key" }
}

# Creates (or reuses) the ticket worktree of one repository. Starts from an existing feature/<KEY>
# (local, then origin), otherwise from origin/develop, origin/main, origin/master or HEAD.
function New-GitDeckTicketWorkspace([string]$Path, [string]$Key, [string]$Start) {
    Assert-Registered $Path
    $Key = ([string]$Key).Trim().ToUpperInvariant()
    Assert-GitDeckTicketWorkspaceKey $Key
    $plan = Get-GitDeckTicketWorkspacePlan $Path $Key
    if ((Test-Path -LiteralPath (Join-Path $plan.destination '.git'))) {
        [void](Add-Repository $plan.destination)
        return @{ message = "The worktree for $Key already exists."; path = $plan.destination; branch = $plan.branch; created = $false }
    }
    [void](New-Item -ItemType Directory -Force -Path (Split-Path $plan.destination -Parent))
    $branch = $plan.branch
    $local = (Invoke-GitCapture $Path @('show-ref', '--verify', '--quiet', "refs/heads/$branch")).Code -eq 0
    if ($local) {
        $output = Invoke-GitOrThrow $Path @('worktree', 'add', $plan.destination, $branch)
    } else {
        $remote = (Invoke-GitCapture $Path @('show-ref', '--verify', '--quiet', "refs/remotes/origin/$branch")).Code -eq 0
        $Start = ([string]$Start).Trim()
        if ($remote) { $from = "origin/$branch" }
        elseif ($Start) { [void](Resolve-GitRef $Path $Start); $from = $Start }
        else {
            $from = 'HEAD'
            foreach ($candidate in @('origin/develop', 'origin/main', 'origin/master')) { if ((Invoke-GitCapture $Path @('rev-parse', '--verify', '--quiet', "$candidate^{commit}")).Code -eq 0) { $from = $candidate; break } }
        }
        # A new ticket branch has no upstream yet (not origin/develop): the first push publishes it.
        $arguments = @('worktree', 'add', '--no-track', '-b', $branch, $plan.destination, $from)
        if ($remote) { $arguments = @('worktree', 'add', '--track', '-b', $branch, $plan.destination, $from) }
        $output = Invoke-GitOrThrow $Path $arguments
    }
    [void](Add-Repository $plan.destination)
    return @{ message = "Worktree for $Key created at $($plan.destination) on $branch."; output = $output; path = $plan.destination; branch = $branch; created = $true }
}

# Registered repositories that are linked worktrees (".git" is a file), with their main repository
# and a short status, for the Ticket workspaces list.
function Get-GitDeckTicketWorkspaces {
    $items = New-Object 'System.Collections.Generic.List[object]'
    foreach ($path in @(Get-Repositories)) {
        $marker = Join-Path $path '.git'
        if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { continue }
        $gitdir = ''
        try { $gitdir = ([IO.File]::ReadAllText($marker) -replace '^gitdir:\s*', '').Trim() } catch { continue }
        # <main>\.git\worktrees\<name>  ->  <main>
        $main = if ($gitdir -match '^(.*)[\\/]\.git[\\/]worktrees[\\/][^\\/]+$') { [IO.Path]::GetFullPath($Matches[1]) } else { '' }
        $status = Invoke-GitCapture $path @('status', '--porcelain=v1', '--branch')
        $lines = @(([string]$status.Output) -split "`r?`n" | Where-Object { $_ })
        $header = if ($lines.Count -and $lines[0].StartsWith('## ')) { $lines[0].Substring(3) } else { '' }
        $ahead = 0; $behind = 0
        if ($header -match 'ahead (\d+)') { $ahead = [int]$Matches[1] }
        if ($header -match 'behind (\d+)') { $behind = [int]$Matches[1] }
        $branch = Get-GitDeckHeaderBranch $header
        $key = if ($branch -match '([A-Z][A-Z0-9]{1,9}-\d{1,12})') { $Matches[1] } else { '' }
        $items.Add([ordered]@{ path = $path; main = $main; mainName = $(if ($main) { Split-Path $main -Leaf } else { '' }); branch = $branch; key = $key
            changes = @($lines | Where-Object { -not $_.StartsWith('## ') }).Count; ahead = $ahead; behind = $behind; upstream = $(if ($header -match '\.\.\.(\S+)') { $Matches[1] } else { '' }) })
    }
    return $items.ToArray()
}

# Opens a terminal in a registered worktree and starts the agent with an optional first prompt
# (passed through a temporary file, so quotes and new lines arrive intact).
function Start-GitDeckAgent([string]$Path, [string]$Agent, [string]$Prompt) {
    Assert-Registered $Path
    $chosen = @(Get-GitDeckAgents | Where-Object { $_.id -eq $Agent }) | Select-Object -First 1
    if (-not $chosen) { throw "$Agent was not found. Install it (for example: npm install -g @anthropic-ai/claude-code) and open a new Git Deck window." }
    $Prompt = ([string]$Prompt)
    if ($Prompt.Length -gt 4000) { throw 'The first prompt is longer than 4000 characters.' }
    $quote = { param($value) "'" + ($value -replace "'", "''") + "'" }
    $command = "Set-Location -LiteralPath $(& $quote $Path); "
    if ($Prompt.Trim()) {
        $file = Join-Path ([IO.Path]::GetTempPath()) ('gitdeck-agent-' + [guid]::NewGuid().ToString('N') + '.txt')
        [IO.File]::WriteAllText($file, $Prompt, (New-Object Text.UTF8Encoding($false)))
        $command += "`$prompt = Get-Content -Raw -Encoding UTF8 -LiteralPath $(& $quote $file); Remove-Item -LiteralPath $(& $quote $file); & $(& $quote $chosen.command) `$prompt"
    } else { $command += "& $(& $quote $chosen.command)" }
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $terminal = Get-Command wt.exe -ErrorAction SilentlyContinue
    if ($terminal) { Start-Process $terminal.Source -ArgumentList @('-d', ('"' + $Path + '"'), 'powershell.exe', '-NoExit', '-EncodedCommand', $encoded) }
    else { Start-Process powershell.exe -WorkingDirectory $Path -ArgumentList @('-NoExit', '-EncodedCommand', $encoded) }
    return @{ message = "$($chosen.name) started in $Path." }
}
