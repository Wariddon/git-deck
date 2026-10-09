[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Zip)
# Integration smoke test for an already built portable ZIP. All Git writes and
# the server process are confined to this invocation's disposable directory.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$zipPath = (Resolve-Path -LiteralPath $Zip).Path
# The version the ZIP claims in its name (GitDeck-1.5.0-windows.zip) must be what the server reports.
$expectedVersion = if ([IO.Path]::GetFileName($zipPath) -match 'GitDeck-(\d+\.\d+\.\d+)') { $Matches[1] } else { ([regex]::Match((Get-Content -LiteralPath (Join-Path $root 'Build-Release.ps1') -Raw), "Version='([0-9.]+)'")).Groups[1].Value }
$expected = ((Get-Content -LiteralPath ($zipPath + '.sha256') -Raw).Trim() -split '\s+')[0]
if ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash -ne $expected) { throw 'ZIP checksum mismatch' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $names = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    foreach ($required in @('GitDeck.exe', 'CHANGELOG.md', 'lib/GitDeck.Integrations.ps1', 'web/integrations.js', 'lib/GitDeck.Catalog.ps1', 'web/catalog.js', 'web/catalog.css', 'web/startup-background.css')) {
        if ($names -notcontains $required) { throw "Missing package file: $required" }
    }
    if (@($names | Where-Object { $_ -match '(^|/)(git-repositories\.txt|git-scan-locations\.txt|git-repository-cache\.json|git-deck-.*\.json|git-action-journal\.json|\.env[^/]*|bin|jobs|exports|output)(/|$)' }).Count) { throw 'Private state included in portable ZIP' }
} finally { $archive.Dispose() }
$base = Join-Path $root ('output\portable-smoke-' + [guid]::NewGuid().ToString('N'))
$process = $null
try {
    [void](New-Item -ItemType Directory -Path $base)
    $package = Join-Path $base 'package'
    [IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $package)
    $repo = Join-Path $base 'fixture'
    [void](New-Item -ItemType Directory -Path (Join-Path $repo 'overlays/dev') -Force)
    function Run-Git([string[]]$Arguments) {
        $ErrorActionPreference = 'Continue'
        $output = (& git -C $repo @Arguments 2>&1 | Out-String)
        if ($LASTEXITCODE) { throw $output }
    }
    Run-Git @('init', '-q', '-b', 'main')
    Run-Git @('config', 'user.name', 'Test')
    Run-Git @('config', 'user.email', 't@example.test')
    Run-Git @('config', 'core.autocrlf', 'true')
    $utf8 = New-Object Text.UTF8Encoding($false)
    $manifest = Join-Path $repo 'overlays/dev/deployment.yaml'
    [IO.File]::WriteAllText($manifest, "spec:`n  containers:`n  - image: registry.test/example:1.0.0`n", $utf8)
    Run-Git @('add', '.')
    Run-Git @('commit', '-qm', 'fixture')
    [IO.File]::AppendAllText($manifest, "# local edit`n", $utf8)
    [IO.File]::WriteAllText((Join-Path $package 'git-repositories.txt'), $repo + "`n", $utf8)
    $tcp = New-Object Net.Sockets.TcpListener ([Net.IPAddress]::Loopback), 0
    $tcp.Start(); $port = $tcp.LocalEndpoint.Port; $tcp.Stop()
    $shell = (Get-Process -Id $PID).Path
    $server = Join-Path $package 'git-dashboard-server.ps1'
    $process = Start-Process -FilePath $shell -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $server + '"'), '-NoBrowser', '-Port', $port) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $base 'server.out.log') -RedirectStandardError (Join-Path $base 'server.err.log')
    $url = "http://127.0.0.1:$port/"
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        if ($process.HasExited) { throw 'Portable server exited unexpectedly' }
        try { $health = Invoke-RestMethod ($url + 'api/health') -TimeoutSec 1; $ready = $true; break } catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $ready) { throw 'Portable server did not start' }
    $readiness = Invoke-RestMethod ($url + 'api/readiness')
    if ($readiness.appVersion -ne $expectedVersion) { throw 'Wrong portable server version' }
    $html = (Invoke-WebRequest $url -UseBasicParsing).Content
    if ($html -notmatch '/integrations.js') { throw 'Integration UI missing' }
    $js = (Invoke-WebRequest ($url + 'integrations.js') -UseBasicParsing).Content
    if ($js -notmatch 'not verified live deployments') { throw 'Stale integration UI in ZIP' }
    $query = '?path=' + [Uri]::EscapeDataString($repo)
    $repos = Invoke-RestMethod ($url + 'api/repos')
    if (@($repos.repos).Count -ne 1 -or $repos.repos[0].path -ne $repo) { throw 'Registered fixture missing from fresh roster' }
    $workspace = (Invoke-RestMethod ($url + 'api/repo/workspace' + $query)).workspace
    if ($workspace.operation.conflicts.Count -or $workspace.branch -ne 'main') { throw 'Portable workspace reports false conflicts' }
    $deploy = (Invoke-RestMethod ($url + 'api/repo/deploy-map' + $query)).deploy
    if ($deploy.ref -ne 'HEAD' -or $deploy.entries.Count -ne 1 -or $deploy.entries[0].tag -ne '1.0.0' -or $deploy.entries[0].env -ne 'dev') { throw 'Deploy-map route failed in parallel request pool' }
    $editors = Invoke-RestMethod ($url + 'api/editors')
    if ($null -eq $editors.editors) { throw 'Editors route failed' }
    $catalog = Invoke-RestMethod ($url + 'api/catalog')
    if ($catalog.services.Count -ne 1 -or $catalog.services[0].path -ne $repo) { throw 'Catalog route failed in parallel request pool' }
    $body = @{action='catalog-save';path=$repo;service='Fixture service';kind='service';owner='QA';dependencies=@();environments=@()} | ConvertTo-Json
    [void](Invoke-RestMethod ($url + 'api/action') -Method Post -ContentType 'application/json' -Headers @{'X-Git-Deck'='1'} -Body $body)
    [void](Invoke-RestMethod ($url + 'api/action') -Method Post -ContentType 'application/json' -Headers @{'X-Git-Deck'='1'} -Body $body)
    if ((Invoke-RestMethod ($url + 'api/catalog')).services[0].owner -ne 'QA') { throw 'Catalog save/read route failed' }
    Write-Host 'PASS: ZIP checksum, packaged integrations/catalog, private-state exclusions and isolated parallel HTTP read/write routes'
} finally {
    if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force; [void]$process.WaitForExit(5000) }
    $resolved = [IO.Path]::GetFullPath($base)
    $allowed = [IO.Path]::GetFullPath((Join-Path $root 'output')) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe smoke-test cleanup target' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
