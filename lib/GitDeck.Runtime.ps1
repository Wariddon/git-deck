# Git Deck runtime helpers: static files, parallel read-only requests, live
# repository events (Server-Sent Events) and idle shutdown.
# Dot-sourced by git-dashboard-server.ps1. Windows PowerShell 5.1 compatible.

$script:StaticTypes = @{
    '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'
    '.svg'='image/svg+xml'; '.png'='image/png'; '.ico'='image/x-icon'; '.json'='application/json; charset=utf-8'
}

function Get-GitDeckStaticPath([string]$Route) {
    # Only flat file names inside web/ are served: no folders, no dot-files, no traversal.
    if ($Route -eq '/') { return 'index.html' }
    if ($Route -notmatch '^/([A-Za-z0-9][A-Za-z0-9_-]*\.[a-z]{2,4})$') { return '' }
    $name = $Matches[1]
    if (-not $script:StaticTypes.ContainsKey([IO.Path]::GetExtension($name).ToLowerInvariant())) { return '' }
    return $name
}

function Write-GitDeckStatic($Context, [string]$Route) {
    $name = Get-GitDeckStaticPath $Route
    if (-not $name) { return $false }
    $full = Join-Path $script:WebRoot $name
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { return $false }
    Write-StaticFile $Context $name $script:StaticTypes[[IO.Path]::GetExtension($name).ToLowerInvariant()]
    return $true
}

# ---------------------------------------------------------------------------
# Immutable object cache. Commit details and diffs addressed by a full 40-hex
# hash never change, so they are safe to cache for the life of the server.
# The hashtable is synchronized and shared by every request runspace.
# ---------------------------------------------------------------------------
if (-not $script:ImmutableCache) { $script:ImmutableCache = [hashtable]::Synchronized(@{}) }

function Get-GitDeckImmutable([string]$Key, [scriptblock]$Producer) {
    if ($script:ImmutableCache.ContainsKey($Key)) { return $script:ImmutableCache[$Key] }
    $value = & $Producer
    if ($script:ImmutableCache.Count -ge 400) { $script:ImmutableCache.Clear() }
    $script:ImmutableCache[$Key] = $value
    return $value
}

function Test-GitDeckFullHash([string]$Value) { return ($Value -match '^[0-9a-fA-F]{40}$') }

# ---------------------------------------------------------------------------
# Request pool. GET requests only read Git state, so they run in parallel in a
# RunspacePool. POST actions stay on the main thread and remain serial.
# ---------------------------------------------------------------------------
function New-GitDeckRequestPool([int]$MaxThreads = 4) {
    $iss = [Management.Automation.Runspaces.InitialSessionState]::CreateDefault()
    $root = $script:Root.TrimEnd('\','/')
    foreach ($fn in @(Get-ChildItem function: | Where-Object { $_.ScriptBlock.File -and $_.ScriptBlock.File.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) })) {
        $iss.Commands.Add((New-Object Management.Automation.Runspaces.SessionStateFunctionEntry($fn.Name, $fn.Definition)))
    }
    foreach ($name in $script:SharedVariableNames) {
        $variable = Get-Variable -Name $name -Scope Script -ErrorAction SilentlyContinue
        if ($variable) { $iss.Variables.Add((New-Object Management.Automation.Runspaces.SessionStateVariableEntry($name, $variable.Value, ''))) }
    }
    $pool = [RunspaceFactory]::CreateRunspacePool(1, $MaxThreads, $iss, $Host)
    $pool.Open()
    return $pool
}

$script:PendingRequests = New-Object 'System.Collections.Generic.List[object]'
$script:PooledHandler = {
    param($Context)
    try { Invoke-GitDeckRequest $Context }
    catch { try { if ($Context.Response.OutputStream.CanWrite) { Write-Json $Context @{error=$_.Exception.Message} 400 } } catch {} }
}

function Start-GitDeckPooledRequest($Pool, $Context) {
    $ps = [PowerShell]::Create()
    $ps.RunspacePool = $Pool
    [void]$ps.AddScript($script:PooledHandler).AddArgument($Context)
    $script:PendingRequests.Add([pscustomobject]@{Shell=$ps; Handle=$ps.BeginInvoke()})
}

function Complete-GitDeckPooledRequests {
    for ($i = $script:PendingRequests.Count - 1; $i -ge 0; $i--) {
        $item = $script:PendingRequests[$i]
        if (-not $item.Handle.IsCompleted) { continue }
        try { [void]$item.Shell.EndInvoke($item.Handle) } catch {}
        $item.Shell.Dispose()
        $script:PendingRequests.RemoveAt($i)
    }
}

# ---------------------------------------------------------------------------
# Live repository events. The browser opens /api/events?path=<repo> with
# EventSource; a FileSystemWatcher per watched repository pushes a debounced
# "changed" event so the UI refreshes after edits made in other tools.
# ---------------------------------------------------------------------------
$script:EventClients = New-Object 'System.Collections.Generic.List[object]'
$script:RepoWatchers = @{}
$script:PendingChanges = @{}
$script:LastActivityAt = [DateTime]::UtcNow
$script:EverHadClient = $false

function Test-GitDeckRelevantChange([string]$Root, [string]$FullPath) {
    if (-not $FullPath) { return '' }
    $relative = $FullPath.Substring([Math]::Min($FullPath.Length, $Root.Length)).TrimStart('\','/') -replace '\\','/'
    if ($relative -match '\.lock$') { return '' }
    if ($relative -eq '.git' -or $relative.StartsWith('.git/')) {
        $inner = if ($relative.Length -gt 5) { $relative.Substring(5) } else { '' }
        if ($inner -match '^(HEAD|index|packed-refs|FETCH_HEAD|ORIG_HEAD|MERGE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD|refs/.+|rebase-merge.*|rebase-apply.*)$') { return 'refs' }
        return ''
    }
    if ($relative -match '(^|/)(node_modules|\.gradle|\.vs)(/|$)') { return '' }
    return 'files'
}

function Add-GitDeckRepoWatcher([string]$Path) {
    $key = $Path.ToLowerInvariant()
    if ($script:RepoWatchers.ContainsKey($key)) { return }
    $watcher = New-Object IO.FileSystemWatcher
    $watcher.Path = $Path
    $watcher.IncludeSubdirectories = $true
    $watcher.InternalBufferSize = 65536
    $watcher.NotifyFilter = [IO.NotifyFilters]'FileName, DirectoryName, LastWrite, Size'
    $ids = @()
    foreach ($eventName in @('Changed','Created','Deleted','Renamed')) {
        $id = 'GitDeckFs:' + [Guid]::NewGuid().ToString('N')
        [void](Register-ObjectEvent -InputObject $watcher -EventName $eventName -SourceIdentifier $id -MessageData $Path)
        $ids += $id
    }
    $watcher.EnableRaisingEvents = $true
    $script:RepoWatchers[$key] = [pscustomobject]@{Path=$Path; Watcher=$watcher; Ids=$ids}
}

function Remove-GitDeckRepoWatcher([string]$Key) {
    $entry = $script:RepoWatchers[$Key]
    if (-not $entry) { return }
    foreach ($id in $entry.Ids) { Unregister-Event -SourceIdentifier $id -ErrorAction SilentlyContinue; Remove-Event -SourceIdentifier $id -ErrorAction SilentlyContinue }
    $entry.Watcher.EnableRaisingEvents = $false
    $entry.Watcher.Dispose()
    $script:RepoWatchers.Remove($Key)
}

function Write-GitDeckEvent($Client, [string]$Text) {
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
        $Client.Stream.Write($bytes, 0, $bytes.Length)
        $Client.Stream.Flush()
        return $true
    } catch { return $false }
}

function Add-GitDeckEventClient($Context) {
    $path = [string]$Context.Request.QueryString['path']
    if ($path) { Assert-Registered $path }
    $response = $Context.Response
    $response.StatusCode = 200
    $response.ContentType = 'text/event-stream; charset=utf-8'
    $response.Headers['Cache-Control'] = 'no-store'
    $response.Headers['X-Content-Type-Options'] = 'nosniff'
    $response.SendChunked = $true
    $client = [pscustomobject]@{Context=$Context; Stream=$response.OutputStream; Path=$path; LastPing=[DateTime]::UtcNow}
    if (-not (Write-GitDeckEvent $client "retry: 3000`n: connected`n`n")) { try { $response.Abort() } catch {}; return }
    $script:EventClients.Add($client)
    $script:EverHadClient = $true
    if ($path) { Add-GitDeckRepoWatcher $path }
}

function Close-GitDeckEventClient($Client) {
    [void]$script:EventClients.Remove($Client)
    try { $Client.Context.Response.Abort() } catch {}
}

function Invoke-GitDeckEventPump {
    $now = [DateTime]::UtcNow
    # Drain file-system events queued by the watchers.
    foreach ($item in @(Get-Event -ErrorAction SilentlyContinue | Where-Object { $_.SourceIdentifier -like 'GitDeckFs:*' })) {
        $root = [string]$item.MessageData
        $eventArgs = $item.SourceEventArgs
        $kind = Test-GitDeckRelevantChange $root $eventArgs.FullPath
        if (-not $kind -and $eventArgs -is [IO.RenamedEventArgs]) { $kind = Test-GitDeckRelevantChange $root $eventArgs.OldFullPath }
        Remove-Event -EventIdentifier $item.EventIdentifier -ErrorAction SilentlyContinue
        if (-not $kind) { continue }
        $key = $root.ToLowerInvariant()
        $pending = $script:PendingChanges[$key]
        if (-not $pending) { $pending = [pscustomobject]@{Path=$root; Kinds=@{}; DueAt=$now}; $script:PendingChanges[$key] = $pending }
        $pending.Kinds[$kind] = $true
        $pending.DueAt = $now.AddMilliseconds(700)
    }
    # Emit debounced change notifications.
    foreach ($key in @($script:PendingChanges.Keys)) {
        $pending = $script:PendingChanges[$key]
        if ($pending.DueAt -gt $now) { continue }
        $script:PendingChanges.Remove($key)
        $payload = @{path=$pending.Path; kinds=@($pending.Kinds.Keys); at=$now.ToString('o')} | ConvertTo-Json -Compress
        foreach ($client in @($script:EventClients | Where-Object { $_.Path -and $_.Path.ToLowerInvariant() -eq $key })) {
            if (-not (Write-GitDeckEvent $client "event: changed`ndata: $payload`n`n")) { Close-GitDeckEventClient $client }
        }
    }
    # Keep-alive pings detect closed browser windows.
    foreach ($client in $script:EventClients.ToArray()) {
        if (($now - $client.LastPing).TotalSeconds -lt 15) { continue }
        $client.LastPing = $now
        if (-not (Write-GitDeckEvent $client ": ping`n`n")) { Close-GitDeckEventClient $client }
    }
    # Release watchers nobody listens to any more.
    foreach ($key in @($script:RepoWatchers.Keys)) {
        if (-not @($script:EventClients | Where-Object { $_.Path -and $_.Path.ToLowerInvariant() -eq $key }).Count) { Remove-GitDeckRepoWatcher $key }
    }
    if ($script:EventClients.Count) { $script:LastActivityAt = $now }
}

function Test-GitDeckIdleShutdown([int]$IdleSeconds) {
    # Stops the server once every Git Deck window has closed. Only enabled when
    # the desktop launcher passes -IdleShutdownSeconds.
    if ($IdleSeconds -le 0 -or $script:EventClients.Count -or $script:PendingRequests.Count) { return $false }
    $grace = if ($script:EverHadClient) { $IdleSeconds } else { [Math]::Max($IdleSeconds, 300) }
    return (([DateTime]::UtcNow - $script:LastActivityAt).TotalSeconds -ge $grace)
}

function Stop-GitDeckRuntime {
    foreach ($client in $script:EventClients.ToArray()) { Close-GitDeckEventClient $client }
    foreach ($key in @($script:RepoWatchers.Keys)) { Remove-GitDeckRepoWatcher $key }
}

# Open Git Deck as its own app window (Edge --app: no tabs or address bar) when
# Edge is installed; otherwise fall back to the default browser.
function Get-GitDeckEdgePath {
    foreach ($base in @(${env:ProgramFiles(x86)}, $env:ProgramFiles, $env:LOCALAPPDATA)) {
        if (-not $base) { continue }
        $candidate = Join-Path $base 'Microsoft\Edge\Application\msedge.exe'
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    return $null
}
function Open-GitDeckWindow([string]$Url) {
    $edge = Get-GitDeckEdgePath
    if ($edge) { Start-Process -FilePath $edge -ArgumentList @(('--app="{0}"' -f $Url), '--start-maximized') }
    else { Start-Process $Url }
}
