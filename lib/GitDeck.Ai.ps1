# Git Deck AI helpers. Every feature goes through Invoke-GitDeckAi, which:
# - applies the repository's AI policy (git config --local gitdeck.ai):
#     on    = the configured provider (default)
#     local = only a local Ollama model may be used
#     off   = no AI for this repository
# - refuses to send anything that looks like a secret (all lines are checked,
#   not only added ones), and caps the size of what is sent;
# - asks for JSON that matches a schema when a feature needs structured data.
# AI never runs Git: features return text or proposals, and the UI asks the
# user to confirm any resulting action. Windows PowerShell 5.1 compatible.

$script:AiPolicies = @('on', 'local', 'off')
$script:AiSendLimit = 120000

function Get-GitDeckAiPolicy([string]$Path) {
    if (-not $Path) { return 'on' }
    $value = (Invoke-GitCapture $Path @('config', '--local', '--get', 'gitdeck.ai')).Output
    $value = ([string]$value).Trim().ToLowerInvariant()
    if ($value -in $script:AiPolicies) { return $value }
    return 'on'
}

function Set-GitDeckAiPolicy([string]$Path, [string]$Policy) {
    Assert-Registered $Path
    $Policy = ([string]$Policy).Trim().ToLowerInvariant()
    if ($Policy -notin $script:AiPolicies) { throw 'Invalid AI policy.' }
    # Local repository config only (.git/config); never committed or shared.
    if ($Policy -eq 'on') { [void](Invoke-GitCapture $Path @('config', '--local', '--unset', 'gitdeck.ai')) }
    else { [void](Invoke-GitOrThrow $Path @('config', '--local', 'gitdeck.ai', $Policy)) }
    $label = @{ on = 'AI allowed for this repository'; local = 'Only a local Ollama model may be used for this repository'; off = 'AI is off for this repository' }[$Policy]
    return @{ message = "$label."; policy = $Policy }
}

function Get-GitDeckAiRepoStatus([string]$Path) {
    $status = Get-AiStatus
    $policy = Get-GitDeckAiPolicy $Path
    $ready = [bool]$status.ready; $hint = [string]$status.hint
    if ($policy -eq 'off') { $ready = $false; $hint = 'AI is turned off for this repository (Settings > AI).' }
    elseif ($policy -eq 'local' -and $status.provider -ne 'ollama') { $ready = $false; $hint = 'This repository only allows a local model. Set "provider": "ollama" in git-deck-ai.json.' }
    $status.policy = $policy; $status.ready = $ready; $status.hint = $hint
    return $status
}

function Assert-GitDeckAiSafe([string]$Text) {
    # Find-GitDeckSecrets reads added diff lines; mark every line as added so
    # context, removed lines, logs and error text are all checked.
    $marked = (($Text -split "`r?`n") | ForEach-Object { if ($_ -match '^(diff --git |\+\+\+ |--- )') { $_ } else { '+' + $_ } }) -join "`n"
    $found = @(Find-GitDeckSecrets $marked | Where-Object { $_.level -eq 'block' })
    if ($found.Count) {
        $where = if ($found[0].file) { " in $($found[0].file)" } else { '' }
        throw "Not sent: the content contains what looks like a secret ($($found[0].label)$where). Remove it first."
    }
}

function Limit-GitDeckAiText([string]$Text, [int]$Limit, [ref]$Note) {
    if ($Text.Length -le $Limit) { return $Text }
    $Note.Value = "Only the first $([Math]::Round($Limit / 1000)) KB were sent."
    return $Text.Substring(0, $Limit)
}

function Invoke-GitDeckAi([string]$Path, [string]$Instructions, [string]$Prompt, $Schema = $null, [string]$Effort = 'low') {
    $policy = Get-GitDeckAiPolicy $Path
    if ($policy -eq 'off') { throw 'AI is turned off for this repository. Change it in Settings > AI.' }
    $settings = Get-AiSettings
    if ($policy -eq 'local' -and $settings.provider -ne 'ollama') { throw 'This repository only allows a local AI model. Set "provider": "ollama" in git-deck-ai.json, or change the repository AI setting.' }
    Assert-GitDeckAiSafe $Prompt
    $Instructions = "$Instructions Write in $($settings.language)."
    if ($settings.provider -eq 'ollama') {
        $uri = ([string]$settings.ollamaUrl).TrimEnd('/')
        if ($uri -notmatch '^http://(127\.0\.0\.1|localhost)(:\d+)?$') { throw 'Ollama URL must point to this computer (127.0.0.1 or localhost).' }
        $request = [ordered]@{ model = $settings.ollamaModel; system = $Instructions; prompt = $Prompt; stream = $false }
        if ($Schema) { $request.format = $Schema }
        $result = Invoke-GitDeckHttpJson ($uri + '/api/generate') @{} $request 180
        $text = [string]$result.response
    } else {
        if (-not $env:ANTHROPIC_API_KEY) { throw 'Set the ANTHROPIC_API_KEY environment variable and restart Git Deck to use AI features.' }
        $headers = @{ 'x-api-key' = $env:ANTHROPIC_API_KEY; 'anthropic-version' = '2023-06-01'; 'anthropic-beta' = 'server-side-fallback-2026-07-01' }
        # Opus 5.5 defaults to medium effort; these are short tasks, so say low explicitly.
        $output = [ordered]@{ effort = $Effort }
        if ($Schema) { $output.format = [ordered]@{ type = 'json_schema'; schema = $Schema } }
        $request = [ordered]@{ model = $settings.model; max_tokens = 16000; output_config = $output; fallbacks = 'default'; system = $Instructions; messages = @(@{ role = 'user'; content = $Prompt }) }
        $result = Invoke-GitDeckHttpJson 'https://api.anthropic.com/v1/messages' $headers $request 120
        if ($result.stop_reason -eq 'refusal') { throw 'The model declined this request.' }
        if ($result.stop_reason -eq 'max_tokens') { throw 'The AI answer was cut off. Try a smaller selection.' }
        $text = (@($result.content | Where-Object { $_.type -eq 'text' } | ForEach-Object { [string]$_.text }) -join "`n")
    }
    $text = ($text -replace '^\s*```[a-z]*\s*', '' -replace '\s*```\s*$', '').Trim()
    if (-not $text) { throw 'The AI provider returned an empty answer.' }
    if (-not $Schema) { return $text }
    try { return ($text | ConvertFrom-Json) } catch { throw 'The AI provider returned an answer that is not valid JSON.' }
}

# Strict schemas: every object lists all properties as required and forbids extras.
function New-GitDeckAiSchema([Collections.IDictionary]$Properties) {
    return [ordered]@{ type = 'object'; properties = $Properties; required = @($Properties.Keys); additionalProperties = $false }
}

function Get-GitDeckRepoContext([string]$Path) {
    $branch = (Invoke-GitCapture $Path @('branch', '--show-current')).Output.Trim()
    $upstream = (Invoke-GitCapture $Path @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'))
    $counts = if ($upstream.Code -eq 0) { (Invoke-GitCapture $Path @('rev-list', '--left-right', '--count', 'HEAD...@{u}')).Output.Trim() } else { '' }
    $status = @((Invoke-GitCapture $Path @('status', '--porcelain')).Output -split "`r?`n" | Where-Object { $_ })
    $operation = Get-GitOperationState $Path
    $sync = if ($counts -match '^(\d+)\s+(\d+)$') { "ahead $($Matches[1]), behind $($Matches[2]) of $($upstream.Output.Trim())" } elseif ($upstream.Code -eq 0) { "tracking $($upstream.Output.Trim())" } else { 'no upstream branch' }
    $op = if ($operation.active) { "$($operation.type) in progress with $(@($operation.conflicts).Count) conflicted file(s)" } else { 'none' }
    return "Branch: $(if ($branch) { $branch } else { 'detached HEAD' })`nSync: $sync`nUncommitted changes: $($status.Count) file(s)`nUnfinished operation: $op"
}

$script:GitDeckActionGuide = 'Git Deck buttons and views the user can use: Fetch, Pull (fast-forward only / merge / rebase), Push (with force-with-lease option), Commit (with Amend), Stage/Unstage file, hunk or selected lines, Stash changes, Branches view (create, switch, merge, rebase, delete), Conflict Center (resolve with Ours/Theirs/Both/Manual, continue or abort), Recovery (reflog, create recovery branch), Undo last action, Settings (identity, remotes).'

# ---- 1. Explain a failed Git action ------------------------------------------------
function Get-GitDeckAiErrorExplanation([string]$Path, [string]$Action, [string]$ErrorText) {
    Assert-Registered $Path
    if (-not $ErrorText.Trim()) { throw 'There is no error to explain.' }
    $note = ''; $errorPart = Limit-GitDeckAiText $ErrorText 8000 ([ref]$note)
    $instructions = "You explain failed Git operations to a developer using the Git Deck desktop app. In at most 5 short sentences: say what went wrong in plain words, why, and the next steps using Git Deck's buttons. Do not invent repository details. Reply in plain text. $script:GitDeckActionGuide"
    $prompt = "Action: $Action`n$(Get-GitDeckRepoContext $Path)`n`nGit output:`n<error>`n$errorPart`n</error>"
    return [ordered]@{ explanation = (Invoke-GitDeckAi $Path $instructions $prompt); note = $note }
}

# ---- 2. Draft a pull / merge request description ----------------------------------------
function New-GitDeckAiPullRequest([string]$Path, [string]$Base, [string]$Head) {
    Assert-Registered $Path
    # Merge-request targets often exist only on the remote (for example "develop").
    $resolve = { param($ref) if (-not $ref -or $ref.StartsWith('-')) { return '' }; foreach ($candidate in @($ref, "origin/$ref")) { if ((Invoke-GitCapture $Path @('rev-parse', '--verify', '--quiet', "$candidate^{commit}")).Code -eq 0) { return $candidate } }; return '' }
    $baseRef = & $resolve $Base; $headRef = & $resolve $Head
    if (-not $baseRef) { throw "Unknown branch: $Base" }; if (-not $headRef) { throw "Unknown branch: $Head" }
    $Base = $baseRef; $Head = $headRef
    $range = "$Base...$Head"
    $log = (Invoke-GitCapture $Path @('log', '--no-color', '--format=- %s%n%b', '-50', "$Base..$Head")).Output
    if (-not $log.Trim()) { throw "$Head has no commits that $Base does not already have." }
    $stat = (Invoke-GitCapture $Path @('diff', '--no-color', '--stat=120', $range)).Output
    $note = ''; $diff = Limit-GitDeckAiText (Invoke-GitCapture $Path @('diff', '--no-color', '--no-ext-diff', '-U2', $range)).Output 60000 ([ref]$note)
    $instructions = 'You write pull request descriptions. Title: imperative, at most 72 characters. Body in Markdown with sections "## Summary" (bullets of what changed and why), "## Testing" (how to verify; say what is unknown instead of inventing test results) and, only if relevant, "## Notes" (risks, follow-ups). Base everything on the commits and diff only.'
    $prompt = "Merge $Head into $Base.`n`nCommits:`n$log`n`nFiles:`n$stat`n`nDiff:`n<diff>`n$diff`n</diff>"
    $answer = Invoke-GitDeckAi $Path $instructions $prompt (New-GitDeckAiSchema ([ordered]@{ title = @{ type = 'string' }; body = @{ type = 'string' } }))
    $title = ([string]$answer.title).Trim(); if ($title.Length -gt 256) { $title = $title.Substring(0, 256) }
    return [ordered]@{ title = $title; body = ([string]$answer.body).Trim(); note = $note }
}

# ---- 3. Explain a commit ---------------------------------------------------------------------
function Get-GitDeckAiCommitExplanation([string]$Path, [string]$Commit) {
    Assert-Registered $Path
    if ($Commit -notmatch '^[0-9a-fA-F]{4,40}$') { throw 'Invalid commit hash.' }
    $note = ''; $show = Limit-GitDeckAiText (Invoke-GitCapture $Path @('show', '--no-color', '--no-ext-diff', '--stat', '--patch', '-U2', $Commit)).Output 80000 ([ref]$note)
    $instructions = 'You explain a Git commit to a developer reviewing history. Give: one sentence on what the commit does; 2-5 bullets on the notable changes; one line on possible risks or side effects (or "No obvious risks"). Plain text with "- " bullets. Base it only on the commit shown.'
    return [ordered]@{ explanation = (Invoke-GitDeckAi $Path $instructions "<commit>`n$show`n</commit>"); note = $note }
}

# ---- 4. Propose a conflict resolution ----------------------------------------------------------
function Get-GitDeckAiConflictProposal([string]$Path, [string]$File) {
    $details = Get-ConflictDetails $Path $File
    $total = ([string]$details.base).Length + ([string]$details.ours).Length + ([string]$details.theirs).Length
    if ($total -gt 150000) { throw 'This file is too large for an AI proposal. Resolve it manually.' }
    $instructions = 'You resolve a Git merge conflict for one file. You get the common ancestor (base), the current branch version (ours) and the incoming version (theirs). Explain briefly what each side changed and how you combined them, then return the complete merged file content with no conflict markers. Keep both sides'' intent when they do not contradict; if they do, prefer the smallest change and say so. Never invent unrelated code.'
    $prompt = "File: $File (operation: $($details.operation))`n<base>`n$($details.base)`n</base>`n<ours>`n$($details.ours)`n</ours>`n<theirs>`n$($details.theirs)`n</theirs>"
    $answer = Invoke-GitDeckAi $Path $instructions $prompt (New-GitDeckAiSchema ([ordered]@{ explanation = @{ type = 'string' }; merged = @{ type = 'string' } })) 'medium'
    $merged = [string]$answer.merged
    if ($merged -match '(?m)^(<<<<<<<|=======|>>>>>>>)( |$)') { throw 'The AI proposal still contains conflict markers. Resolve this file manually.' }
    return [ordered]@{ file = $File; explanation = ([string]$answer.explanation).Trim(); merged = $merged }
}

# ---- 5. Review commits before pushing ----------------------------------------------------------------
function Get-GitDeckAiPushReview([string]$Path, [string]$Remote, [string]$Local, [string]$Target) {
    Assert-Registered $Path
    Assert-RemoteName $Path $Remote; Assert-BranchName $Path $Local
    if (-not $Target -or $Target.StartsWith('-')) { throw 'Invalid target branch.' }
    # Outgoing = commits no branch of this remote has yet (also right for a new branch).
    $outgoing = @((Invoke-GitOrThrow $Path @('rev-list', '--max-count=200', "refs/heads/$Local", '--not', "--remotes=$Remote")) -split "`r?`n" | Where-Object { $_ })
    $count = $outgoing.Count
    if (-not $count) { return [ordered]@{ summary = 'Nothing new to push.'; findings = @(); note = '' } }
    $oldest = $outgoing[-1]
    $hasParent = (Invoke-GitCapture $Path @('rev-parse', '--verify', '--quiet', "$oldest^")).Code -eq 0
    $diffArgs = if ($hasParent) { @('diff', '--no-color', '--no-ext-diff', '-U2', "$oldest^", "refs/heads/$Local") } else { @('log', '--no-color', '--format=', '-p', '-U2', "refs/heads/$Local", '--not', "--remotes=$Remote") }
    $note = ''; $diff = Limit-GitDeckAiText (Invoke-GitCapture $Path $diffArgs).Output 80000 ([ref]$note)
    $instructions = 'You review code that is about to be pushed. Report only concrete problems a reviewer would flag: leftover debug output, commented-out code, TODO/FIXME added now, obvious bugs, missing error handling, risky changes. Skip style nits and anything you are unsure about. Each finding names the file and says why it matters. If there is nothing worth flagging, return no findings.'
    $item = New-GitDeckAiSchema ([ordered]@{ severity = @{ type = 'string'; enum = @('warn', 'info') }; file = @{ type = 'string' }; message = @{ type = 'string' } })
    $schema = New-GitDeckAiSchema ([ordered]@{ summary = @{ type = 'string' }; findings = @{ type = 'array'; items = $item } })
    $answer = Invoke-GitDeckAi $Path $instructions "$count commit(s) to push from $Local to $Remote/$Target.`n<diff>`n$diff`n</diff>" $schema 'medium'
    return [ordered]@{ summary = ([string]$answer.summary).Trim(); findings = @($answer.findings | Select-Object -First 20); note = $note }
}

# ---- 6. Split staged changes into focused commits --------------------------------------------------------
function Get-GitDeckStagedHunks([string]$Path) {
    # Returns @{ header per file; hunks = [@{id; file; header; lines}] } from `git diff --cached`.
    $diff = ((Invoke-GitCapture $Path @('diff', '--cached', '--no-color', '--no-ext-diff', '-U3')).Output) -replace "`r`n", "`n"
    $hunks = New-Object 'System.Collections.Generic.List[object]'; $headers = @{}
    $file = ''; $header = New-Object 'System.Collections.Generic.List[string]'; $current = $null; $index = 0
    foreach ($line in ($diff -split "`n")) {
        if ($line.StartsWith('diff --git ')) {
            if ($current) { $hunks.Add($current); $current = $null }
            $file = ($line -replace '^diff --git a/.+? b/', ''); $header = New-Object 'System.Collections.Generic.List[string]'; $header.Add($line); $headers[$file] = $header; $index = 0; continue
        }
        if ($line.StartsWith('@@')) {
            if ($current) { $hunks.Add($current) }
            $index++; $current = [ordered]@{ id = "$file#$index"; file = $file; lines = (New-Object 'System.Collections.Generic.List[string]') }; $current.lines.Add($line); continue
        }
        if ($current) { $current.lines.Add($line) } elseif ($file) { $header.Add($line) }
    }
    if ($current) { $hunks.Add($current) }
    return [ordered]@{ text = $diff; headers = $headers; hunks = $hunks }
}

function Get-GitDeckAiCommitSplit([string]$Path) {
    Assert-Registered $Path
    $staged = Get-GitDeckStagedHunks $Path
    if ($staged.hunks.Count -lt 2) { throw 'Stage at least two hunks to split them into commits.' }
    if ($staged.hunks.Count -gt 150) { throw 'Too many staged hunks to plan a split. Stage a smaller set.' }
    $listing = ($staged.hunks | ForEach-Object { "### hunk $($_.id)`n" + (($_.lines | Select-Object -First 60) -join "`n") }) -join "`n"
    $note = ''; $listing = Limit-GitDeckAiText $listing 90000 ([ref]$note)
    $instructions = 'You split staged changes into small, focused commits. Group hunks that belong to one logical change; every hunk id must appear in exactly one group. Order groups so each commit makes sense on its own (for example refactors before features that use them). Give each group an imperative commit subject of at most 72 characters. Use 1 group if the changes are really one change.'
    $group = New-GitDeckAiSchema ([ordered]@{ message = @{ type = 'string' }; hunks = @{ type = 'array'; items = @{ type = 'string' } } })
    $answer = Invoke-GitDeckAi $Path $instructions "<hunks>`n$listing`n</hunks>" (New-GitDeckAiSchema ([ordered]@{ groups = @{ type = 'array'; items = $group } })) 'medium'
    $known = @{}; foreach ($hunk in $staged.hunks) { $known[$hunk.id] = $true }
    $seen = @{}; $groups = New-Object 'System.Collections.Generic.List[object]'
    foreach ($item in @($answer.groups)) {
        $ids = @(@($item.hunks) | ForEach-Object { [string]$_ } | Where-Object { $known.ContainsKey($_) -and -not $seen.ContainsKey($_) })
        foreach ($id in $ids) { $seen[$id] = $true }
        if ($ids.Count) { $groups.Add([ordered]@{ message = ([string]$item.message).Trim(); hunks = $ids }) }
    }
    $missing = @($staged.hunks | Where-Object { -not $seen.ContainsKey($_.id) } | ForEach-Object { $_.id })
    if ($missing.Count) { $groups.Add([ordered]@{ message = 'Remaining staged changes'; hunks = $missing }) }
    $fingerprint = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($staged.text))).Replace('-', '')
    return [ordered]@{ groups = $groups; fingerprint = $fingerprint; note = $note }
}

function Invoke-GitDeckKeepStagedHunks([string]$Path, [string[]]$Keep, [string]$Fingerprint) {
    # Unstages every staged hunk that is not in $Keep; working files are untouched.
    Assert-Registered $Path
    $staged = Get-GitDeckStagedHunks $Path
    $current = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($staged.text))).Replace('-', '')
    if ($current -ne $Fingerprint) { throw 'The staged changes changed since the plan was made. Plan the split again.' }
    $keepSet = @{}; foreach ($id in @($Keep)) { $keepSet[[string]$id] = $true }
    if (-not $keepSet.Count) { throw 'Choose at least one hunk to keep staged.' }
    $drop = @($staged.hunks | Where-Object { -not $keepSet.ContainsKey($_.id) })
    if (-not $drop.Count) { return @{ message = 'Only this group is staged already.' } }
    $patch = New-Object 'System.Collections.Generic.List[string]'
    foreach ($group in ($drop | Group-Object { $_.file })) {
        foreach ($line in $staged.headers[$group.Name]) { $patch.Add($line) }
        foreach ($hunk in $group.Group) { foreach ($line in $hunk.lines) { $patch.Add($line) } }
    }
    # Same path as hunk/line unstaging in File Status (git apply --cached --reverse --recount).
    try { [void](Invoke-GitPatch $Path ((($patch -join "`n").TrimEnd("`n")) + "`n") $true $true) }
    catch { throw "Could not unstage the other hunks: $($_.Exception.Message)" }
    return @{ message = "Kept $($keepSet.Count) hunk(s) staged; $($drop.Count) other hunk(s) moved back to unstaged." }
}

# ---- 7. Natural-language command -------------------------------------------------------------------
function Get-GitDeckAiCommand([string]$Path, [string]$Request, $Commands) {
    $text = ([string]$Request).Trim()
    if (-not $text -or $text.Length -gt 500) { throw 'Describe what you want to do in at most 500 characters.' }
    $list = @($Commands | Select-Object -First 200 | ForEach-Object { [ordered]@{ id = [string]$_.id; label = [string]$_.label } } | Where-Object { $_.id })
    if (-not $list.Count) { throw 'No commands are available.' }
    $ids = @($list | ForEach-Object { $_.id })
    $catalog = ($list | ForEach-Object { "$($_.id): $($_.label)" }) -join "`n"
    $instructions = 'You map a user request to exactly one command of the Git Deck app, or to none. Only choose from the listed command ids. If no command fits, or the request is ambiguous or unsafe, return an empty commandId and explain what the user can do instead. Git Deck will still ask the user to confirm before anything runs.'
    $schema = New-GitDeckAiSchema ([ordered]@{ commandId = @{ type = 'string' }; explanation = @{ type = 'string' } })
    $prompt = "$(if ($Path) { Get-GitDeckRepoContext $Path } else { 'No repository open.' })`n`nCommands:`n$catalog`n`nRequest: $text"
    $answer = Invoke-GitDeckAi $Path $instructions $prompt $schema
    $id = [string]$answer.commandId
    if ($id -and $id -notin $ids) { $id = '' }
    return [ordered]@{ commandId = $id; explanation = ([string]$answer.explanation).Trim() }
}

# ---- 8. Ask about the reflog -----------------------------------------------------------------------
function Get-GitDeckAiReflogAnswer([string]$Path, [string]$Question) {
    $text = ([string]$Question).Trim()
    if (-not $text -or $text.Length -gt 500) { throw 'Ask a question of at most 500 characters.' }
    $entries = @(Get-ReflogEntries $Path)
    if (-not $entries.Count) { throw 'The reflog is empty.' }
    $listing = ($entries | ForEach-Object { "$($_.hash) $($_.date) $($_.selector) $($_.message)" }) -join "`n"
    $instructions = 'You help a developer find lost work in the Git reflog. Answer in at most 4 sentences, in plain words, and name the most likely commits. Only use hashes from the reflog shown. Recovery in Git Deck: Recovery view > create a recovery branch at a commit (safe, does not move HEAD).'
    $candidate = New-GitDeckAiSchema ([ordered]@{ hash = @{ type = 'string' }; reason = @{ type = 'string' } })
    $schema = New-GitDeckAiSchema ([ordered]@{ answer = @{ type = 'string' }; candidates = @{ type = 'array'; items = $candidate } })
    $answer = Invoke-GitDeckAi $Path $instructions "Now: $((Get-Date).ToString('yyyy-MM-dd HH:mm zzz'))`n<reflog>`n$listing`n</reflog>`n`nQuestion: $text" $schema
    $valid = @{}; foreach ($entry in $entries) { $valid[$entry.hash] = $entry.fullHash }
    $candidates = @(@($answer.candidates) | Where-Object { $valid.ContainsKey([string]$_.hash) } | Select-Object -First 5 | ForEach-Object { [ordered]@{ hash = [string]$_.hash; fullHash = $valid[[string]$_.hash]; reason = [string]$_.reason } })
    return [ordered]@{ answer = ([string]$answer.answer).Trim(); candidates = $candidates }
}

# ---- 9. Release notes -------------------------------------------------------------------------------------
function New-GitDeckAiReleaseNotes([string]$Path, [string]$From, [string]$To) {
    Assert-Registered $Path
    if (-not $To) { $To = 'HEAD' }
    foreach ($ref in @($From, $To) | Where-Object { $_ }) { if ($ref.StartsWith('-') -or (Invoke-GitCapture $Path @('rev-parse', '--verify', '--quiet', "$ref^{commit}")).Code -ne 0) { throw "Unknown tag or commit: $ref" } }
    $range = if ($From) { "$From..$To" } else { $To }
    $log = (Invoke-GitCapture $Path @('log', '--no-color', '--no-merges', '--format=- %s (%an)%n%b', '-300', $range)).Output
    if (-not $log.Trim()) { throw 'There are no commits in this range.' }
    $note = ''; $log = Limit-GitDeckAiText $log 60000 ([ref]$note)
    $instructions = 'You write release notes in Markdown for the commits given. Group changes under "### Features", "### Fixes" and "### Other" (omit empty groups), one bullet per user-visible change written for users, merging related commits. Skip internal noise such as merge commits or formatting-only changes. Do not invent changes.'
    return [ordered]@{ notes = (Invoke-GitDeckAi $Path $instructions "Release $(if ($From) { "from $From " })to $To.`n<commits>`n$log`n</commits>"); range = $range; note = $note }
}

function Invoke-GitDeckAiAction($Body) {
    # Returns $null for actions this module does not own.
    $path = [string]$Body.path
    switch ([string]$Body.action) {
        'ai-policy-set' { return Set-GitDeckAiPolicy $path ([string]$Body.policy) }
        'ai-explain-error' { return Get-GitDeckAiErrorExplanation $path ([string]$Body.failedAction) ([string]$Body.error) }
        'ai-pr-description' { return New-GitDeckAiPullRequest $path ([string]$Body.base) ([string]$Body.head) }
        'ai-explain-commit' { return Get-GitDeckAiCommitExplanation $path ([string]$Body.commit) }
        'ai-conflict-proposal' { return Get-GitDeckAiConflictProposal $path ([string]$Body.file) }
        'ai-push-review' { return Get-GitDeckAiPushReview $path ([string]$Body.remote) ([string]$Body.local) ([string]$Body.target) }
        'ai-split-plan' { return Get-GitDeckAiCommitSplit $path }
        'keep-staged-hunks' { return Invoke-GitDeckKeepStagedHunks $path @($Body.hunks) ([string]$Body.fingerprint) }
        'ai-command' { if ($path) { Assert-Registered $path }; return Get-GitDeckAiCommand $path ([string]$Body.request) @($Body.commands) }
        'ai-reflog' { Assert-Registered $path; return Get-GitDeckAiReflogAnswer $path ([string]$Body.question) }
        'ai-release-notes' { return New-GitDeckAiReleaseNotes $path ([string]$Body.from) ([string]$Body.to) }
    }
    return $null
}
