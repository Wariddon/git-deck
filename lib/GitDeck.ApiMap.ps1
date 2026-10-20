# API and Kafka map (web/api-map.js): what one repository provides and uses, read from the source
# with "git grep" (no build, no running service). Spring controllers and Feign clients give HTTP
# endpoints; string literals that look like API paths give calls; @KafkaListener and send() give
# topics. Heuristics, shown with file and line so every entry can be checked. Read-only.
# Windows PowerShell 5.1 compatible.

function Get-GitDeckGrepLines([string]$Path, [string]$Ref, [string]$Pattern, [string[]]$Specs) {
    $arguments = @('grep', '-n', '-I', '-E', '-e', $Pattern)
    # On disk: new files you have not added yet count too (ignored files do not).
    if ($Ref) { $arguments += $Ref } else { $arguments = @('grep', '--untracked', '-n', '-I', '-E', '-e', $Pattern) }
    $arguments += @('--') + $Specs
    $result = Invoke-GitCapture $Path $arguments
    if ($result.Code -gt 1) { return @() }
    $items = New-Object 'System.Collections.Generic.List[object]'
    foreach ($line in Get-GitDeckLines $result) {
        $text = if ($Ref -and $line.StartsWith("${Ref}:")) { $line.Substring($Ref.Length + 1) } else { $line }
        if ($text -match '^(.+?):(\d+):(.*)$') { $items.Add([pscustomobject]@{ file = $Matches[1]; line = [int]$Matches[2]; text = $Matches[3] }) }
        if ($items.Count -ge 3000) { break }
    }
    return $items.ToArray()
}

function Get-GitDeckAnnotationValue([string]$Text) {
    # @GetMapping("/a"), @RequestMapping(value = "/a", method = ...), @PostMapping(path = {"/a"})
    if ($Text -match '(?:value|path)\s*=\s*\{?\s*"([^"]*)"') { return $Matches[1] }
    if ($Text -match '\(\s*\{?\s*"([^"]*)"') { return $Matches[1] }
    return ''
}

function Join-GitDeckApiPath([string]$Base, [string]$Path) {
    $joined = ('/' + $Base.Trim('/') + '/' + $Path.Trim('/')) -replace '/+', '/'
    if ($joined.Length -gt 1) { $joined = $joined.TrimEnd('/') }
    return $joined
}

# Cached per commit: the same HEAD (or ref) with the same uncommitted Java/Kotlin/config changes gives
# the same answer, so scanning a folder again is instant until something changes.
function Get-GitDeckApiSurface([string]$Path, [string]$Ref, [bool]$Fresh = $false) {
    Assert-Registered $Path
    $Ref = ([string]$Ref).Trim()
    if ($Ref -and ($Ref.Length -gt 200 -or $Ref.StartsWith('-') -or $Ref -notmatch '^[A-Za-z0-9._/@{}~^-]+$')) { throw 'Branch or tag name is not valid.' }
    if ($Fresh -or -not (Get-Command Get-GitDeckImmutable -ErrorAction SilentlyContinue)) { return Get-GitDeckApiSurfaceUncached $Path $Ref }
    $commit = ([string](Invoke-GitCapture $Path @('rev-parse', '--verify', '--quiet', "$(if ($Ref) { $Ref } else { 'HEAD' })^{commit}")).Output).Trim()
    if (-not $commit) { return Get-GitDeckApiSurfaceUncached $Path $Ref }
    # On disk: the index file changes with every add, commit, switch or pull, without starting Git.
    # Edits that are not staged yet show up with "Re-read files" (Fresh).
    $stamp = ''
    if (-not $Ref) { $index = Join-Path (Get-GitDeckGitDir $Path) 'index'; if (Test-Path -LiteralPath $index) { $stamp = (Get-Item -LiteralPath $index).LastWriteTimeUtc.Ticks } }
    return Get-GitDeckImmutable "api-surface|$($Path.ToLowerInvariant())|$Ref|$commit|$stamp" { Get-GitDeckApiSurfaceUncached $Path $Ref }
}

function Get-GitDeckApiSurfaceUncached([string]$Path, [string]$Ref) {
    $code = @('*.java', '*.kt')
    # One grep for every interesting line of Java/Kotlin code; split by kind afterwards.
    # No double quote in a pattern: Windows PowerShell 5.1 strips it from a native argument, so a
    # quoted path literal is found as "not a letter, then /a/b" and checked for its quotes below.
    $pattern = '@(Request|Get|Post|Put|Delete|Patch)Mapping|@FeignClient|^[[:space:]]*(public[[:space:]]+|abstract[[:space:]]+|final[[:space:]]+)*(class|interface)[[:space:]]|@KafkaListener|\.send\(|[^A-Za-z0-9_.]/[A-Za-z0-9_{}.-]+(/[A-Za-z0-9_{}.-]+)+'
    $lines = @(Get-GitDeckGrepLines $Path $Ref $pattern $code)
    $provides = New-Object 'System.Collections.Generic.List[object]'
    $calls = New-Object 'System.Collections.Generic.List[object]'
    $listens = New-Object 'System.Collections.Generic.List[object]'
    $sends = New-Object 'System.Collections.Generic.List[object]'
    foreach ($group in ($lines | Group-Object file)) {
        $file = $group.Name
        if ($file -match '(^|/)src/test/') { continue }
        $rows = @($group.Group | Sort-Object line)
        $classLine = @($rows | Where-Object { $_.text -match '^\s*(public\s+|abstract\s+|final\s+)*(class|interface)\s' } | Select-Object -First 1)
        $classAt = if ($classLine.Count) { $classLine[0].line } else { 0 }
        $feign = @($rows | Where-Object { $_.text -match '@FeignClient' -and $_.line -lt [Math]::Max($classAt, 1) + 1 })
        $base = ''
        foreach ($row in $rows) { if ($row.line -lt $classAt -and $row.text -match '@RequestMapping') { $base = Get-GitDeckAnnotationValue $row.text } }
        foreach ($row in $rows) {
            $text = $row.text.Trim()
            if ($text -match '^\s*//' -or $text.StartsWith('*')) { continue }
            if ($text -match '@(Request|Get|Post|Put|Delete|Patch)Mapping' -and $row.line -gt $classAt) {
                $verb = switch -regex ($text) { '@GetMapping' { 'GET' } '@PostMapping' { 'POST' } '@PutMapping' { 'PUT' } '@DeleteMapping' { 'DELETE' } '@PatchMapping' { 'PATCH' } default { if ($text -match 'RequestMethod\.(\w+)') { $Matches[1].ToUpperInvariant() } else { 'ANY' } } }
                $entry = [ordered]@{ method = $verb; path = (Join-GitDeckApiPath $base (Get-GitDeckAnnotationValue $text)); file = $file; line = $row.line }
                if ($feign.Count) { $entry.via = 'feign'; $calls.Add($entry) } else { $provides.Add($entry) }
                continue
            }
            if ($text -match '@KafkaListener') {
                $topics = if ($text -match 'topics\s*=\s*(.*)$') { $Matches[1] } else { '' }
                foreach ($m in [regex]::Matches($topics, '"([^"]+)"')) { $listens.Add([ordered]@{ topic = $m.Groups[1].Value; file = $file; line = $row.line }) }
                continue
            }
            if ($text -match '\.send\(\s*"([^"]+)"' -or $text -match '\.send\(\s*([A-Za-z_][\w.]*)\s*,') {
                $topic = $Matches[1]
                if ($text -match 'kafka|Kafka|template|Template|producer|Producer') { $sends.Add([ordered]@{ topic = $topic; file = $file; line = $row.line }) }
                continue
            }
            if (-not $feign.Count -and $text -notmatch '@(Request|Get|Post|Put|Delete|Patch)Mapping|@FeignClient') {
                foreach ($m in [regex]::Matches($text, '"(/[A-Za-z0-9_{}.-]+(?:/[A-Za-z0-9_{}.-]+)+)"')) {
                    $value = $m.Groups[1].Value
                    if ($value -match '\.(java|xml|json|yml|yaml|properties|html|png|jpg|sql)$' -or $value -match '^/(tmp|var|opt|etc|usr|home|data)/') { continue }
                    $calls.Add([ordered]@{ method = ''; path = $value; file = $file; line = $row.line; via = 'literal' })
                }
            }
        }
    }
    # Downstream URLs in configuration (url: ${enterprise-api.host}/v2/customerServices/...): the path
    # after the host is what this service calls; the key above names it. Any key counts when the value
    # starts with a host placeholder or a URL (post-promptpay-by-proxy: ${enterprise-api.host}/...).
    # (git grep -E is POSIX: [[:space:]], not \s.)
    $configPattern = '(url|uri|path|endpoint)[A-Za-z_-]*[[:space:]]*[:=].*/[A-Za-z]|[:=][[:space:]]*[^[:space:]A-Za-z0-9]?(\$\{[^}]+\}|https?://[^/[:space:]]+)/[A-Za-z]'
    foreach ($row in @(Get-GitDeckGrepLines $Path $Ref $configPattern @('*application*.yml', '*application*.yaml', '*application*.properties'))) {
        if ($row.file -match '(^|/)src/test/') { continue }
        $value = ($row.text -replace '^[^:=]*[:=]\s*', '').Trim().Trim('"', "'")
        $value = $value -replace '^https?://[^/]+', '' -replace '^\$\{[^}]+\}', ''
        if ($value -notmatch '^/[A-Za-z0-9_{}.-]+(/[A-Za-z0-9_{}.$-]+)+$') { continue }
        $calls.Add([ordered]@{ method = ''; path = $value; file = $row.file; line = $row.line; via = 'config' })
    }
    # Topic names written as ${property} in @KafkaListener: resolve them from application*.yml/properties.
    $config = @()
    if (@($listens | Where-Object { $_.topic -match '^\$\{' }).Count) {
        $config = @(Get-GitDeckGrepLines $Path $Ref 'topic' @('*application*.yml', '*application*.yaml', '*application*.properties'))
    }
    foreach ($item in $listens) {
        if ($item.topic -notmatch '^\$\{([^}:]+)') { continue }
        $leaf = ($Matches[1] -split '\.')[-1]
        $hit = @($config | Where-Object { $_.text -match ("(^|[\s.])" + [regex]::Escape($leaf) + '\s*[:=]\s*"?([A-Za-z0-9._-]+)') } | Select-Object -First 1)
        if ($hit.Count -and $hit[0].text -match ([regex]::Escape($leaf) + '\s*[:=]\s*"?([A-Za-z0-9._-]+)')) { $item.resolved = $Matches[1] }
    }
    return [ordered]@{ ref = $(if ($Ref) { $Ref } else { '' }); provides = $provides.ToArray(); calls = @($calls | Select-Object -First 400); listens = $listens.ToArray(); sends = $sends.ToArray() }
}
