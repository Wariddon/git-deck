# Local service metadata and opt-in read-only tool snapshots. No credentials are stored.
$script:CatalogFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'git-deck-catalog.json'

function Get-GitDeckCatalogEntries {
    if (-not (Test-Path -LiteralPath $script:CatalogFile -PathType Leaf)) { return @() }
    try {
        $saved = Get-Content -LiteralPath $script:CatalogFile -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
        if ($saved.schema -ne 1 -or $saved.entries -isnot [Array]) { throw 'Unknown schema or invalid entries' }
        $paths = @{}
        foreach ($entry in $saved.entries) {
            if ($entry -isnot [PSCustomObject] -or $entry.path -isnot [string] -or -not $entry.path.Trim() -or $paths.ContainsKey($entry.path)) { throw 'Invalid or duplicate service entry' }
            if ($null -ne $entry.dependencies -and $entry.dependencies -isnot [Array]) { throw 'Invalid dependencies' }
            if ($null -ne $entry.environments -and $entry.environments -isnot [Array]) { throw 'Invalid environments' }
            foreach ($dependency in $entry.dependencies) { if ($dependency -isnot [string] -or -not $dependency.Trim()) { throw 'Invalid dependency path' } }
            foreach ($binding in $entry.environments) {
                if ($binding -isnot [PSCustomObject] -or $binding.env -isnot [string] -or $binding.app -isnot [string] -or $binding.context -isnot [string]) { throw 'Invalid environment binding' }
            }
            foreach ($field in @('service','owner','system','kind','description','docs','ci','updatedAt')) { if ($null -ne $entry.$field -and $entry.$field -isnot [string]) { throw 'Invalid metadata field' } }
            $paths[$entry.path] = $true
        }
        return @($saved.entries)
    } catch { throw 'Service metadata could not be read. The existing catalog file has been preserved.' }
}

function Get-GitDeckServiceCatalog {
    $saved = @(Get-GitDeckCatalogEntries)
    return @(foreach ($path in Get-Repositories) {
        $meta = $saved | Where-Object { [string]::Equals($_.path, $path, [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
        $name = Split-Path $path -Leaf
        $kind = if (Test-Path -LiteralPath (Join-Path $path 'pom.xml')) { 'service' } elseif (Test-Path -LiteralPath (Join-Path $path 'package.json')) { 'application' } else { 'repository' }
        [ordered]@{
            path = $path; name = $name; service = $(if ($meta.service) { $meta.service } else { $name })
            owner = [string]$meta.owner; system = [string]$meta.system; description = [string]$meta.description
            kind = $(if ($meta.kind) { $meta.kind } else { $kind }); docs = [string]$meta.docs; ci = [string]$meta.ci
            dependencies = @($meta.dependencies | Where-Object { $_ }); environments = @($meta.environments | Where-Object { $_ })
            updatedAt = [string]$meta.updatedAt; available = (Test-Path -LiteralPath $path -PathType Container)
        }
    })
}

function ConvertTo-GitDeckCatalogText($Value, [int]$Limit = 200) {
    $text = ([string]$Value).Trim()
    if ($text.Length -gt $Limit -or $text -match '[\x00-\x1f\x7f]') { throw 'Metadata is too long or contains control characters.' }
    return $text
}

function ConvertTo-GitDeckCatalogUrl($Value) {
    $text = ConvertTo-GitDeckCatalogText $Value 1000
    if (-not $text) { return '' }
    $uri = $null
    if (-not [Uri]::TryCreate($text, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -notin @('https', 'http') -or $uri.UserInfo -or $uri.Query -match '(?i)(token|password|secret|api[_-]?key)=') { throw 'Use an HTTP(S) link without credentials.' }
    return $uri.AbsoluteUri
}

function Save-GitDeckServiceMetadata([string]$Path, $Body) {
    Assert-Registered $Path
    $kind = ConvertTo-GitDeckCatalogText $Body.kind
    if ($kind -notin @('service', 'application', 'library', 'infrastructure', 'repository')) { throw 'Choose a supported service type.' }
    $dependencies = @($Body.dependencies | Select-Object -Unique)
    if ($dependencies.Count -gt 50) { throw 'At most 50 dependencies are allowed.' }
    foreach ($dep in $dependencies) { if ($dep -isnot [string] -or [string]::Equals($dep, $Path, [StringComparison]::OrdinalIgnoreCase)) { throw 'Choose a valid dependency other than this service.' } }
    $environments = @($Body.environments | Where-Object { $_ })
    if ($environments.Count -gt 8) { throw 'At most 8 environments are allowed.' }
    $seen = @{}
    $bindings = @(foreach ($env in $environments) {
        $name = (ConvertTo-GitDeckCatalogText $env.env 30).ToLowerInvariant()
        $app = ConvertTo-GitDeckCatalogText $env.app 253
        $context = ConvertTo-GitDeckCatalogText $env.context 200
        $namespace = ConvertTo-GitDeckCatalogText $env.namespace 63
        if ($name -notmatch '^[a-z0-9][a-z0-9_-]*$' -or $seen.ContainsKey($name)) { throw 'Environment names must be unique.' }
        if ($app -notmatch '^[a-z0-9][a-z0-9.-]*$' -or -not $context -or $context -notmatch '^[A-Za-z0-9][A-Za-z0-9._:/@-]*$' -or ($namespace -and $namespace -notmatch '^[a-z0-9][a-z0-9-]*$')) { throw 'Set a valid Argo application, explicit context and optional namespace.' }
        $seen[$name] = $true
        [ordered]@{ env = $name; app = $app; context = $context; namespace = $namespace }
    })
    $entry = [ordered]@{
        path = $Path; service = (ConvertTo-GitDeckCatalogText $Body.service); kind = $kind
        owner = (ConvertTo-GitDeckCatalogText $Body.owner); system = (ConvertTo-GitDeckCatalogText $Body.system)
        description = (ConvertTo-GitDeckCatalogText $Body.description 1000)
        docs = (ConvertTo-GitDeckCatalogUrl $Body.docs); ci = (ConvertTo-GitDeckCatalogUrl $Body.ci)
        dependencies = $dependencies; environments = $bindings; updatedAt = [DateTime]::UtcNow.ToString('o')
    }
    if (-not $entry.service) { throw 'Service name is required.' }
    # Serialize read-modify-write across request runspaces; atomic replace alone loses concurrent edits.
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $lockKey = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($script:CatalogFile.ToLowerInvariant()))).Replace('-', '') } finally { $hash.Dispose() }
    $mutex = New-Object Threading.Mutex($false, ('Local\GitDeckCatalog_' + $lockKey))
    $locked = $false
    try {
        try { $locked = $mutex.WaitOne(5000) } catch [Threading.AbandonedMutexException] { $locked = $true }
        if (-not $locked) { throw 'Another metadata save is in progress. Try again.' }
        $current = @(Get-GitDeckCatalogEntries)
        $previous = $current | Where-Object { [string]::Equals($_.path, $Path, [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
        $hasVersion = if ($Body -is [Collections.IDictionary]) { $Body.Contains('expectedUpdatedAt') } else { $null -ne $Body.PSObject.Properties['expectedUpdatedAt'] }
        if ($hasVersion -and [string]$Body.expectedUpdatedAt -cne [string]$previous.updatedAt) { throw 'Metadata changed in another window. Copy your edits, refresh the catalog and try again.' }
        foreach ($dep in $dependencies) {
            # Preserve an existing reference even if its repository was removed from the inventory.
            if ($dep -notin @($previous.dependencies)) { Assert-Registered $dep }
        }
        $entries = @($current | Where-Object { -not [string]::Equals($_.path, $Path, [StringComparison]::OrdinalIgnoreCase) }) + @($entry)
        $temp = $script:CatalogFile + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
        try {
            [IO.File]::WriteAllText($temp, (@{schema=1;entries=$entries} | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
            if (Test-Path -LiteralPath $script:CatalogFile) { [IO.File]::Replace($temp, $script:CatalogFile, [Management.Automation.Language.NullString]::Value) } else { [IO.File]::Move($temp, $script:CatalogFile) }
        } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force } }
    } finally { if ($locked) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
    return @{ message = 'Service metadata saved on this computer.'; service = $entry }
}

function Invoke-GitDeckArgoCapture([string[]]$Arguments) {
    $command = Get-Command argocd.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) { throw 'Install Argo CD CLI and sign in to the configured context first.' }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $command.Source; $info.Arguments = $Arguments -join ' '
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    try {
        [void]$process.Start()
        $output = $process.StandardOutput.ReadToEndAsync(); $errorOutput = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(15000)) { $process.Kill(); throw 'Argo CD read timed out. No deployment action was requested.' }
        $text = $output.Result
        if ($process.ExitCode -ne 0) { throw 'Argo CD read failed. Check CLI sign-in, context and application permissions.' }
        if ($text.Length -gt 2000000) { throw 'Argo CD response is too large.' }
        return $text
    } finally { $process.Dispose() }
}

function Get-GitDeckObservedEnvironment([string]$Path, [string]$Env) {
    Assert-Registered $Path
    $entry = @(Get-GitDeckCatalogEntries | Where-Object { [string]::Equals($_.path, $Path, [StringComparison]::OrdinalIgnoreCase) }) | Select-Object -First 1
    $binding = @($entry.environments | Where-Object { $_.env -eq $Env }) | Select-Object -First 1
    if (-not $binding) { throw 'Configure an Argo CD application for this environment in Service catalog first.' }
    # Re-validate persisted fields; never accept switches or an implicit/current context.
    if ($binding.app -notmatch '^[a-z0-9][a-z0-9.-]*$' -or -not $binding.context -or $binding.context -notmatch '^[A-Za-z0-9][A-Za-z0-9._:/@-]*$' -or ($binding.namespace -and $binding.namespace -notmatch '^[a-z0-9][a-z0-9-]*$')) { throw 'Invalid saved Argo CD binding.' }
    $arguments = @('app', 'get', [string]$binding.app, '--argocd-context', [string]$binding.context, '--output', 'json', '--timeout', '10')
    if ($binding.namespace) { $arguments += @('--app-namespace', [string]$binding.namespace) }
    $data = Invoke-GitDeckArgoCapture $arguments | ConvertFrom-Json -ErrorAction Stop
    if ($data.metadata.name -ne $binding.app) { throw 'Argo CD returned a different application. Environment status is unknown.' }
    return [ordered]@{
        env = $Env; app = $binding.app; source = 'Argo CD'; sync = [string]$data.status.sync.status; health = [string]$data.status.health.status
        revision = [string]$data.status.sync.revision; revisions = @($data.status.sync.revisions | Where-Object { $_ })
        images = @($data.status.summary.images | Where-Object { $_ }); reconciledAt = [string]$data.status.reconciledAt
        checkedAt = [DateTime]::UtcNow.ToString('o')
    }
}

function Get-GitDeckMrReadiness([string]$Path, [string]$Iid) {
    Assert-Registered $Path
    if ($Iid -notmatch '^[1-9][0-9]{0,9}$') { throw 'Invalid merge request number.' }
    $web = ConvertTo-WebUrl (Get-OriginUrl $Path)
    if (-not $web -or $web -match '(?i)github\.com|bitbucket\.org') { throw 'This repository is not configured for GitLab.' }
    $project = Get-GitLabProjectApi $web
    $endpoint = "projects/$($project.encoded)/merge_requests/$Iid"
    $result = Invoke-GlabCapture @('api', '--hostname', $project.host, '--output', 'json', $endpoint)
    if ($result.Code -ne 0) { throw 'Could not read merge request readiness. Check GitLab CLI sign-in and permissions.' }
    $mr = $result.Output | ConvertFrom-Json -ErrorAction Stop
    $approval = @{status='unknown';required=$null;left=$null}
    try {
        $rulesResult = Invoke-GlabCapture @('api', '--hostname', $project.host, '--output', 'json', "$endpoint/approval_state")
        if ($rulesResult.Code -eq 0) {
            $rules = $rulesResult.Output | ConvertFrom-Json -ErrorAction Stop
            if ($null -ne $rules.rules) {
                $requiredRules = @($rules.rules | Where-Object { $_.approvals_required -gt 0 })
                $waitingRules = @($requiredRules | Where-Object { -not $_.approved })
                $approval = @{status=$(if (-not $requiredRules.Count) {'not-required'} elseif ($waitingRules.Count) {'waiting'} else {'approved'});required=$requiredRules.Count;left=$waitingRules.Count}
            }
        }
    } catch { } # Unsupported edition or permission = unknown, never approved.
    $pipeline = $mr.head_pipeline
    $pipelineStatus = if ($pipeline) { [string]$pipeline.status } else { 'unknown' }
    if ($pipeline -and (-not $mr.sha -or $pipeline.sha -ne $mr.sha)) { $pipelineStatus = 'stale' }
    return [ordered]@{
        iid = $mr.iid; title = [string]$mr.title; url = [string]$mr.web_url; source = [string]$mr.source_branch; target = [string]$mr.target_branch
        state = [string]$mr.state; draft = [bool]$mr.draft; sha = [string]$mr.sha; merge = [string]$mr.detailed_merge_status
        pipeline = $pipelineStatus; approval = $approval; checkedAt = [DateTime]::UtcNow.ToString('o')
    }
}
