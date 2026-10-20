# Git Deck MCP server (stdio). Lets a coding agent (Claude Code, Codex, Gemini CLI...) ask the
# running Git Deck about your repositories: pending work, a file across a family, effective
# configuration sources, tickets, activity, push risk. Read-only: it only calls Git Deck's GET API
# on this computer and never commits, pushes or changes a repository.
#
#   claude mcp add gitdeck -- powershell -NoProfile -ExecutionPolicy Bypass -File C:\GitDeck\mcp\gitdeck-mcp.ps1
#
# Git Deck must be open (default http://localhost:8797; set GITDECK_URL to change it).
# Windows PowerShell 5.1 compatible; messages are JSON-RPC 2.0, one per line.
param([string]$BaseUrl = $(if ($env:GITDECK_URL) { $env:GITDECK_URL } else { 'http://localhost:8797' }))

$ErrorActionPreference = 'Stop'
$script:Version = '1.0.0'
$script:Utf8 = New-Object Text.UTF8Encoding($false)
[Console]::InputEncoding = $script:Utf8
[Console]::OutputEncoding = $script:Utf8
$script:Repos = $null

function Get-GitDeckJson([string]$Route, [hashtable]$Query = @{}) {
    $parts = @(foreach ($key in $Query.Keys) { if ($null -ne $Query[$key] -and [string]$Query[$key] -ne '') { [Uri]::EscapeDataString($key) + '=' + [Uri]::EscapeDataString([string]$Query[$key]) } })
    $url = $BaseUrl.TrimEnd('/') + $Route + $(if ($parts.Count) { '?' + ($parts -join '&') } else { '' })
    $client = New-Object Net.WebClient
    $client.Encoding = $script:Utf8
    $client.Headers['Accept'] = 'application/json'
    try { $text = $client.DownloadString($url) }
    catch [Net.WebException] {
        $response = $_.Exception.Response
        if (-not $response) { throw "Git Deck is not running at $BaseUrl. Open Git Deck first." }
        $reader = New-Object IO.StreamReader($response.GetResponseStream(), $script:Utf8)
        $body = $reader.ReadToEnd()
        $message = try { ($body | ConvertFrom-Json).error } catch { $body }
        throw "Git Deck: $message"
    }
    return ($text | ConvertFrom-Json)
}

# Registered repositories, once per session (name, path, branch).
function Get-McpRepos {
    if ($null -eq $script:Repos) { $script:Repos = @((Get-GitDeckJson '/api/repos').repos | Where-Object { $_.valid -ne $false }) }
    return $script:Repos
}

# A repository by name or path; a name shared by several (worktrees) prefers the main folder.
function Resolve-McpRepo([string]$Repo) {
    if (-not $Repo) { throw 'repo is required (a repository name such as crs-webview, or its path).' }
    $all = @(Get-McpRepos)
    $hit = @($all | Where-Object { $_.path -eq $Repo })
    if (-not $hit.Count) { $hit = @($all | Where-Object { $_.name -eq $Repo } | Sort-Object { $_.path -match '\.worktrees\\' }) }
    if (-not $hit.Count) { throw "No registered repository named $Repo. Use list_repositories." }
    return $hit[0]
}

function Select-McpRepos([string]$Prefix, [string]$Folder, [int]$Limit = 80) {
    $list = @(Get-McpRepos | Where-Object { $_.path -notmatch '\.worktrees\\' })
    if ($Prefix) { $list = @($list | Where-Object { $_.name.StartsWith($Prefix, [StringComparison]::OrdinalIgnoreCase) }) }
    if ($Folder) { $list = @($list | Where-Object { $_.path.StartsWith($Folder.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) }) }
    if ($list.Count -gt $Limit) { throw "$($list.Count) repositories match; narrow it with prefix or folder (limit $Limit)." }
    return $list
}

function Get-McpPendingSummary($Pending) {
    $parts = New-Object 'System.Collections.Generic.List[string]'
    if ($Pending.changed -or $Pending.untracked) { $parts.Add("$([int]$Pending.changed + [int]$Pending.untracked) uncommitted file(s)") }
    if ($Pending.ahead) { $parts.Add("$($Pending.ahead) to push") }
    if ($Pending.behind) { $parts.Add("$($Pending.behind) to pull") }
    if ($Pending.upstreamGone) { $parts.Add('remote branch deleted') }
    foreach ($item in @($Pending.unpushedBranches)) { if ($item) { $parts.Add("$($item.branch): $($item.commits) not pushed") } }
    if (@($Pending.stashes).Count) { $parts.Add("$(@($Pending.stashes).Count) stash(es)") }
    if ($Pending.operation) { $parts.Add("$($Pending.operation) in progress") }
    return ($parts -join ', ')
}

$script:Tools = @(
    @{ name = 'list_repositories'; description = 'Repositories registered in Git Deck (name, path, current branch). Filter by name prefix (a family such as crs- or aml-) or folder.'
       inputSchema = @{ type = 'object'; properties = @{ prefix = @{ type = 'string'; description = 'Name prefix, e.g. crs-' }; folder = @{ type = 'string'; description = 'Folder, e.g. C:\SCB' } } } },
    @{ name = 'pending_work'; description = 'What is still open: uncommitted files, commits to push or pull, branches only on this computer, stashes, latest tag and commits after it, last commit. One repository, or every repository of a prefix/folder (only those with something pending, plus those committed in the last 7 days).'
       inputSchema = @{ type = 'object'; properties = @{ repo = @{ type = 'string' }; prefix = @{ type = 'string' }; folder = @{ type = 'string' } } } },
    @{ name = 'read_file'; description = 'A file of a repository, from disk or from a branch or tag (ref).'
       inputSchema = @{ type = 'object'; properties = @{ repo = @{ type = 'string' }; file = @{ type = 'string'; description = 'Path inside the repository, e.g. pom.xml' }; ref = @{ type = 'string' } }; required = @('repo', 'file') } },
    @{ name = 'compare_file_across_family'; description = 'The same file in every repository of a family (name prefix), to find the sibling that differs: with a regular expression the first capture group per repository (e.g. the Docker base image), otherwise the start of the file.'
       inputSchema = @{ type = 'object'; properties = @{ prefix = @{ type = 'string' }; file = @{ type = 'string' }; pattern = @{ type = 'string'; description = 'Regex with one group, e.g. eclipse-temurin:(\S+)' }; ref = @{ type = 'string' }; folder = @{ type = 'string' } }; required = @('prefix', 'file') } },
    @{ name = 'effective_config_sources'; description = 'Spring configuration sources for a service and environment: application.yml, application-{env}.yml, and the files in the deploy repository for that service and environment (ConfigMap / lns-app-configuration). Precedence: deploy files override application-{env} which overrides application.yml; a partial override is a common bug.'
       inputSchema = @{ type = 'object'; properties = @{ repo = @{ type = 'string' }; env = @{ type = 'string'; description = 'dev, sit, uat, prod...' }; deploy_repo = @{ type = 'string' }; ref = @{ type = 'string' }; deploy_ref = @{ type = 'string' } }; required = @('repo', 'env') } },
    @{ name = 'search'; description = 'Search commit messages and branch names (mode commits) or changed content in history (mode content) in one repository or every repository of a prefix.'
       inputSchema = @{ type = 'object'; properties = @{ text = @{ type = 'string' }; repo = @{ type = 'string' }; prefix = @{ type = 'string' }; mode = @{ type = 'string'; enum = @('commits', 'content') } }; required = @('text') } },
    @{ name = 'ticket'; description = 'Where a ticket key (e.g. AP2365-3320) is: branches and commits per repository.'
       inputSchema = @{ type = 'object'; properties = @{ key = @{ type = 'string' }; prefix = @{ type = 'string' }; folder = @{ type = 'string' } }; required = @('key') } },
    @{ name = 'activity'; description = 'Commits in a date range (all branches) with pushed/merged state, for one repository or a prefix. Dates like 2026-10-20.'
       inputSchema = @{ type = 'object'; properties = @{ since = @{ type = 'string' }; until = @{ type = 'string' }; author = @{ type = 'string' }; repo = @{ type = 'string' }; prefix = @{ type = 'string' } }; required = @('since') } },
    @{ name = 'push_risk'; description = 'Push checks of the current branch: risk level and why (secrets, config, migrations, build files), and the checklist to run before pushing.'
       inputSchema = @{ type = 'object'; properties = @{ repo = @{ type = 'string' } }; required = @('repo') } },
    @{ name = 'deploy_map'; description = 'Where a service is deployed: environments, image tags and the deploy files that mention it.'
       inputSchema = @{ type = 'object'; properties = @{ repo = @{ type = 'string' }; ref = @{ type = 'string' } }; required = @('repo') } }
)

function Invoke-McpTool([string]$Name, $Arguments) {
    $a = if ($Arguments) { $Arguments } else { [pscustomobject]@{} }
    $arg = { param($key) $value = $a.PSObject.Properties[$key]; if ($value) { [string]$value.Value } else { '' } }
    switch ($Name) {
        'list_repositories' {
            return ,@(Select-McpRepos (& $arg 'prefix') (& $arg 'folder') 500 | ForEach-Object { [ordered]@{ name = $_.name; path = $_.path; branch = $_.branch } })
        }
        'pending_work' {
            $repo = & $arg 'repo'
            if ($repo) { $r = Resolve-McpRepo $repo; return [ordered]@{ repo = $r.name; path = $r.path; pending = (Get-GitDeckJson '/api/repo/pending' @{ path = $r.path }).pending } }
            $rows = foreach ($r in Select-McpRepos (& $arg 'prefix') (& $arg 'folder') 250) {
                try { $p = (Get-GitDeckJson '/api/repo/pending' @{ path = $r.path }).pending } catch { [ordered]@{ repo = $r.name; error = $_.Exception.Message }; continue }
                $summary = Get-McpPendingSummary $p
                $recent = $false; $when = [DateTimeOffset]::MinValue
                if ([DateTimeOffset]::TryParse([string]$p.lastCommitDate, [ref]$when)) { $recent = ([DateTimeOffset]::Now - $when).TotalDays -lt 7 }
                if ($summary -or $recent) { [ordered]@{ repo = $r.name; branch = $p.branch; pending = $summary; latestTag = $p.latestTag; commitsSinceTag = $p.commitsSinceTag; lastCommit = "$($p.lastCommitDate) $($p.lastCommitSubject)" } }
            }
            return ,@($rows)
        }
        'read_file' {
            $r = Resolve-McpRepo (& $arg 'repo')
            return (Get-GitDeckJson '/api/repo/file' @{ path = $r.path; file = (& $arg 'file'); ref = (& $arg 'ref') }).file
        }
        'compare_file_across_family' {
            $pattern = & $arg 'pattern'
            $regex = if ($pattern) { New-Object Text.RegularExpressions.Regex($pattern) } else { $null }
            $rows = foreach ($r in Select-McpRepos (& $arg 'prefix') (& $arg 'folder') 60) {
                try { $f = (Get-GitDeckJson '/api/repo/file' @{ path = $r.path; file = (& $arg 'file'); ref = (& $arg 'ref') }).file } catch { [ordered]@{ repo = $r.name; error = $_.Exception.Message }; continue }
                if (-not $f.exists) { [ordered]@{ repo = $r.name; exists = $false }; continue }
                if ($regex) { $m = $regex.Match([string]$f.content); [ordered]@{ repo = $r.name; exists = $true; value = $(if ($m.Success) { if ($m.Groups.Count -gt 1) { $m.Groups[1].Value } else { $m.Value } } else { $null }) } }
                else { $text = [string]$f.content; [ordered]@{ repo = $r.name; exists = $true; start = $text.Substring(0, [Math]::Min(1500, $text.Length)) } }
            }
            return ,@($rows)
        }
        'effective_config_sources' {
            $r = Resolve-McpRepo (& $arg 'repo')
            $deploy = & $arg 'deploy_repo'
            $deployPath = if ($deploy) { (Resolve-McpRepo $deploy).path } else { '' }
            return (Get-GitDeckJson '/api/repo/effective-config' @{ path = $r.path; env = (& $arg 'env'); ref = (& $arg 'ref'); deploy = $deployPath; deployRef = (& $arg 'deploy_ref') }).config
        }
        'search' {
            $text = & $arg 'text'; $mode = if ((& $arg 'mode') -eq 'content') { 'content' } else { 'commits' }
            $targets = if (& $arg 'repo') { @(Resolve-McpRepo (& $arg 'repo')) } else { @(Select-McpRepos (& $arg 'prefix') '' 80) }
            $rows = foreach ($r in $targets) {
                try { $found = Get-GitDeckJson '/api/repo/search' @{ path = $r.path; q = $text; mode = $mode } } catch { continue }
                if (@($found.commits).Count -or @($found.branches).Count) { [ordered]@{ repo = $r.name; branches = @($found.branches); commits = @(@($found.commits) | Select-Object -First 20) } }
            }
            return ,@($rows)
        }
        'ticket' {
            $key = (& $arg 'key').Trim().ToUpperInvariant()
            if ($key -notmatch '^[A-Z][A-Z0-9]{1,9}-\d{1,12}$') { throw 'Use a ticket key such as AP2365-3320.' }
            $rows = foreach ($r in Select-McpRepos (& $arg 'prefix') (& $arg 'folder') 250) {
                try { $found = (Get-GitDeckJson '/api/repo/ticket' @{ path = $r.path; key = $key }).ticket } catch { continue }
                if ($found -and (@($found.branches).Count -or @($found.commits).Count)) { [ordered]@{ repo = $r.name; ticket = $found } }
            }
            return ,@($rows)
        }
        'activity' {
            $since = & $arg 'since'; $until = & $arg 'until'; if (-not $until) { $until = (Get-Date).ToString('yyyy-MM-dd') }
            $targets = if (& $arg 'repo') { @(Resolve-McpRepo (& $arg 'repo')) } else { @(Select-McpRepos (& $arg 'prefix') '' 120) }
            $rows = foreach ($r in $targets) {
                try { $found = Get-GitDeckJson '/api/repo/activity' @{ path = $r.path; since = $since; until = $until; author = (& $arg 'author'); merges = 'false' } } catch { continue }
                if (@($found.commits).Count) { [ordered]@{ repo = $r.name; commits = @($found.commits | ForEach-Object { [ordered]@{ date = $_.date; branch = $_.ref; subject = $_.subject; author = $_.author; pushed = $_.pushed; merged = $_.merged } }) } }
            }
            return ,@($rows)
        }
        'push_risk' {
            $r = Resolve-McpRepo (& $arg 'repo')
            $p = (Get-GitDeckJson '/api/repo/pending' @{ path = $r.path }).pending
            if (-not $p.branch) { throw 'No branch is checked out.' }
            $target = if ($p.upstream -and $p.upstream.StartsWith('origin/')) { $p.upstream.Substring(7) } else { $p.branch }
            return (Get-GitDeckJson '/api/repo/push-checks' @{ path = $r.path; remote = 'origin'; local = $p.branch; target = $target; force = 'false' }).pushChecks
        }
        'deploy_map' {
            $r = Resolve-McpRepo (& $arg 'repo')
            return (Get-GitDeckJson '/api/repo/deploy-map' @{ path = $r.path; ref = (& $arg 'ref') }).deploy
        }
        default { throw "Unknown tool: $Name" }
    }
}

function Send-McpMessage($Message) {
    [Console]::Out.WriteLine(($Message | ConvertTo-Json -Depth 20 -Compress))
    [Console]::Out.Flush()
}

function Invoke-McpRequest($Request) {
    $id = $Request.id
    switch ([string]$Request.method) {
        'initialize' {
            $version = if ($Request.params -and $Request.params.protocolVersion) { [string]$Request.params.protocolVersion } else { '2025-06-18' }
            return @{ protocolVersion = $version; capabilities = @{ tools = @{ listChanged = $false } }; serverInfo = @{ name = 'gitdeck'; version = $script:Version }
                instructions = 'Git Deck knows every Git repository registered on this computer. Use it to see pending work, compare a file across a family of services (crs-, aml-, lns-...), find a ticket, or read the configuration sources of a Spring service before changing it. Read-only.' }
        }
        'ping' { return @{} }
        'tools/list' { return @{ tools = $script:Tools } }
        'tools/call' {
            $name = [string]$Request.params.name
            try {
                $result = Invoke-McpTool $name $Request.params.arguments
                $text = if ($null -eq $result) { 'null' } elseif ($result -is [array] -and $result.Count -eq 0) { '[]' } else { ConvertTo-Json -InputObject $result -Depth 12 -Compress }
                if ($text.Length -gt 60000) { $text = $text.Substring(0, 60000) + "`n... (cut at 60000 characters; narrow the request)" }
                return @{ content = @(@{ type = 'text'; text = $text }) }
            } catch {
                return @{ content = @(@{ type = 'text'; text = $_.Exception.Message }); isError = $true }
            }
        }
        default { throw [Management.Automation.ItemNotFoundException]::new("Method not found: $($Request.method)") }
    }
}

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if (-not $line.Trim()) { continue }
    $request = $null
    try { $request = $line | ConvertFrom-Json } catch { Send-McpMessage @{ jsonrpc = '2.0'; id = $null; error = @{ code = -32700; message = 'Parse error' } }; continue }
    $hasId = $null -ne $request.PSObject.Properties['id']
    try {
        $result = Invoke-McpRequest $request
        if ($hasId) { Send-McpMessage @{ jsonrpc = '2.0'; id = $request.id; result = $result } }
    } catch [Management.Automation.ItemNotFoundException] {
        if ($hasId) { Send-McpMessage @{ jsonrpc = '2.0'; id = $request.id; error = @{ code = -32601; message = $_.Exception.Message } } }
    } catch {
        if ($hasId) { Send-McpMessage @{ jsonrpc = '2.0'; id = $request.id; error = @{ code = -32603; message = $_.Exception.Message } } }
    }
}
