# Git Deck links to the tools around Git (web/integrations.js):
#   Releases       - which image tag each service runs in each environment, read from a deploy repository
#   Merge requests - open GitLab merge requests of a repository, through the signed-in GitLab CLI
#   Notifications  - Windows toast notifications for background news
#   Editors        - open a repository or a file at a line in IntelliJ IDEA or VS Code
#   gitleaks       - optional extra secret scan before push when bin\gitleaks.exe is present
# No tokens are stored here; GitLab goes through glab's own sign-in. Windows PowerShell 5.1 compatible.

$script:GitDeckGitleaks = Join-Path (Split-Path $PSScriptRoot -Parent) 'bin\gitleaks.exe'

# ---- Releases: image tags per environment ---------------------------------------------------------
# Environment of a deploy file from its path: values-uat.yaml, overlays/sit/..., env/prod/... The last
# match wins, so apps/dev-tools/overlays/prod/kustomization.yaml is prod.
function Get-GitDeckDeployEnv([string]$File) {
    $pattern = '(?i)(?<![a-z0-9])(pre-?prod|preprd|non-?prod|production|prod|prd|staging|stage|stg|uat\d*|sit\d*|qa\d*|dev\d*|develop|development|test\d*|perf|nft|drc?)(?![a-z0-9])'
    $found = @([regex]::Matches($File, $pattern))
    if (-not $found.Count) { return 'default' }
    $name = $found[$found.Count - 1].Groups[1].Value.ToLowerInvariant()
    switch -Regex ($name) {
        '^(production|prd)$' { return 'prod' }
        '^(develop|development)$' { return 'dev' }
        '^(pre-?prod|preprd)$' { return 'preprod' }
        '^non-?prod$' { return 'nonprod' }
        '^(stage|stg)$' { return 'staging' }
        default { return $name }
    }
}

# "registry:5000/group/billing-svc:1.4.2@sha256:..." -> name billing-svc, tag 1.4.2.
function Split-GitDeckImage([string]$Image) {
    $value = ([string]$Image).Trim().Trim('"', "'")
    $at = $value.IndexOf('@'); if ($at -ge 0) { $value = $value.Substring(0, $at) }
    $slash = $value.LastIndexOf('/'); $colon = $value.LastIndexOf(':')
    $tag = ''
    if ($colon -gt $slash) { $tag = $value.Substring($colon + 1); $value = $value.Substring(0, $colon) }
    $name = $value.Substring($value.LastIndexOf('/') + 1)
    return [ordered]@{ image = $value; name = $name; tag = $tag }
}

function Test-GitDeckDeployValue([string]$Value) {
    return ($Value -and $Value -notmatch '\{\{|\$\{|\$\(' -and $Value -match '^[A-Za-z0-9._/:@-]+$')
}

# Image tags in the YAML of a deploy repository at a ref (the upstream of its branch by default, so a
# fetch is enough to see what is on the server). Understands:
#   image: registry/group/billing-svc:1.4.2                      (Kubernetes manifests)
#   image: { repository: registry/group/billing-svc, tag: 1.4.2 } (Helm values, as nested keys)
#   images: [ { name: billing-svc, newTag: 1.4.2 } ]              (Kustomize)
function Get-GitDeckDeployMap([string]$Path, [string]$Ref) {
    Assert-Registered $Path
    $Ref = ([string]$Ref).Trim()
    if (-not $Ref) {
        $upstream = Invoke-GitCapture $Path @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}')
        $Ref = if ($upstream.Code -eq 0 -and ([string]$upstream.Output).Trim()) { ([string]$upstream.Output).Trim() } else { 'HEAD' }
    }
    if ($Ref.Length -gt 200 -or $Ref.StartsWith('-') -or $Ref -notmatch '^[A-Za-z0-9._/@{}~^-]+$') { throw 'Branch or tag name is not valid.' }
    if ((Invoke-GitCapture $Path @('rev-parse', '--verify', '--quiet', "$Ref^{commit}")).Code -ne 0) { throw "$Ref was not found in this repository." }
    $grep = Invoke-GitCapture $Path @('-c', 'core.quotepath=false', 'grep', '-n', '-I', '--no-color', '-E',
        '^[[:space:]]*(-[[:space:]]*)?(image|repository|newName|name|tag|newTag|imageTag)[[:space:]]*:', $Ref, '--', '*.yaml', '*.yml')
    $entries = New-Object 'System.Collections.Generic.List[object]'
    $files = @{}
    $prefix = "${Ref}:"
    $file = ''; $candidate = $null
    foreach ($line in Get-GitDeckLines $grep) {
        if ($line.StartsWith($prefix)) { $line = $line.Substring($prefix.Length) }
        if ($line -notmatch '^(.+?):(\d+):(.*)$') { continue }
        $lineFile = $Matches[1]; $number = [int]$Matches[2]; $text = $Matches[3]
        if ($lineFile -ne $file) { $file = $lineFile; $candidate = $null }
        if ($text -notmatch '^(\s*(?:-\s*)?)(image|repository|newName|name|tag|newTag|imageTag)\s*:\s*(.*?)\s*(?:#.*)?$') { continue }
        $indent = $Matches[1].Length; $key = $Matches[2]; $value = $Matches[3].Trim().Trim('"', "'")
        if ($entries.Count -ge 3000) { break }
        if ($key -eq 'image') {
            if (-not $value) { continue }
            if (-not (Test-GitDeckDeployValue $value)) { continue }
            $image = Split-GitDeckImage $value
            if ($image.tag) {
                $entries.Add([ordered]@{ env = (Get-GitDeckDeployEnv $file); service = $image.name; image = $image.image; tag = $image.tag; file = $file; line = $number })
                $files[$file] = $true; $candidate = $null
            } else { $candidate = @{ name = $image.name; image = $image.image; line = $number; key = $key; indent = $indent } }
            continue
        }
        if ($key -in @('repository', 'newName', 'name')) {
            # Only names that can be images: "name: billing-svc", not "name: My service".
            if (Test-GitDeckDeployValue $value) { $image = Split-GitDeckImage $value; $candidate = @{ name = $image.name; image = $image.image; line = $number; key = $key; indent = $indent } } else { $candidate = $null }
            continue
        }
        # tag / newTag / imageTag: pair with the image named a few lines above.
        if (-not $candidate -or ($number - $candidate.line) -gt 6 -or $indent -ne $candidate.indent -or -not (Test-GitDeckDeployValue $value)) { continue }
        # A metadata/container name is not a Helm image repository. Pair compatible sibling keys only.
        if (($key -eq 'newTag' -and $candidate.key -notin @('name','newName')) -or ($key -eq 'tag' -and $candidate.key -ne 'repository') -or ($key -eq 'imageTag' -and $candidate.key -notin @('image','repository'))) { continue }
        $entries.Add([ordered]@{ env = (Get-GitDeckDeployEnv $file); service = $candidate.name; image = $candidate.image; tag = $value; file = $file; line = $number })
        $files[$file] = $true; $candidate = $null
        if ($entries.Count -ge 3000) { break }
    }
    $commit = ([string](Invoke-GitCapture $Path @('log', '-1', '--format=%h%x09%cI%x09%s', $Ref)).Output).Trim() -split "`t"
    return [ordered]@{
        ref = $Ref; commit = $commit[0]; date = $(if ($commit.Count -gt 1) { $commit[1] } else { '' }); subject = $(if ($commit.Count -gt 2) { $commit[2] } else { '' })
        files = $files.Count; entries = $entries.ToArray()
    }
}

# ---- Merge requests of one repository ---------------------------------------------------------------
function Get-GitDeckMergeRequests([string]$Path) {
    Assert-Registered $Path
    $web = ConvertTo-WebUrl (Get-OriginUrl $Path)
    if (-not $web) { throw 'Remote is not a supported GitLab URL.' }
    $project = Get-GitLabProjectApi $web
    $notSignedIn = "GitLab CLI is not signed in to $($project.host). Run: bin\glab.exe auth login --hostname $($project.host)"
    try { $result = Invoke-GlabCapture @('api', '--hostname', $project.host, '--output', 'json', ("projects/$($project.encoded)/merge_requests?state=opened&scope=all&per_page=50&order_by=updated_at&sort=desc")) }
    catch { if ($_.Exception.Message -match '404|401|authenticat|Unauthorized') { throw $notSignedIn }; throw }
    if ($result.Code -ne 0) {
        $text = ([string]$result.Output).Split("`n")[0]
        if ($text -match '404|401|authenticat|Unauthorized') { throw $notSignedIn }
        throw $text
    }
    $items = if ($result.Output) { @($result.Output | ConvertFrom-Json) } else { @() }
    return @($items | ForEach-Object {
        [ordered]@{
            iid = $_.iid; title = [string]$_.title; source = [string]$_.source_branch; target = [string]$_.target_branch
            author = $(if ($_.author) { [string]$(if ($_.author.name) { $_.author.name } else { $_.author.username }) } else { '' })
            draft = [bool]$_.draft; status = [string]$(if ($_.detailed_merge_status) { $_.detailed_merge_status } else { $_.merge_status })
            comments = [int]$_.user_notes_count; updated = [string]$_.updated_at; url = [string]$_.web_url; project = $web
        }
    })
}

# ---- Windows notifications ------------------------------------------------------------------------
$script:GitDeckToastApp = 'GitDeck.Desktop'
function Register-GitDeckToastApp {
    # Unpackaged apps show toasts under a name registered for the current user only.
    $key = "HKCU:\Software\Classes\AppUserModelId\$script:GitDeckToastApp"
    if (Test-Path -LiteralPath $key) { return }
    [void](New-Item -Path $key -Force)
    [void](New-ItemProperty -Path $key -Name 'DisplayName' -Value 'Git Deck' -PropertyType String -Force)
}

function Show-GitDeckToast([string]$Title, [string]$Text) {
    $Title = ([string]$Title).Trim(); $Text = ([string]$Text).Trim()
    if (-not $Title) { throw 'Notification title is required.' }
    if ($Title.Length -gt 120) { $Title = $Title.Substring(0, 120) }
    if ($Text.Length -gt 400) { $Text = $Text.Substring(0, 400) }
    Register-GitDeckToastApp
    [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
    $escape = { param($value) [Security.SecurityElement]::Escape($value) }
    $lines = @($Text -split "`r?`n" | Where-Object { $_ } | Select-Object -First 2)
    $body = ($lines | ForEach-Object { '<text>' + (& $escape $_) + '</text>' }) -join ''
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml("<toast><visual><binding template=""ToastGeneric""><text>$(& $escape $Title)</text>$body</binding></visual></toast>")
    $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($script:GitDeckToastApp).Show($toast)
    return @{ message = 'Notification shown.' }
}

# ---- Editors ------------------------------------------------------------------------------------
function Find-GitDeckIntelliJ {
    foreach ($name in @('idea64.exe', 'idea.cmd', 'idea.bat')) {
        $command = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) { return $command.Source }
    }
    $toolbox = Join-Path $env:LOCALAPPDATA 'JetBrains\Toolbox\scripts\idea.cmd'
    if (Test-Path -LiteralPath $toolbox -PathType Leaf) { return $toolbox }
    $found = New-Object 'System.Collections.Generic.List[object]'
    $roots = @((Join-Path $env:LOCALAPPDATA 'Programs'), (Join-Path $env:ProgramFiles 'JetBrains'), (Join-Path $env:LOCALAPPDATA 'JetBrains\Toolbox\apps'))
    if (${env:ProgramFiles(x86)}) { $roots += (Join-Path ${env:ProgramFiles(x86)} 'JetBrains') }
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        foreach ($dir in @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '(?i)^(IntelliJ IDEA|IDEA-|intellij-idea)' })) {
            # Installer: <dir>\bin; Toolbox: <dir>\bin, or <dir>\ch-0\<version>\bin.
            $levels = @($dir) + @(Get-ChildItem -LiteralPath $dir.FullName -Directory -ErrorAction SilentlyContinue) + @(Get-ChildItem -LiteralPath $dir.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Directory -ErrorAction SilentlyContinue })
            foreach ($level in $levels) { $exe = Join-Path $level.FullName 'bin\idea64.exe'; if (Test-Path -LiteralPath $exe -PathType Leaf) { $found.Add((Get-Item -LiteralPath $exe)) } }
        }
    }
    $newest = $found | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($newest) { return $newest.FullName }
    return ''
}

function Get-GitDeckEditors {
    $code = Get-Command code.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
    return [ordered]@{ idea = [bool](Find-GitDeckIntelliJ); code = [bool]$code }
}

function Open-GitDeckEditor([string]$Path, [string]$Editor, [string]$File, $Line) {
    Assert-Registered $Path
    $number = 0
    if ($null -ne $Line -and "$Line" -ne '') { if (-not [int]::TryParse("$Line", [ref]$number) -or $number -lt 1 -or $number -gt 10000000) { throw 'Invalid line number.' } }
    $full = if ($File) { Resolve-GitDeckRepoFile $Path $File } else { '' }
    $quote = { param($value) '"' + $value + '"' }
    switch ($Editor) {
        'idea' {
            $idea = Find-GitDeckIntelliJ
            if (-not $idea) { throw 'IntelliJ IDEA was not found. Install it, or turn on "Generate shell scripts" in JetBrains Toolbox.' }
            # IntelliJ opens the project first, then the file at the line inside it.
            $arguments = @(& $quote $Path)
            if ($full) { if ($number) { $arguments += @('--line', "$number") }; $arguments += (& $quote $full) }
            Start-Process -FilePath $idea -ArgumentList $arguments -WindowStyle Hidden
            return @{ message = $(if ($full) { "Opened $File in IntelliJ IDEA." } else { 'IntelliJ IDEA opened.' }) }
        }
        'code' {
            $code = Get-Command code.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
            if (-not $code) { throw 'VS Code (code) was not found in PATH. Install VS Code with "Add to PATH".' }
            $arguments = @(& $quote $Path)
            if ($full) { $arguments += @('-g', (& $quote $(if ($number) { "${full}:$number" } else { $full }))) }
            Start-Process -FilePath $code.Source -ArgumentList $arguments -WindowStyle Hidden
            return @{ message = $(if ($full) { "Opened $File in VS Code." } else { 'VS Code opened.' }) }
        }
        default { throw 'Unknown editor.' }
    }
}

# ---- gitleaks (optional) ------------------------------------------------------------------------
# Extra rules on top of Git Deck's own scan when bin\gitleaks.exe is installed. Secrets are redacted.
function Invoke-GitDeckGitleaks([string]$Path, [string]$LogOpts) {
    if (-not (Test-Path -LiteralPath $script:GitDeckGitleaks -PathType Leaf)) { return $null }
    $report = Join-Path ([IO.Path]::GetTempPath()) ('gitdeck-gitleaks-' + [guid]::NewGuid().ToString('N') + '.json')
    try {
        $output = (& $script:GitDeckGitleaks detect --source $Path --log-opts $LogOpts --report-format json --report-path $report --redact --no-banner --exit-code 0 2>&1 | Out-String)
        if ($LASTEXITCODE -ne 0) { return [ordered]@{ error = (([string]$output).Trim().Split("`n") | Select-Object -Last 1); findings = @() } }
        $items = if (Test-Path -LiteralPath $report) { @(Get-Content -LiteralPath $report -Raw -Encoding UTF8 | ConvertFrom-Json) } else { @() }
        $findings = @($items | Where-Object { $_ } | Select-Object -First 50 | ForEach-Object {
            $commit = [string]$_.Commit
            [ordered]@{ rule = "gitleaks:$($_.RuleID)"; level = 'block'; label = "gitleaks: $($_.Description)"; file = [string]$_.File; commit = $(if ($commit.Length -gt 8) { $commit.Substring(0, 8) } else { $commit }); preview = "line $($_.StartLine) ($($_.RuleID))" }
        })
        return [ordered]@{ error = ''; findings = $findings }
    } finally { if (Test-Path -LiteralPath $report) { Remove-Item -LiteralPath $report -Force -ErrorAction SilentlyContinue } }
}
