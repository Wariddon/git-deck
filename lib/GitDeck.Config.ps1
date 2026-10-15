# Effective configuration of a Spring Boot service in one environment (web/effective-config.js).
# Collects the inputs; the page merges them in Spring Boot order:
#   application.yml/.properties  <  application-{env}.yml/.properties  <  ConfigMap files
#   (an application.yml block inside a ConfigMap)  <  environment variables (ConfigMap keys, Helm env)
# Read-only: files come from the working tree or a ref of the service repository and from a ref of
# the deploy repository. Windows PowerShell 5.1 compatible.

$script:ConfigResourceDirs = @('src/main/resources', 'src/main/resources/config', 'config', '')

function Assert-GitDeckConfigName([string]$Value, [string]$What) {
    if ($Value -and ($Value.Length -gt 60 -or $Value -notmatch '^[A-Za-z0-9._-]+$')) { throw "$What may use letters, digits, dot, dash and underscore only." }
}

# Profiles the service has: application-{profile}.yml|yaml|properties in the usual folders.
function Get-GitDeckConfigProfiles([string]$Path, [string]$Ref) {
    $listing = if ($Ref) { Invoke-GitCapture $Path @('-c', 'core.quotepath=false', 'ls-tree', '-r', '--name-only', $Ref) } else { Invoke-GitCapture $Path @('-c', 'core.quotepath=false', 'ls-files') }
    $profiles = New-Object 'System.Collections.Generic.SortedSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in Get-GitDeckLines $listing) {
        if ($file -match '(^|/)application-([A-Za-z0-9._-]+)\.(ya?ml|properties)$') { [void]$profiles.Add($Matches[2]) }
    }
    return @($profiles)
}

function Get-GitDeckEffectiveConfigSources([string]$Path, [string]$Env, [string]$Ref, [string]$DeployPath, [string]$DeployRef, [string]$Name) {
    Assert-Registered $Path
    $Env = ([string]$Env).Trim(); $Ref = ([string]$Ref).Trim(); $Name = ([string]$Name).Trim()
    Assert-GitDeckConfigName $Env 'Environment'
    Assert-GitDeckConfigName $Name 'Name in the deploy repository'
    if ($Ref -and ($Ref.Length -gt 200 -or $Ref.StartsWith('-') -or $Ref -notmatch '^[A-Za-z0-9._/@{}~^-]+$')) { throw 'Branch or tag name is not valid.' }
    $service = New-Object 'System.Collections.Generic.List[object]'
    foreach ($role in @('base', 'profile')) {
        if ($role -eq 'profile' -and -not $Env) { continue }
        $stem = if ($role -eq 'base') { 'application' } else { "application-$Env" }
        foreach ($dir in $script:ConfigResourceDirs) {
            foreach ($ext in @('yml', 'yaml', 'properties')) {
                $file = if ($dir) { "$dir/$stem.$ext" } else { "$stem.$ext" }
                $read = Get-GitDeckRepoFile $Path $file $Ref
                if ($read.exists) { $service.Add([ordered]@{ role = $role; file = $file; content = [string]$read.content }) }
            }
        }
    }
    $deploy = $null
    if ($DeployPath) {
        Assert-Registered $DeployPath
        $DeployRef = ([string]$DeployRef).Trim()
        if (-not $DeployRef) {
            $upstream = Invoke-GitCapture $DeployPath @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}')
            $DeployRef = if ($upstream.Code -eq 0 -and ([string]$upstream.Output).Trim()) { ([string]$upstream.Output).Trim() } else { 'HEAD' }
        }
        if ($DeployRef.Length -gt 200 -or $DeployRef.StartsWith('-') -or $DeployRef -notmatch '^[A-Za-z0-9._/@{}~^-]+$') { throw 'Deploy branch or tag name is not valid.' }
        $needle = if ($Name) { $Name } else { Split-Path $Path -Leaf }
        # Deploy files for the service, for this environment (or for every environment): files named
        # after it (lns-app-configuration/{svc}.yml, a Spring file mounted as configuration) first, then
        # manifests that mention it. nameMatch tells the page which plain YAML files are the service's own.
        $candidates = New-Object 'System.Collections.Generic.List[string]'
        $seenFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        $escaped = [regex]::Escape($needle)
        foreach ($file in Get-GitDeckLines (Invoke-GitCapture $DeployPath @('-c', 'core.quotepath=false', 'ls-tree', '-r', '--name-only', $DeployRef))) {
            if ($file -match '\.ya?ml$' -and $file -match "(?i)(^|/)$escaped(/|\.ya?ml$)" -and $seenFiles.Add($file)) { $candidates.Add($file) }
        }
        $prefix = "${DeployRef}:"
        foreach ($line in Get-GitDeckLines (Invoke-GitCapture $DeployPath @('-c', 'core.quotepath=false', 'grep', '-l', '-i', '-F', '-e', $needle, $DeployRef, '--', '*.yaml', '*.yml'))) {
            $file = if ($line.StartsWith($prefix)) { $line.Substring($prefix.Length) } else { $line }
            if ($seenFiles.Add($file)) { $candidates.Add($file) }
        }
        $files = New-Object 'System.Collections.Generic.List[object]'
        foreach ($file in $candidates) {
            $fileEnv = Get-GitDeckDeployEnv $file
            if ($Env -and $fileEnv -ne 'default' -and $fileEnv -ne $Env.ToLowerInvariant()) { continue }
            $size = Invoke-GitCapture $DeployPath @('cat-file', '-s', "${DeployRef}:$file")
            $bytes = 0; [void][int64]::TryParse(([string]$size.Output).Trim(), [ref]$bytes)
            if ($bytes -gt 512KB) { continue }
            $show = Invoke-GitCapture $DeployPath @('show', "${DeployRef}:$file")
            $nameMatch = [IO.Path]::GetFileNameWithoutExtension(($file -split '/')[-1]) -ieq $needle
            if ($show.Code -eq 0) { $files.Add([ordered]@{ file = $file; env = $fileEnv; nameMatch = $nameMatch; content = [string]$show.Output }) }
            if ($files.Count -ge 40) { break }
        }
        $deploy = [ordered]@{ ref = $DeployRef; name = $needle; files = $files.ToArray() }
    }
    return [ordered]@{ env = $Env; ref = $Ref; profiles = @(Get-GitDeckConfigProfiles $Path $Ref); service = $service.ToArray(); deploy = $deploy }
}
