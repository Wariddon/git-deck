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

# How a coding agent connects to Git Deck's MCP server (mcp/gitdeck-mcp.ps1, read-only), and a
# config file for "claude --mcp-config" written next to it.
function Get-GitDeckMcpSetup {
    $script = Join-Path $script:Root 'mcp\gitdeck-mcp.ps1'
    $available = Test-Path -LiteralPath $script -PathType Leaf
    $configFile = Join-Path $script:Root 'mcp\gitdeck-mcp.json'
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script)
    if ($available) {
        $config = @{ mcpServers = @{ gitdeck = @{ type = 'stdio'; command = 'powershell'; args = $arguments } } } | ConvertTo-Json -Depth 5
        try { if (-not (Test-Path -LiteralPath $configFile) -or [IO.File]::ReadAllText($configFile) -ne $config) { [IO.File]::WriteAllText($configFile, $config, (New-Object Text.UTF8Encoding($false))) } } catch {}
    }
    $argsToml = ($arguments | ForEach-Object { '"' + ($_ -replace '\\', '\\') + '"' }) -join ', '
    return [ordered]@{
        available = $available; script = $script; configFile = $configFile
        claude = "claude mcp add --scope user gitdeck -- powershell $($arguments[0..3] -join ' ') `"$script`""
        codex = "[mcp_servers.gitdeck]`ncommand = `"powershell`"`nargs = [$argsToml]"
        gemini = "gemini mcp add gitdeck powershell $($arguments[0..3] -join ' ') `"$script`""
    }
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
    # Claude Code started here can ask Git Deck itself (pending work, a file across a family, config sources).
    $setup = Get-GitDeckMcpSetup
    if ($chosen.id -eq 'claude' -and $setup.available) {
        $command = $command.Replace("& $(& $quote $chosen.command)", "& $(& $quote $chosen.command) --mcp-config $(& $quote $setup.configFile)")
    }
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $terminal = Get-Command wt.exe -ErrorAction SilentlyContinue
    if ($terminal) { Start-Process $terminal.Source -ArgumentList @('-d', ('"' + $Path + '"'), 'powershell.exe', '-NoExit', '-EncodedCommand', $encoded) }
    else { Start-Process powershell.exe -WorkingDirectory $Path -ArgumentList @('-NoExit', '-EncodedCommand', $encoded) }
    return @{ message = "$($chosen.name) started in $Path." }
}

# ---- Family edit (web/family-edit.js) --------------------------------------------------------
# The same change to one file in many repositories, each in its ticket worktree: the page reads
# the file from where the worktree is (or would start), computes the new text and shows the diff;
# this writes it only if the file still has the text the page saw, commits that file alone and
# optionally pushes feature/<KEY> (GitLab answers with the merge request link).
function Get-GitDeckFamilyEditSource([string]$Path, [string]$Key, [string]$File, [string]$Start) {
    Assert-Registered $Path
    $Key = ([string]$Key).Trim().ToUpperInvariant()
    Assert-GitDeckTicketWorkspaceKey $Key
    $File = ConvertTo-GitDeckRepoFile $File
    $plan = Get-GitDeckTicketWorkspacePlan $Path $Key
    if (Test-Path -LiteralPath (Join-Path $plan.destination '.git')) {
        $full = Join-Path $plan.destination ($File.Replace('/', '\'))
        $exists = Test-Path -LiteralPath $full -PathType Leaf
        return [ordered]@{ from = 'worktree'; ref = $plan.branch; exists = $exists; content = $(if ($exists) { [IO.File]::ReadAllText($full, [Text.Encoding]::UTF8) } else { '' }) }
    }
    $from = ''
    foreach ($candidate in @("refs/heads/$($plan.branch)", "refs/remotes/origin/$($plan.branch)")) {
        if ((Invoke-GitCapture $Path @('show-ref', '--verify', '--quiet', $candidate)).Code -eq 0) { $from = $candidate -replace '^refs/(heads|remotes)/', ''; break }
    }
    if (-not $from) {
        $Start = ([string]$Start).Trim()
        if ($Start) { [void](Resolve-GitRef $Path $Start); $from = $Start }
        else {
            $from = 'HEAD'
            foreach ($candidate in @('origin/develop', 'origin/main', 'origin/master')) { if ((Invoke-GitCapture $Path @('rev-parse', '--verify', '--quiet', "$candidate^{commit}")).Code -eq 0) { $from = $candidate; break } }
        }
    }
    $read = Get-GitDeckRepoFile $Path $File $from
    return [ordered]@{ from = 'ref'; ref = $from; exists = $read.exists; content = $read.content }
}

function ConvertTo-GitDeckPlainText([string]$Text) { return ([string]$Text).Replace("`r`n", "`n").TrimEnd("`n") }

function Invoke-GitDeckFamilyEdit([string]$Path, [string]$Key, [string]$File, [string]$Before, [string]$After, [string]$Message, [bool]$Push, [string]$Start) {
    return Invoke-GitDeckFamilyEditMany $Path $Key @([pscustomobject]@{ file = $File; before = $Before; after = $After }) $Message $Push $Start
}

# Several files of one repository in one commit (a change carried over from a sibling's commit).
# Every file must still have the text the preview saw before anything is written.
function Invoke-GitDeckFamilyEditMany([string]$Path, [string]$Key, $Changes, [string]$Message, [bool]$Push, [string]$Start) {
    $items = @($Changes | Where-Object { $_ } | Select-Object -First 20)
    if (-not $items.Count) { throw 'Nothing to change.' }
    foreach ($item in $items) {
        $item.file = ConvertTo-GitDeckRepoFile ([string]$item.file)
        if ((ConvertTo-GitDeckPlainText ([string]$item.before)) -ceq (ConvertTo-GitDeckPlainText ([string]$item.after))) { throw "Nothing to change in $($item.file)." }
        if (([string]$item.after).Length -gt 1MB) { throw "$($item.file) is larger than 1 MB." }
    }
    $workspace = New-GitDeckTicketWorkspace $Path $Key $Start
    $root = [IO.Path]::GetFullPath($workspace.path).TrimEnd('\') + '\'
    $plans = foreach ($item in $items) {
        $full = [IO.Path]::GetFullPath((Join-Path $workspace.path ($item.file.Replace('/', '\'))))
        if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw 'The file must be inside the repository.' }
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "$($item.file) is not in the worktree." }
        $bytes = [IO.File]::ReadAllBytes($full)
        $current = [IO.File]::ReadAllText($full, [Text.Encoding]::UTF8)
        if ((ConvertTo-GitDeckPlainText $current) -cne (ConvertTo-GitDeckPlainText ([string]$item.before))) { throw "$($item.file) changed since the preview (in $($workspace.path)). Preview again." }
        [pscustomobject]@{ file = $item.file; full = $full; current = $current; after = [string]$item.after; bom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) }
    }
    foreach ($plan in $plans) {
        # Keep the file's line endings, final new line and byte order mark.
        $text = ConvertTo-GitDeckPlainText $plan.after
        if ($plan.current.EndsWith("`n")) { $text += "`n" }
        if ($plan.current.Contains("`r`n")) { $text = $text.Replace("`n", "`r`n") }
        [IO.File]::WriteAllText($plan.full, $text, (New-Object Text.UTF8Encoding($plan.bom)))
    }
    $files = @($plans | ForEach-Object { $_.file })
    $Message = ([string]$Message).Trim()
    $Key = ([string]$Key).Trim().ToUpperInvariant()
    if (-not $Message) { $Message = "$Key update $($files -join ', ')" }
    [void](Invoke-GitOrThrow $workspace.path (@('add', '--') + $files))
    [void](Invoke-GitOrThrow $workspace.path (@('commit', '-q', '-m', $Message, '--') + $files))
    $commit = ([string](Invoke-GitOrThrow $workspace.path @('rev-parse', '--short', 'HEAD'))).Trim()
    $result = [ordered]@{ message = "Committed $commit on $($workspace.branch)."; path = $workspace.path; branch = $workspace.branch; commit = $commit; mergeRequest = '' }
    if ($Push) {
        $output = [string](Invoke-GitOrThrow $workspace.path @('push', '-u', 'origin', $workspace.branch))
        if ($output -match '(https?://\S+?/merge_requests/new\S*)') { $result.mergeRequest = $Matches[1] }
        elseif ($output -match '(https?://\S+?/pull/new/\S+)') { $result.mergeRequest = $Matches[1] }
        $result.message = "Committed $commit and pushed $($workspace.branch)."
    }
    return $result
}

# A commit as line replacements per file (old line -> new line), to carry the same change over to
# sibling repositories. Only hunks that replace lines one for one are carried; additions and
# deletions are listed as skipped, so nothing is guessed.
function Get-GitDeckCommitPairs([string]$Path, [string]$Commit) {
    Assert-Registered $Path
    $Commit = ([string]$Commit).Trim(); if (-not $Commit) { $Commit = 'HEAD' }
    if ($Commit.Length -gt 80 -or $Commit.StartsWith('-') -or $Commit -notmatch '^[A-Za-z0-9._/~^@-]+$') { throw 'Commit is not valid.' }
    $head = ([string](Invoke-GitOrThrow $Path @('log', '-1', '--format=%h%x09%s', $Commit))).Trim() -split "`t", 2
    $patch = [string](Invoke-GitOrThrow $Path @('show', '--format=', '--no-color', '--no-ext-diff', '-U0', $Commit))
    $files = New-Object 'System.Collections.Generic.List[object]'
    $current = $null; $removed = @(); $added = @()
    $flush = {
        if ($current) {
            if ($removed.Count -and $removed.Count -eq $added.Count) { for ($i = 0; $i -lt $removed.Count; $i++) { $current.pairs.Add([ordered]@{ old = $removed[$i]; new = $added[$i] }) } }
            elseif ($removed.Count -or $added.Count) {
                # Uneven hunk: pair a removed line with an added line that starts the same way
                # (the same key or XML tag, a new value); the rest is skipped.
                $used = @{}; $paired = 0
                foreach ($old in $removed) {
                    $a = $old.Trim(); $best = -1; $bestLength = 0
                    for ($j = 0; $j -lt $added.Count; $j++) {
                        if ($used.ContainsKey($j)) { continue }
                        $b = $added[$j].Trim(); $n = 0; $max = [Math]::Min($a.Length, $b.Length)
                        while ($n -lt $max -and $a[$n] -eq $b[$n]) { $n++ }
                        if ($n -ge 5 -and $n -ge 0.4 * [Math]::Max($a.Length, $b.Length) -and $n -gt $bestLength) { $best = $j; $bestLength = $n }
                    }
                    if ($best -ge 0) { $used[$best] = $true; $paired++; $current.pairs.Add([ordered]@{ old = $old; new = $added[$best] }) }
                }
                if ($paired -lt [Math]::Max($removed.Count, $added.Count)) { $current.skipped++ }
            }
        }
    }
    foreach ($line in ($patch -split "`r?`n")) {
        if ($line.StartsWith('diff --git ')) { & $flush; $removed = @(); $added = @(); $current = $null; continue }
        if ($line.StartsWith('+++ ')) { if ($line -match '^\+\+\+ b/(.+)$') { $current = [ordered]@{ file = $Matches[1]; pairs = (New-Object 'System.Collections.Generic.List[object]'); skipped = 0 }; $files.Add($current) }; continue }
        if ($line.StartsWith('--- ')) { continue }
        if ($line.StartsWith('@@')) { & $flush; $removed = @(); $added = @(); continue }
        if ($line.StartsWith('-')) { $removed += $line.Substring(1) } elseif ($line.StartsWith('+')) { $added += $line.Substring(1) }
    }
    & $flush
    return [ordered]@{ commit = $head[0]; subject = $(if ($head.Count -gt 1) { $head[1] } else { '' })
        files = @($files | Select-Object -First 20 | ForEach-Object { [ordered]@{ file = $_.file; pairs = $_.pairs.ToArray(); skipped = $_.skipped } }) }
}
