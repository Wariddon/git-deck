# Dashboard features across many repositories (web/fleet.js):
#   Ticket        - every branch, commit and tag of one ticket key in a repository
#   Compare files - read one file (working tree or a ref) so the page can compare it between repositories
#   CI status     - the latest GitLab pipeline of a branch or tag
# All read-only; every function checks that the repository is registered first.

function Assert-GitDeckTicketKey([string]$Key) {
    if (-not $Key -or $Key.Length -gt 60 -or $Key -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]*$') {
        throw 'Ticket key: letters, digits, dot, dash, slash or underscore, up to 60 characters.'
    }
}

function Get-GitDeckTicket([string]$Path, [string]$Key) {
    Assert-Registered $Path
    $Key = ([string]$Key).Trim()
    Assert-GitDeckTicketKey $Key
    $branches = New-Object 'System.Collections.Generic.List[object]'
    $format = '%(refname)%09%(refname:short)%09%(upstream:short)%09%(upstream:track)%09%(committerdate:iso-strict)%09%(objectname)'
    $boundary = '(?i)(^|[^A-Z0-9])' + [regex]::Escape($Key) + '(?![A-Z0-9])'
    foreach ($line in Get-GitDeckLines (Invoke-GitCapture $Path @('for-each-ref', "--format=$format", 'refs/heads', 'refs/remotes'))) {
        $f = $line -split "`t"
        if ($f[0] -match '/HEAD$' -or $f.Count -lt 2) { continue }
        if ($f[1] -notmatch $boundary) { continue }
        $ahead = 0; $behind = 0
        if ($f.Count -gt 3 -and $f[3] -match 'ahead (\d+)') { $ahead = [int]$Matches[1] }
        if ($f.Count -gt 3 -and $f[3] -match 'behind (\d+)') { $behind = [int]$Matches[1] }
        $branches.Add([ordered]@{
            name = $f[1]; remote = $f[0].StartsWith('refs/remotes/'); upstream = $(if ($f.Count -gt 2) { $f[2] } else { '' })
            ahead = $ahead; behind = $behind; date = $(if ($f.Count -gt 4) { $f[4] } else { '' })
            sha = $(if ($f.Count -gt 5) { $f[5] } else { '' })
        })
        if ($branches.Count -ge 30) { break }
    }
    $log = Invoke-GitCapture $Path @('log', '--exclude=refs/stash', '--all', '--date=short', '--regexp-ignore-case', '--fixed-strings', "--grep=$Key",
        '--format=%h%x1f%H%x1f%ad%x1f%an%x1f%s%x1f%D', '-60')
    $commits = if ($log.Code -eq 0) { @(Convert-LogLines $log.Output) } else { @() }
    # Tags named after the ticket.
    $tags = New-Object 'System.Collections.Generic.List[object]'
    $seen = @{}
    foreach ($line in Get-GitDeckLines (Invoke-GitCapture $Path @('for-each-ref', '--sort=-creatordate', '--format=%(refname:short)%09%(creatordate:iso-strict)', 'refs/tags'))) {
        $f = $line -split "`t"
        if ($f[0] -match $boundary -and -not $seen.ContainsKey($f[0])) { $seen[$f[0]] = $true; $tags.Add([ordered]@{ name = $f[0]; date = $(if ($f.Count -gt 1) { $f[1] } else { '' }); contains = $false }) }
    }
    # Most repositories never mention the ticket: answer them now, before the slower lookups.
    if (-not $branches.Count -and -not $tags.Count -and -not @($commits | Where-Object { $_.subject -match $boundary }).Count) {
        return [ordered]@{ key = $Key; current = ''; branches = @(); commits = @(); tags = @(); checkedAt = [DateTime]::UtcNow.ToString('o'); limited = $false }
    }
    # Commits that are on a local branch but on no remote yet.
    $unpushed = @{}
    foreach ($hash in Get-GitDeckLines (Invoke-GitCapture $Path @('log', '--branches', '--not', '--remotes', '--regexp-ignore-case', '--fixed-strings', "--grep=$Key", '--format=%H', '-200'))) {
        $unpushed[$hash.Trim()] = $true
    }
    $list = @($commits | Where-Object { $_.subject -match $boundary } | ForEach-Object { $item = [ordered]@{}; foreach ($k in $_.Keys) { $item[$k] = $_[$k] }; $item.pushed = -not $unpushed.ContainsKey([string]$_.fullHash); $item })
    # Tags that already contain the ticket's newest commit (it was released).
    if ($list.Count) {
        $newest = [string]$list[0].fullHash
        foreach ($line in @(Get-GitDeckLines (Invoke-GitCapture $Path @('tag', '--contains', $newest, '--sort=-creatordate', '--format=%(refname:short)%09%(creatordate:iso-strict)')) | Select-Object -First 8)) {
            $f = $line -split "`t"
            if (-not $seen.ContainsKey($f[0])) { $seen[$f[0]] = $true; $tags.Add([ordered]@{ name = $f[0]; date = $(if ($f.Count -gt 1) { $f[1] } else { '' }); contains = $true }) }
        }
    }
    $current = ([string](Invoke-GitCapture $Path @('branch', '--show-current')).Output).Trim()
    return [ordered]@{ key = $Key; current = $current; branches = $branches.ToArray(); commits = @($list); tags = @($tags | Select-Object -First 12); checkedAt = [DateTime]::UtcNow.ToString('o'); limited = ($branches.Count -ge 30 -or $commits.Count -ge 60 -or $tags.Count -gt 12) }
}

# A path inside the repository: no drive, no "..", no switches, forward or back slashes.
function ConvertTo-GitDeckRepoFile([string]$File) {
    $File = ([string]$File).Trim().Replace('\', '/').TrimStart('/')
    if (-not $File -or $File.Length -gt 300 -or $File.StartsWith('-') -or $File -match '(^|/)\.\.(/|$)' -or $File -match '[:*?"<>|\r\n]') {
        throw 'Use a path inside the repository, like pom.xml or src/main/resources/application.yml.'
    }
    return $File
}

function Get-GitDeckRepoFile([string]$Path, [string]$File, [string]$Ref) {
    Assert-Registered $Path
    $File = ConvertTo-GitDeckRepoFile $File
    $Ref = ([string]$Ref).Trim()
    $limit = 1MB
    if (-not $Ref) {
        $root = [IO.Path]::GetFullPath($Path).TrimEnd('\') + '\'
        $full = [IO.Path]::GetFullPath((Join-Path $Path ($File.Replace('/', '\'))))
        if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw 'The file must be inside the repository.' }
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { return [ordered]@{ file = $File; ref = ''; exists = $false; content = '' } }
        $info = Get-Item -LiteralPath $full
        if ($info.Length -gt $limit) { throw 'The file is larger than 1 MB.' }
        return [ordered]@{ file = $File; ref = ''; exists = $true; content = [IO.File]::ReadAllText($full, [Text.Encoding]::UTF8) }
    }
    if ($Ref.Length -gt 200 -or $Ref.StartsWith('-') -or $Ref -notmatch '^[A-Za-z0-9._/@{}~^-]+$') { throw 'Branch or tag name is not valid.' }
    $size = Invoke-GitCapture $Path @('cat-file', '-s', "$Ref`:$File")
    if ($size.Code -ne 0) { return [ordered]@{ file = $File; ref = $Ref; exists = $false; content = '' } }
    $bytes = 0; [void][int64]::TryParse(([string]$size.Output).Trim(), [ref]$bytes)
    if ($bytes -gt $limit) { throw 'The file is larger than 1 MB.' }
    $show = Invoke-GitCapture $Path @('show', "$Ref`:$File")
    if ($show.Code -ne 0) { return [ordered]@{ file = $File; ref = $Ref; exists = $false; content = '' } }
    return [ordered]@{ file = $File; ref = $Ref; exists = $true; content = [string]$show.Output }
}

# Tracked files whose path contains the text, for picking the file to compare.
function Find-GitDeckRepoFiles([string]$Path, [string]$Text) {
    Assert-Registered $Path
    $Text = ([string]$Text).Trim().Replace('\', '/')
    if ($Text.Length -gt 120 -or $Text -match "[`r`n]") { throw 'Search text is too long.' }
    $files = @(Get-GitDeckLines (Invoke-GitCapture $Path @('-c', 'core.quotepath=false', 'ls-files')))
    if ($Text) { $files = @($files | Where-Object { $_.IndexOf($Text, [StringComparison]::OrdinalIgnoreCase) -ge 0 }) }
    return @($files | Sort-Object { $_.Split('/').Count }, { $_ } | Select-Object -First 40)
}

# Latest GitLab pipeline for a branch or tag (the current branch when none is given).
function Get-GitDeckCiStatus([string]$Path, [string]$Ref) {
    Assert-Registered $Path
    if (-not (Test-Path -LiteralPath $script:Glab -PathType Leaf)) { throw 'GitLab CLI (bin\glab.exe) is not installed.' }
    $Ref = ([string]$Ref).Trim()
    if (-not $Ref) { $Ref = ([string](Invoke-GitCapture $Path @('branch', '--show-current')).Output).Trim() }
    if (-not $Ref -or $Ref.Length -gt 200 -or $Ref -notmatch '^[A-Za-z0-9._/-]+$') { throw 'No branch or tag to look up.' }
    $web = ConvertTo-WebUrl (Get-OriginUrl $Path)
    if (-not $web) { throw 'Remote is not a supported GitLab URL.' }
    $project = Get-GitLabProjectApi $web
    # glab answers 404 for private projects when it is not signed in to that GitLab; say how to fix it.
    $notSignedIn = "GitLab CLI is not signed in to $($project.host). Run: bin\glab.exe auth login --hostname $($project.host)"
    try { $result = Invoke-GlabCapture @('api', '--hostname', $project.host, '--output', 'json', ("projects/$($project.encoded)/pipelines?ref=$([Uri]::EscapeDataString($Ref))&per_page=1&order_by=id&sort=desc")) }
    catch { if ($_.Exception.Message -match '404|401|authenticat|Unauthorized') { throw $notSignedIn }; throw }
    if ($result.Code -ne 0) {
        $text = ([string]$result.Output).Split("`n")[0]
        if ($text -match '404|401|authenticat|Unauthorized') { throw $notSignedIn }
        throw $text
    }
    $parsedPipelines = if ($result.Output) { $result.Output | ConvertFrom-Json } else { @() }
    $pipelines = @($parsedPipelines)
    if (-not $pipelines.Count) { return [ordered]@{ ref = $Ref; status = 'none'; url = ''; updated = ''; sha = '' } }
    $p = $pipelines[0]
    return [ordered]@{ ref = $Ref; status = [string]$p.status; url = [string]$p.web_url; updated = [string]$p.updated_at; sha = [string]$p.sha; id = $p.id }
}
