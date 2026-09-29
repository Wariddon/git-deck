# Git Deck feature services: pre-push checks, secret scanning, one-click undo,
# AI commit messages and GitHub (gh CLI) integration.
# Dot-sourced by git-dashboard-server.ps1. Windows PowerShell 5.1 compatible.

$script:SecretRules = @(
    @{id='private-key'; level='block'; label='Private key'; pattern='-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY'},
    @{id='aws-key'; level='block'; label='AWS access key'; pattern='\b(?:AKIA|ASIA)[0-9A-Z]{16}\b'},
    @{id='github-token'; level='block'; label='GitHub token'; pattern='\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b'},
    @{id='gitlab-token'; level='block'; label='GitLab token'; pattern='\bglpat-[A-Za-z0-9_-]{20,}\b'},
    @{id='slack-token'; level='block'; label='Slack token'; pattern='\bxox[abprs]-[A-Za-z0-9-]{10,}\b'},
    @{id='anthropic-key'; level='block'; label='Anthropic API key'; pattern='\bsk-ant-[A-Za-z0-9_-]{20,}'},
    @{id='api-secret-key'; level='block'; label='API secret key'; pattern='\bsk-(?:proj-|live-)?[A-Za-z0-9_-]{32,}'},
    @{id='google-key'; level='block'; label='Google API key'; pattern='\bAIza[0-9A-Za-z_-]{35}\b'},
    @{id='url-credentials'; level='warn'; label='Credentials in URL'; pattern='\b[a-z][a-z0-9+.-]*://[^/\s:@''"]+:[^/\s@''"]{3,}@'},
    @{id='assignment'; level='warn'; label='Hard-coded secret'; pattern='(?i)\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*[''"][^''"\s]{8,}[''"]'}
)

function Protect-GitDeckSecret([string]$Text) {
    $value = $Text.Trim()
    if ($value.Length -gt 120) { $value = $value.Substring(0, 120) + '...' }
    # Keep the start of the line for context but never echo the secret itself.
    foreach ($rule in $script:SecretRules) { $value = [regex]::Replace($value, $rule.pattern, { param($m) $s = $m.Value; if ($s.Length -le 6) { '******' } else { $s.Substring(0, 4) + '******' } }) }
    return $value
}

function Find-GitDeckSecrets([string]$Patch, [int]$Limit = 50) {
    # Scans only added lines of a unified diff / git log -p output.
    $findings = New-Object 'System.Collections.Generic.List[object]'
    $file = ''; $commit = ''
    foreach ($line in ($Patch -split "`r?`n")) {
        if ($line.StartsWith('commit:')) { $commit = $line.Substring(7).Trim(); continue }
        if ($line.StartsWith('+++ ')) { $file = $line.Substring(4) -replace '^b/',''; continue }
        if ($line.StartsWith('diff --git ')) { $file = ($line -replace '^diff --git a/.* b/','').Trim(); continue }
        if (-not $line.StartsWith('+') -or $line.StartsWith('+++')) { continue }
        $added = $line.Substring(1)
        foreach ($rule in $script:SecretRules) {
            if ($added -match $rule.pattern) {
                $findings.Add([ordered]@{rule=$rule.id; level=$rule.level; label=$rule.label; file=$file; commit=$commit; preview=(Protect-GitDeckSecret $added)})
                break
            }
        }
        if ($findings.Count -ge $Limit) { break }
    }
    return $findings.ToArray()
}

function Test-GitDeckProtectedBranch([string]$Branch) {
    return ($Branch -match '^(main|master|develop|development|trunk|production|prod|release|release/.+|hotfix/.+)$')
}

function Get-PushChecks([string]$Path, [string]$Remote, [string]$Local, [string]$Target, [bool]$Force) {
    Assert-Registered $Path
    $remotes = @((Invoke-GitOrThrow $Path @('remote')) -split "`r?`n")
    if ($Remote -notin $remotes -or $Remote.StartsWith('-')) { throw 'Invalid remote' }
    foreach ($branchName in @($Local, $Target)) {
        if (-not $branchName -or $branchName.StartsWith('-')) { throw 'Invalid branch' }
        if ((Invoke-GitCapture $Path @('check-ref-format', ('refs/heads/' + $branchName))).Code -ne 0) { throw 'Invalid branch' }
    }
    $source = (Invoke-GitOrThrow $Path @('rev-parse', '--verify', ('refs/heads/' + $Local + '^{commit}'))).Trim()
    $remoteRef = 'refs/remotes/' + $Remote + '/' + $Target
    $known = (Invoke-GitCapture $Path @('rev-parse', '--verify', '--quiet', ($remoteRef + '^{commit}'))).Code -eq 0
    # Commits that the remote does not have yet.
    $range = if ($known) { @($source, ('^' + $remoteRef)) } else { @($source, '--not', ('--remotes=' + $Remote)) }
    $checks = New-Object 'System.Collections.Generic.List[object]'
    $log = Invoke-GitCapture $Path (@('log', '--no-color', '--format=commit:%h', '-p', '-U0', '--no-ext-diff', '-n', '200') + $range)
    if ($log.Code -ne 0) { throw $log.Output }
    $patch = $log.Output
    $truncated = $false
    if ($patch.Length -gt 8000000) { $patch = $patch.Substring(0, 8000000); $truncated = $true }
    $findings = @(Find-GitDeckSecrets $patch)
    $blocking = @($findings | Where-Object { $_.level -eq 'block' })
    if ($blocking.Count) { $checks.Add([ordered]@{level='block'; label='Possible secrets'; detail="$($blocking.Count) added line(s) look like keys or tokens. Remove them and rewrite the commit before pushing."}) }
    elseif ($findings.Count) { $checks.Add([ordered]@{level='warn'; label='Possible secrets'; detail="$($findings.Count) added line(s) look like hard-coded credentials. Review before pushing."}) }
    else { $checks.Add([ordered]@{level='ok'; label='Secret scan'; detail=$(if ($truncated) { 'No secrets found in the first 8 MB of outgoing changes.' } else { 'No keys or tokens found in outgoing changes.' })}) }
    # Large and sensitive files.
    $raw = Invoke-GitCapture $Path (@('log', '--no-color', '--format=', '--raw', '--no-abbrev', '-n', '200') + $range)
    $blobs = @{}
    $sensitive = New-Object 'System.Collections.Generic.List[string]'
    foreach ($line in ($raw.Output -split "`r?`n")) {
        if ($line -notmatch '^:\d+ \d+ [0-9a-f]+ ([0-9a-f]{40}) ([AMCR])\d*\t(?:[^\t]+\t)?(.+)$') { continue }
        $blob = $Matches[1]; $file = $Matches[3]
        if ($blob -match '^0+$') { continue }
        if (-not $blobs.ContainsKey($blob)) { $blobs[$blob] = $file }
        if ($file -match '(^|/)(\.env(\..+)?|id_rsa|id_ed25519|.+\.(pem|key|pfx|p12|jks|keystore))$' -and -not $sensitive.Contains($file)) { $sensitive.Add($file) }
    }
    $large = New-Object 'System.Collections.Generic.List[object]'
    if ($blobs.Count) {
        $format = '--batch-check=%(objectname) %(objectsize)'
        $sizes = @($blobs.Keys | Select-Object -First 2000 | & git -C $Path cat-file $format 2>$null)
        foreach ($entry in $sizes) {
            $parts = ([string]$entry) -split ' '
            if ($parts.Count -eq 2 -and [long]$parts[1] -ge 5MB) { $large.Add([ordered]@{file=$blobs[$parts[0]]; bytes=[long]$parts[1]}) }
        }
    }
    if ($large.Count) { $checks.Add([ordered]@{level=$(if (@($large | Where-Object { $_.bytes -ge 50MB }).Count) { 'block' } else { 'warn' }); label='Large files'; detail=(($large | Select-Object -First 5 | ForEach-Object { '{0} ({1:N1} MB)' -f $_.file, ($_.bytes / 1MB) }) -join ', ') + '. Consider Git LFS.'}) }
    else { $checks.Add([ordered]@{level='ok'; label='File sizes'; detail='No outgoing file is 5 MB or larger.'}) }
    if ($sensitive.Count) { $checks.Add([ordered]@{level='warn'; label='Sensitive file names'; detail=(($sensitive | Select-Object -First 5) -join ', ')}) }
    if (Test-GitDeckProtectedBranch $Target) {
        $checks.Add([ordered]@{level=$(if ($Force) { 'block' } else { 'warn' }); label='Protected branch'; detail=$(if ($Force) { "Force pushing to $Target can overwrite shared history." } else { "You are pushing directly to $Target. Many teams expect a pull/merge request instead." })})
    }
    return [ordered]@{local=$Local; target=$Target; remote=$Remote; knownTarget=$known; checks=$checks.ToArray(); findings=$findings; blocked=[bool](@($checks | Where-Object { $_.level -eq 'block' }).Count)}
}

# ---------------------------------------------------------------------------
# One-click undo, built on the action journal.
# ---------------------------------------------------------------------------
function Get-UndoCandidate([string]$Path) {
    Assert-Registered $Path
    $current = Get-GitSnapshot $Path
    if (-not $current.head) { return $null }
    $entry = @(Get-ActionJournal | Where-Object { [string]::Equals([string]$_.path, $Path, [StringComparison]::OrdinalIgnoreCase) }) | Select-Object -First 1
    if (-not $entry) { return $null }
    if ([string]$entry.afterHead -ne $current.head -or [string]$entry.afterBranch -ne $current.branch -or -not $entry.beforeHead) { return $null }
    return $entry
}

function Get-UndoPreview([string]$Path) {
    $entry = Get-UndoCandidate $Path
    if (-not $entry) { return [ordered]@{available=$false} }
    $soft = ($entry.action -eq 'commit' -and $entry.beforeBranch -eq $entry.afterBranch)
    $subject = (Invoke-GitCapture $Path @('log', '-1', '--format=%s', [string]$entry.afterHead)).Output.Trim()
    return [ordered]@{available=$true; id=[string]$entry.id; action=[string]$entry.action; subject=$subject; summary=[string]$entry.summary; createdAt=[string]$entry.createdAt; mode=$(if ($soft) { 'soft' } else { 'restore' }); beforeHead=[string]$entry.beforeHead; beforeBranch=[string]$entry.beforeBranch}
}

function Invoke-UndoLast([string]$Path, [string]$Id) {
    $entry = Get-UndoCandidate $Path
    if (-not $entry -or [string]$entry.id -ne $Id) { throw 'Nothing to undo: the repository changed after the last recorded action.' }
    if ($entry.action -eq 'commit' -and $entry.beforeBranch -eq $entry.afterBranch) {
        # Undo commit keeps its changes staged, so no work is lost and a dirty tree is fine.
        $output = Invoke-GitOrThrow $Path @('reset', '--soft', [string]$entry.beforeHead)
        return @{message='Last commit undone. Its changes are staged again.'; output=$(if ($output) { $output } else { "HEAD -> $($entry.beforeHead)" })}
    }
    return Invoke-Action ([pscustomobject]@{action='journal-restore-head'; path=$Path; id=$Id})
}

# ---------------------------------------------------------------------------
# AI commit messages (optional, opt-in). Provider settings come from
# git-deck-ai.json next to the server (git-ignored) and the API key from the
# ANTHROPIC_API_KEY environment variable; nothing is sent unless the user asks.
# ---------------------------------------------------------------------------
function Get-AiSettings {
    $settings = [ordered]@{provider='anthropic'; model='claude-opus-5-5'; ollamaUrl='http://127.0.0.1:11434'; ollamaModel='llama3.1'; language='English'}
    $file = Join-Path $script:Root 'git-deck-ai.json'
    if (Test-Path -LiteralPath $file -PathType Leaf) {
        try {
            $saved = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
            foreach ($name in @('provider','model','ollamaUrl','ollamaModel','language')) { if ($saved.$name) { $settings[$name] = [string]$saved.$name } }
        } catch {}
    }
    if ($env:GITDECK_AI_PROVIDER) { $settings.provider = $env:GITDECK_AI_PROVIDER }
    if ($env:GITDECK_AI_MODEL) { $settings.model = $env:GITDECK_AI_MODEL }
    if ($settings.provider -notin @('anthropic','ollama')) { $settings.provider = 'anthropic' }
    return $settings
}

function Get-AiStatus {
    $settings = Get-AiSettings
    $ready = if ($settings.provider -eq 'ollama') { $true } else { [bool]$env:ANTHROPIC_API_KEY }
    return [ordered]@{provider=$settings.provider; model=$(if ($settings.provider -eq 'ollama') { $settings.ollamaModel } else { $settings.model }); ready=$ready; hint=$(if ($ready) { '' } else { 'Set the ANTHROPIC_API_KEY environment variable and restart Git Deck, or use a local Ollama model in git-deck-ai.json.' })}
}

function Read-GitDeckHttpJson($Response) {
    # Decode as UTF-8 explicitly; Windows PowerShell 5.1 may otherwise guess Latin-1.
    return ([Text.Encoding]::UTF8.GetString($Response.RawContentStream.ToArray()) | ConvertFrom-Json)
}

function Invoke-GitDeckHttpJson([string]$Uri, [hashtable]$Headers, $Body, [int]$TimeoutSec = 120) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $bytes = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 10 -Compress))
    try { return Read-GitDeckHttpJson (Invoke-WebRequest -Uri $Uri -Method Post -Headers $Headers -Body $bytes -ContentType 'application/json; charset=utf-8' -UseBasicParsing -TimeoutSec $TimeoutSec) }
    catch {
        $detail = [string]$_.ErrorDetails.Message
        try { $parsed = $detail | ConvertFrom-Json; if ($parsed.error.message) { $detail = [string]$parsed.error.message } elseif ($parsed.error) { $detail = [string]$parsed.error } } catch {}
        if (-not $detail) { $detail = $_.Exception.Message }
        throw "AI request failed: $detail"
    }
}

function New-AiCommitMessage([string]$Path, [string]$Style) {
    Assert-Registered $Path
    $diff = Invoke-GitCapture $Path @('diff', '--cached', '--no-color', '--no-ext-diff', '-U3')
    if ($diff.Code -ne 0) { throw $diff.Output }
    if (-not $diff.Output.Trim()) { throw 'Stage the changes you want described first.' }
    $secrets = @(Find-GitDeckSecrets $diff.Output | Where-Object { $_.level -eq 'block' })
    if ($secrets.Count) { throw "Not sent: the staged diff contains what looks like a secret ($($secrets[0].label) in $($secrets[0].file)). Remove it first." }
    $stat = (Invoke-GitCapture $Path @('diff', '--cached', '--no-color', '--stat=120')).Output
    $branch = (Invoke-GitCapture $Path @('branch', '--show-current')).Output.Trim()
    $recent = (Invoke-GitCapture $Path @('log', '-8', '--format=%s')).Output
    $limit = 120000
    $body = $diff.Output
    $note = ''
    if ($body.Length -gt $limit) { $body = $body.Substring(0, $limit); $note = "The diff was larger than $([Math]::Round($limit / 1000)) KB; only the summary and the first part were sent." }
    $settings = Get-AiSettings
    $styleText = if ($Style -eq 'conventional') { 'Use the Conventional Commits format: type(optional scope): subject, with type one of feat, fix, docs, style, refactor, perf, test, build, ci, chore.' } else { 'Match the style of the recent commit subjects shown.' }
    $instructions = "You write Git commit messages. Reply with only the commit message, no code fences or commentary. First line: an imperative summary of at most 72 characters. If the change needs explanation, add a blank line and a short body wrapped at 72 characters explaining what changed and why. $styleText Write in $($settings.language)."
    $prompt = "Branch: $branch`n`nRecent commit subjects:`n$recent`n`nStaged files:`n$stat`n`nStaged diff:`n<diff>`n$body`n</diff>"
    if ($settings.provider -eq 'ollama') {
        $uri = ([string]$settings.ollamaUrl).TrimEnd('/')
        if ($uri -notmatch '^http://(127\.0\.0\.1|localhost)(:\d+)?$') { throw 'Ollama URL must point to this computer (127.0.0.1 or localhost).' }
        $result = Invoke-GitDeckHttpJson ($uri + '/api/generate') @{} @{model=$settings.ollamaModel; system=$instructions; prompt=$prompt; stream=$false} 180
        $text = [string]$result.response
    } else {
        if (-not $env:ANTHROPIC_API_KEY) { throw 'Set the ANTHROPIC_API_KEY environment variable and restart Git Deck to use AI commit messages.' }
        $headers = @{'x-api-key'=$env:ANTHROPIC_API_KEY; 'anthropic-version'='2023-06-01'; 'anthropic-beta'='server-side-fallback-2026-07-01'}
        $request = [ordered]@{model=$settings.model; max_tokens=16000; output_config=@{effort='low'}; fallbacks='default'; system=$instructions; messages=@(@{role='user'; content=$prompt})}
        $result = Invoke-GitDeckHttpJson 'https://api.anthropic.com/v1/messages' $headers $request 120
        if ($result.stop_reason -eq 'refusal') { throw 'The model declined to describe this diff. Write the message manually.' }
        $text = (@($result.content | Where-Object { $_.type -eq 'text' } | ForEach-Object { [string]$_.text }) -join "`n")
    }
    $text = ($text -replace '^\s*```[a-z]*\s*','' -replace '\s*```\s*$','').Trim()
    if (-not $text) { throw 'The AI provider returned an empty message.' }
    if ($text.Length -gt 500) { $text = $text.Substring(0, 500).TrimEnd() }
    return [ordered]@{message=$text; provider=$settings.provider; note=$note}
}

# ---------------------------------------------------------------------------
# GitHub integration through the official GitHub CLI (gh), mirroring the
# optional GitLab CLI support. Uses the user's own `gh auth login` session.
# ---------------------------------------------------------------------------
function Get-GhPath {
    $bundled = Join-Path $script:Root 'bin\gh.exe'
    if (Test-Path -LiteralPath $bundled -PathType Leaf) { return $bundled }
    $command = Get-Command gh -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    return ''
}

function Invoke-GhCapture([string[]]$Arguments, [string]$WorkingDirectory = '') {
    $gh = Get-GhPath
    if (-not $gh) { throw 'GitHub CLI (gh) is not installed. Install it from https://cli.github.com and run gh auth login.' }
    if ($WorkingDirectory) { Push-Location -LiteralPath $WorkingDirectory }
    try { $text = (& $gh @Arguments 2>&1 | ForEach-Object { if ($_ -is [Management.Automation.ErrorRecord]) { $_.Exception.Message } else { [string]$_ } } | Out-String).TrimEnd(); $code = $LASTEXITCODE }
    finally { if ($WorkingDirectory) { Pop-Location } }
    return @{Code=$code; Output=$text}
}

function Get-GitHubRepoSlug([string]$Path) {
    $remote = Get-OriginUrl $Path
    if ($remote -match '^(?:https?://(?:[^@/]+@)?|ssh://git@|git@)github\.com[:/]([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$') { return "$($Matches[1])/$($Matches[2])" }
    return ''
}

function Get-GitHubInbox([string]$Path) {
    Assert-Registered $Path
    $slug = Get-GitHubRepoSlug $Path
    if (-not $slug) { throw 'origin is not a github.com repository.' }
    if (-not (Get-GhPath)) { return [ordered]@{repo=$slug; installed=$false; authenticated=$false; pullRequests=@(); runs=@()} }
    $auth = Invoke-GhCapture @('auth', 'status', '--hostname', 'github.com')
    if ($auth.Code -ne 0) { return [ordered]@{repo=$slug; installed=$true; authenticated=$false; pullRequests=@(); runs=@()} }
    $prs = Invoke-GhCapture @('pr', 'list', '-R', $slug, '--limit', '30', '--json', 'number,title,author,headRefName,baseRefName,isDraft,url,reviewDecision,updatedAt')
    if ($prs.Code -ne 0) { throw $prs.Output }
    $runs = Invoke-GhCapture @('run', 'list', '-R', $slug, '--limit', '15', '--json', 'databaseId,displayTitle,status,conclusion,headBranch,event,url,createdAt,workflowName')
    # Assign arrays to variables first: $(...) would unwrap a one-item array.
    $prList = @(); if ($prs.Output) { $prList = @($prs.Output | ConvertFrom-Json | ForEach-Object { $_ }) }
    $runList = @(); if ($runs.Code -eq 0 -and $runs.Output) { $runList = @($runs.Output | ConvertFrom-Json | ForEach-Object { $_ }) }
    return [ordered]@{repo=$slug; installed=$true; authenticated=$true; pullRequests=$prList; runs=$runList}
}

function Invoke-GitDeckFeatureAction($Body) {
    # Returns $null for actions this module does not own.
    $action = [string]$Body.action
    $path = [string]$Body.path
    switch ($action) {
        'undo-last' { Assert-Registered $path; return Invoke-UndoLast $path ([string]$Body.id) }
        'ai-commit-message' { return New-AiCommitMessage $path ([string]$Body.style) }
        'github-login' {
            $gh = Get-GhPath; if (-not $gh) { throw 'GitHub CLI (gh) is not installed. Install it from https://cli.github.com first.' }
            $command = "& '$($gh.Replace("'","''"))' auth login --hostname github.com --web"
            Start-Process powershell.exe -ArgumentList @('-NoExit', '-Command', ('"' + $command + '"'))
            return @{message='GitHub login opened. Complete it in the Terminal, then refresh.'}
        }
        'github-pr-create' {
            Assert-Registered $path
            $slug = Get-GitHubRepoSlug $path; if (-not $slug) { throw 'origin is not a github.com repository.' }
            $title = ([string]$Body.title).Trim(); $description = [string]$Body.description; $base = ([string]$Body.base).Trim(); $head = ([string]$Body.head).Trim()
            if (-not $title -or $title.Length -gt 256) { throw 'Pull request title is required (at most 256 characters).' }
            if ($description.Length -gt 60000) { throw 'Pull request description is too long.' }
            if (-not $head) { $head = (Invoke-GitCapture $path @('branch', '--show-current')).Output.Trim() }
            Assert-BranchName $path $head
            if ($base -notmatch '^[A-Za-z0-9._/-]+$' -or $base.StartsWith('-')) { throw 'Invalid base branch.' }
            if ([string]::Equals($head, $base, [StringComparison]::OrdinalIgnoreCase)) { throw 'Head and base branches must be different.' }
            if ((Invoke-GitCapture $path @('show-ref', '--verify', '--quiet', ('refs/heads/' + $head))).Code -eq 0) { [void](Invoke-GitOrThrow $path @('push', '-u', 'origin', $head)) }
            # --flag=value keeps a title or body that starts with '-' from being read as a flag.
            $prArgs = @('pr', 'create', '-R', $slug, "--title=$title", "--body=$description", "--base=$base", "--head=$head")
            if ([bool]$Body.draft) { $prArgs += '--draft' }
            $result = Invoke-GhCapture $prArgs
            if ($result.Code -ne 0) { throw $result.Output }
            return @{message="Pull request created: $head -> $base."; output=$result.Output; url=(($result.Output -split "`r?`n" | Where-Object { $_ -match '^https://' } | Select-Object -Last 1))}
        }
        'github-pr-checkout' {
            Assert-Registered $path
            $number = [string]$Body.number; if ($number -notmatch '^\d{1,9}$') { throw 'Invalid pull request number.' }
            Assert-CleanWorkingTree $path 'Commit or stash changes before checking out a pull request.'
            $result = Invoke-GhCapture @('pr', 'checkout', $number) $path
            if ($result.Code -ne 0) { throw $result.Output }
            return @{message="Checked out pull request #$number."; output=$result.Output}
        }
        'github-run-rerun' {
            Assert-Registered $path
            $slug = Get-GitHubRepoSlug $path; $id = [string]$Body.run; if ($id -notmatch '^\d{1,15}$') { throw 'Invalid workflow run ID.' }
            $result = Invoke-GhCapture @('run', 'rerun', $id, '--failed', '-R', $slug)
            if ($result.Code -ne 0) { throw $result.Output }
            return @{message="Re-running failed jobs of run $id."; output=$result.Output}
        }
    }
    return $null
}
