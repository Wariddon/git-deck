# Push risk ("blast radius") for the Push dialog: what the outgoing commits touch, how big they are
# and how many services depend on this one. High risk asks for a short checklist before pushing.
# Heuristics only, explained line by line in the dialog. Windows PowerShell 5.1 compatible.

$script:PushRiskRules = @(
    @{ id = 'prod-config'; weight = 30; label = 'Production configuration'; pattern = '(^|/)(application|bootstrap)-(prod|production|prd)[^/]*\.(ya?ml|properties)$'; check = 'I compared the production values with the ConfigMap (Dashboard > Effective config).' },
    @{ id = 'config'; weight = 10; label = 'Application configuration'; pattern = '(^|/)(application|bootstrap)(-[^/]*)?\.(ya?ml|properties)$'; check = 'I checked which environments get this value (Dashboard > Effective config).' },
    @{ id = 'migration'; weight = 30; label = 'Database migration'; pattern = '(^|/)(db/migration|migrations?|flyway|liquibase|changelog)(/|$)|\.sql$'; check = 'The migration is backward compatible or has a rollback script.' },
    @{ id = 'build'; weight = 15; label = 'Dependencies or build'; pattern = '(^|/)(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|package(-lock)?\.json|go\.(mod|sum))$'; check = 'I ran the tests after the dependency or build change.' },
    @{ id = 'deploy'; weight = 20; label = 'Deployment or CI'; pattern = '(^|/)(Dockerfile|\.gitlab-ci\.yml|Jenkinsfile|kustomization\.ya?ml|values[^/]*\.ya?ml|Chart\.yaml)$|(^|/)(k8s|helm|charts|deploy|deployment|manifests|overlays)/'; check = 'Someone else reviewed the deployment or pipeline change.' },
    @{ id = 'security'; weight = 15; label = 'Security code'; pattern = '(?i)(^|/)[^/]*(security|auth|jwt|token|crypto|permission)[^/]*$'; check = 'The security change was reviewed by a second person.' }
)

# $Files: [{ file; added; deleted; status }] summed over the outgoing commits. $Consumers: services that
# declare this repository as a dependency (Systems).
function Measure-GitDeckPushRisk($Files, [int]$Consumers = 0) {
    $reasons = New-Object 'System.Collections.Generic.List[object]'
    $checklist = New-Object 'System.Collections.Generic.List[string]'
    $files = @($Files)
    foreach ($rule in $script:PushRiskRules) {
        $hits = @($files | Where-Object { ([string]$_.file -replace '\\', '/') -match $rule.pattern })
        # Production configuration is also application configuration; count it once, as the stronger one.
        if ($rule.id -eq 'config') { $hits = @($hits | Where-Object { ([string]$_.file -replace '\\', '/') -notmatch $script:PushRiskRules[0].pattern }) }
        if (-not $hits.Count) { continue }
        $reasons.Add([ordered]@{ id = $rule.id; label = $rule.label; weight = $rule.weight; detail = (($hits | Select-Object -First 3 | ForEach-Object { $_.file }) -join ', ') + $(if ($hits.Count -gt 3) { " and $($hits.Count - 3) more" } else { '' }) })
        $checklist.Add($rule.check)
    }
    $lines = 0; foreach ($item in $files) { $lines += [int]$item.added + [int]$item.deleted }
    if ($lines -gt 1500) { $reasons.Add([ordered]@{ id = 'size'; label = 'Very large change'; weight = 25; detail = "$lines changed lines" }); $checklist.Add('This change was reviewed in a merge request.') }
    elseif ($lines -gt 500) { $reasons.Add([ordered]@{ id = 'size'; label = 'Large change'; weight = 15; detail = "$lines changed lines" }); $checklist.Add('This change was reviewed in a merge request.') }
    if ($files.Count -gt 30) { $reasons.Add([ordered]@{ id = 'files'; label = 'Many files'; weight = 10; detail = "$($files.Count) files" }) }
    $deleted = @($files | Where-Object { $_.status -eq 'D' }).Count
    if ($deleted -gt 5) { $reasons.Add([ordered]@{ id = 'deleted'; label = 'Deleted files'; weight = 10; detail = "$deleted files deleted" }) }
    if ($Consumers -gt 0) {
        $reasons.Add([ordered]@{ id = 'consumers'; label = 'Used by other services'; weight = [Math]::Min(20, 5 * $Consumers); detail = "$Consumers service(s) declare this one as a dependency (Systems)" })
        $checklist.Add('I told the teams of the services that use this one.')
    }
    $score = 0; foreach ($reason in $reasons) { $score += [int]$reason.weight }
    $score = [Math]::Min(100, $score)
    $level = if ($score -ge 50) { 'high' } elseif ($score -ge 25) { 'medium' } else { 'low' }
    return [ordered]@{ score = $score; level = $level; reasons = $reasons.ToArray(); checklist = @($checklist | Select-Object -Unique); files = $files.Count; lines = $lines }
}

# Files of the outgoing commits (the same range as the pre-push checks) and the catalog consumers.
function Get-GitDeckPushRisk([string]$Path, [string[]]$Range) {
    $log = Invoke-GitCapture $Path (@('log', '--no-color', '--format=', '--numstat', '--no-renames', '-n', '200') + $Range)
    $status = Invoke-GitCapture $Path (@('log', '--no-color', '--format=', '--name-status', '--no-renames', '-n', '200') + $Range)
    $byFile = @{}
    foreach ($line in (([string]$log.Output) -split "`r?`n")) {
        if ($line -notmatch '^(\d+|-)\t(\d+|-)\t(.+)$') { continue }
        $file = $Matches[3]
        if (-not $byFile.ContainsKey($file)) { $byFile[$file] = [ordered]@{ file = $file; added = 0; deleted = 0; status = 'M' } }
        if ($Matches[1] -ne '-') { $byFile[$file].added += [int]$Matches[1] }
        if ($Matches[2] -ne '-') { $byFile[$file].deleted += [int]$Matches[2] }
    }
    # The oldest status wins for added files; a file deleted last is deleted.
    foreach ($line in (([string]$status.Output) -split "`r?`n")) {
        if ($line -notmatch '^([ADM])\t(.+)$') { continue }
        if ($byFile.ContainsKey($Matches[2]) -and ($Matches[1] -eq 'D' -or $byFile[$Matches[2]].status -eq 'M')) { $byFile[$Matches[2]].status = $Matches[1] }
    }
    $consumers = 0
    try {
        foreach ($entry in @(Get-GitDeckCatalogEntries)) {
            if (@($entry.dependencies | Where-Object { [string]::Equals(([string]$_).TrimEnd('\', '/'), $Path.TrimEnd('\', '/'), [StringComparison]::OrdinalIgnoreCase) }).Count) { $consumers++ }
        }
    } catch { $consumers = 0 }
    return Measure-GitDeckPushRisk @($byFile.Values) $consumers
}
