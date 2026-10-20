# Known traps in outgoing changes (Push checks): patterns in ADDED lines that compiled, passed the
# tests and still broke something later in a Spring / Kafka / Kubernetes service. Warnings only,
# each with the file and line and what to check. Windows PowerShell 5.1 compatible.

$script:PushTrapRules = @(
    @{ id = 'content-length'; label = 'Content-Length forwarded'; file = '\.(java|kt|go|js|ts)$'
       line = '(?i)(content[-_]?length)'; also = '(?i)(header|headers|set|add|put|copy|forward)'
       detail = 'A Content-Length copied to another request or response is wrong as soon as the body changes (the call hangs or the body is cut). Let the HTTP client compute it.' },
    @{ id = 'provided-scope'; label = 'Maven scope provided'; file = '(^|/)pom\.xml$'
       line = '<scope>\s*provided\s*</scope>'
       detail = 'A provided dependency is not packaged for runtime; check the container really provides it (and that a shaded/fat jar does not still carry a copy).' },
    @{ id = 'lombok-boolean-is'; label = 'Boolean field named is...'; file = '\.java$'
       line = '^\s*(private|protected|public)?\s*boolean\s+is[A-Z]\w*\s*(=|;)'
       detail = 'With Lombok and Jackson a boolean isActive is read and written as "active". Add @JsonProperty("isActive") if the JSON uses isActive.' },
    @{ id = 'env-profile'; label = 'Environment profile changed'; file = '(^|/)(application|bootstrap)-(dev|sit|uat|prod|prd|production)[^/]*\.(ya?ml|properties)$'
       line = '\S'
       detail = 'The ConfigMap or lns-app-configuration file in the deploy repository wins over this file. Check Effective config for this environment before relying on the change.' },
    @{ id = 'mockbean'; label = '@MockBean'; file = '\.(java|kt)$'
       line = '@MockBean\b'
       detail = 'On Spring Boot 3.4+ use @MockitoBean (it does not work on a @TestConfiguration class: move the mock to the test class).' },
    @{ id = 'localhost-url'; label = 'localhost in main code or config'; file = '(^|/)src/main/'
       line = '(?i)https?://(localhost|127\.0\.0\.1)(:\d+)?'
       detail = 'A localhost URL in main code or configuration only works on your machine; use a property per environment.' }
)

# $Patch: "git log -p -U0" output. Returns one finding per rule: { id; label; detail; places[] }.
function Find-GitDeckKnownTraps([string]$Patch, [int]$PlacesPerRule = 5) {
    $hits = [ordered]@{}
    $file = ''; $lineNo = 0
    foreach ($line in ($Patch -split "`r?`n")) {
        if ($line.StartsWith('+++ ')) { $file = $(if ($line -match '^\+\+\+ b/(.+)$') { $Matches[1] } else { '' }); continue }
        if ($line -match '^@@ -\d+(?:,\d+)? \+(\d+)') { $lineNo = [int]$Matches[1]; continue }
        if (-not $line.StartsWith('+') -or -not $file) { continue }
        $text = $line.Substring(1)
        foreach ($rule in $script:PushTrapRules) {
            if ($file -notmatch $rule.file -or $text -notmatch $rule.line) { continue }
            if ($rule.also -and $text -notmatch $rule.also) { continue }
            if (-not $hits.Contains($rule.id)) { $hits[$rule.id] = [ordered]@{ id = $rule.id; label = $rule.label; detail = $rule.detail; places = (New-Object 'System.Collections.Generic.List[string]') } }
            $place = "${file}:$lineNo"
            # One place per file is enough for a profile file; otherwise a few lines.
            if ($rule.id -eq 'env-profile') { if (-not @($hits[$rule.id].places | Where-Object { $_.StartsWith("${file}:") }).Count) { $hits[$rule.id].places.Add($place) } }
            elseif ($hits[$rule.id].places.Count -lt $PlacesPerRule) { $hits[$rule.id].places.Add($place) }
        }
        $lineNo++
    }
    return @($hits.Values | ForEach-Object { [ordered]@{ id = $_.id; label = $_.label; detail = $_.detail; places = $_.places.ToArray() } })
}
