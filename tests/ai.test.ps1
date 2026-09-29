$ErrorActionPreference='Stop'
$gitDeck=Split-Path $PSScriptRoot -Parent
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $gitDeck 'git-dashboard-server.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Server parse failed'}
foreach($name in @('Invoke-GitCapture','Invoke-GitOrThrow','Get-GitOperationState','Get-GitDeckVisibleStatusLines','Test-GitDeckProtectedStatusLine','Test-GitDeckProtectedPath','Assert-RemoteName','Assert-BranchName','Invoke-GitPatch','Get-ConflictDetails','Get-ReflogEntries')){
    $fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)[0]
    if(-not $fn){throw "Missing server function $name"}
    $definition=$fn.Extent.Text
    if($name -eq 'Invoke-GitCapture'){$definition=$definition.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))}
    . ([scriptblock]::Create($definition))
}
$script:Root=Join-Path ([IO.Path]::GetTempPath()) ('gd-ai-config-'+[guid]::NewGuid().ToString('N'))  # never read a real git-deck-ai.json
. (Join-Path $gitDeck 'lib\GitDeck.Features.ps1')
. (Join-Path $gitDeck 'lib\GitDeck.Ai.ps1')
function Assert-Registered($Path){}
function Run-Git([string]$Path,[string[]]$Arguments){[void](Invoke-GitOrThrow $Path $Arguments)}
function Write-Text([string]$File,[string]$Text){[IO.File]::WriteAllText($File,$Text)}
function Expect-Throw([scriptblock]$Block,[string]$Pattern,[string]$Label){$message='';try{& $Block|Out-Null}catch{$message=$_.Exception.Message};if($message -notmatch $Pattern){throw "$Label`: expected /$Pattern/, got '$message'"}}
# Mocked provider: records each request and answers with the next queued text.
$script:replies=New-Object 'System.Collections.Generic.Queue[string]';$script:sent=@()
function Invoke-GitDeckHttpJson($Uri,$Headers,$Body,$TimeoutSec){$script:sent+=,@{uri=$Uri;headers=$Headers;body=$Body};return [pscustomobject]@{stop_reason='end_turn';content=@([pscustomobject]@{type='text';text=$script:replies.Dequeue()})}}
function Reply([string]$Text){$script:replies.Enqueue($Text)}
function Last-Prompt{return [string]$script:sent[-1].body.messages[0].content}
$env:ANTHROPIC_API_KEY='test-key';$env:GITDECK_AI_PROVIDER='';$env:GITDECK_AI_MODEL=''

$base=Join-Path $gitDeck ('output\ai-test-'+[guid]::NewGuid().ToString('N'))
try{
    [void](New-Item -ItemType Directory -Path $base)
    $remote=Join-Path $base 'remote.git';$repo=Join-Path $base 'repo'
    Run-Git $base @('init','-q','--bare','-b','main',$remote)
    Run-Git $base @('clone','-q','-c','core.autocrlf=false',$remote,$repo)
    Run-Git $repo @('config','user.email','t@example.test');Run-Git $repo @('config','user.name','Test')
    Write-Text (Join-Path $repo 'a.txt') ((1..30|ForEach-Object{"line $_"}) -join "`n")
    Run-Git $repo @('add','.');Run-Git $repo @('commit','-q','-m','init');Run-Git $repo @('tag','v1');Run-Git $repo @('push','-q','origin','main')

    # ---- Policy: per repository, stored in local git config --------------------------
    if((Get-GitDeckAiPolicy $repo) -ne 'on'){throw 'Default policy must be on'}
    [void](Set-GitDeckAiPolicy $repo 'local')
    if((Invoke-GitOrThrow $repo @('config','--local','--get','gitdeck.ai')).Trim() -ne 'local'){throw 'Policy not stored in repo config'}
    Expect-Throw {Invoke-GitDeckAi $repo 'x' 'hello'} 'only allows a local' 'local policy with Anthropic'
    $status=Get-GitDeckAiRepoStatus $repo;if($status.ready -or $status.policy -ne 'local'){throw 'Status must reflect the local-only policy'}
    [void](Set-GitDeckAiPolicy $repo 'off')
    Expect-Throw {Invoke-GitDeckAi $repo 'x' 'hello'} 'turned off' 'off policy'
    [void](Set-GitDeckAiPolicy $repo 'on')
    if((Invoke-GitCapture $repo @('config','--local','--get','gitdeck.ai')).Code -eq 0){throw 'on must remove the setting'}
    Expect-Throw {Set-GitDeckAiPolicy $repo 'sometimes'} 'Invalid AI policy' 'invalid policy'
    if($script:sent.Count){throw 'Blocked requests must never reach the provider'}

    # ---- Secrets are checked on every line, not only added diff lines ---------------------
    Expect-Throw {Invoke-GitDeckAi $repo 'x' "error: auth failed`n-aws = AKIAABCDEFGHIJKLMNOP"} 'secret' 'removed-line secret'
    Expect-Throw {Invoke-GitDeckAi $repo 'x' 'remote: token ghp_abcdefghijklmnopqrstuvwxyz0123456789 rejected'} 'secret' 'plain-text token'
    if($script:sent.Count){throw 'Secrets must never reach the provider'}

    # ---- JSON schema request shape and parsing -----------------------------------------------
    Reply '{"title":"Add login","body":"## Summary"}'
    $answer=Invoke-GitDeckAi $repo 'x' 'y' (New-GitDeckAiSchema ([ordered]@{title=@{type='string'};body=@{type='string'}}))
    $sentBody=$script:sent[-1].body
    if($answer.title -ne 'Add login'){throw 'JSON answer not parsed'}
    if($sentBody.output_config.format.type -ne 'json_schema' -or $sentBody.output_config.format.schema.additionalProperties -ne $false -or (@($sentBody.output_config.format.schema.required) -join ',') -ne 'title,body'){throw 'Schema not sent as output_config.format'}
    if($sentBody.output_config.effort -ne 'low' -or $sentBody.fallbacks -ne 'default' -or $sentBody.model -ne 'claude-opus-5-5' -or $sentBody.system -notmatch 'Write in English'){throw 'Unexpected request body'}
    Reply 'not json';Expect-Throw {Invoke-GitDeckAi $repo 'x' 'y' (New-GitDeckAiSchema ([ordered]@{a=@{type='string'}}))} 'not valid JSON' 'invalid JSON'

    # ---- 1. Explain error: repo context + error, no code --------------------------------------
    Reply 'The remote has newer commits. Fetch, then Pull.'
    $result=Get-GitDeckAiErrorExplanation $repo 'push' '! [rejected] main -> main (non-fast-forward)'
    if($result.explanation -notmatch 'Fetch'){throw 'Explanation not returned'}
    if((Last-Prompt) -notmatch 'Branch: main' -or (Last-Prompt) -notmatch 'non-fast-forward'){throw 'Error prompt missing context'}

    # ---- 2. PR description from base..head ----------------------------------------------------
    Run-Git $repo @('switch','-q','-c','feature/login')
    Write-Text (Join-Path $repo 'login.txt') 'form';Run-Git $repo @('add','.');Run-Git $repo @('commit','-q','-m','Add login form')
    Reply ('{"title":"'+('x'*300)+'","body":"## Summary\n- Login form"}')
    $pr=New-GitDeckAiPullRequest $repo 'main' 'feature/login'
    if($pr.title.Length -ne 256 -or $pr.body -notmatch 'Login form'){throw 'PR draft not shaped'}
    if((Last-Prompt) -notmatch 'Add login form' -or (Last-Prompt) -notmatch 'login.txt'){throw 'PR prompt missing commits/files'}
    Expect-Throw {New-GitDeckAiPullRequest $repo 'main' 'main'} 'no commits' 'empty PR range'
    Expect-Throw {New-GitDeckAiPullRequest $repo '--upload-pack=x' 'main'} 'Unknown branch' 'option-like ref'

    # ---- 3. Explain commit ---------------------------------------------------------------------------
    Reply 'Adds a login form.'
    $head=(Invoke-GitOrThrow $repo @('rev-parse','HEAD')).Trim()
    if((Get-GitDeckAiCommitExplanation $repo $head).explanation -ne 'Adds a login form.' -or (Last-Prompt) -notmatch 'login.txt'){throw 'Commit explanation wrong'}
    Expect-Throw {Get-GitDeckAiCommitExplanation $repo 'HEAD; rm'} 'Invalid commit' 'commit validation'

    # ---- 5. Push review of outgoing commits only ------------------------------------------------------
    Reply '{"summary":"One leftover debug line.","findings":[{"severity":"warn","file":"login.txt","message":"debug"}]}'
    $review=Get-GitDeckAiPushReview $repo 'origin' 'feature/login' 'feature/login'
    if(@($review.findings).Count -ne 1 -or (Last-Prompt) -notmatch '1 commit'){throw 'Push review wrong'}
    Run-Git $repo @('switch','-q','main')
    $none=Get-GitDeckAiPushReview $repo 'origin' 'main' 'main';if($none.summary -ne 'Nothing new to push.'){throw 'Up-to-date branch must not call AI'}

    # ---- 6. Split staged hunks, then keep one group staged ---------------------------------------------
    Write-Text (Join-Path $repo 'a.txt') ((1..30|ForEach-Object{if($_ -eq 2){'line 2 changed'}elseif($_ -eq 27){'line 27 changed'}else{"line $_"}}) -join "`n")
    Write-Text (Join-Path $repo 'b.txt') "new file`n"
    Run-Git $repo @('add','.')
    Reply '{"groups":[{"message":"Change line 2","hunks":["a.txt#1"]},{"message":"Add b","hunks":["bogus#9","b.txt#1","a.txt#1"]}]}'
    $plan=Get-GitDeckAiCommitSplit $repo
    $shape=($plan.groups|ForEach-Object{"$($_.message)=$(@($_.hunks) -join '+')"}) -join ' | '
    if($shape -ne 'Change line 2=a.txt#1 | Add b=b.txt#1 | Remaining staged changes=a.txt#2'){throw "Split plan not validated: $shape"}
    Expect-Throw {Invoke-GitDeckKeepStagedHunks $repo @('a.txt#1') 'stale'} 'changed since' 'stale fingerprint'
    $kept=Invoke-GitDeckKeepStagedHunks $repo @('a.txt#1') $plan.fingerprint
    $cached=(Invoke-GitOrThrow $repo @('diff','--cached','--no-color'))
    if($cached -notmatch 'line 2 changed' -or $cached -match 'line 27 changed' -or $cached -match 'b.txt'){throw "Only the chosen hunk may stay staged: $cached"}
    if([IO.File]::ReadAllText((Join-Path $repo 'a.txt')) -notmatch 'line 27 changed' -or -not (Test-Path (Join-Path $repo 'b.txt'))){throw 'Working files must be untouched'}
    Run-Git $repo @('reset','-q','--hard');Run-Git $repo @('clean','-qfd')
    Write-Text (Join-Path $repo 'a.txt') "only one`n";Run-Git $repo @('add','.')
    Expect-Throw {Get-GitDeckAiCommitSplit $repo} 'at least two hunks' 'single hunk'
    Run-Git $repo @('reset','-q','--hard')

    # ---- 7. Natural-language command: only listed ids ----------------------------------------------------
    $commands=@([pscustomobject]@{id='cmd-fetch';label='Fetch'},[pscustomobject]@{id='cmd-undo';label='Undo last action'})
    Reply '{"commandId":"cmd-undo","explanation":"Undo keeps your changes."}'
    if((Get-GitDeckAiCommand $repo 'undo my last commit' $commands).commandId -ne 'cmd-undo'){throw 'Valid command id dropped'}
    Reply '{"commandId":"git reset --hard","explanation":"x"}'
    if((Get-GitDeckAiCommand $repo 'wipe everything' $commands).commandId -ne ''){throw 'Unknown command ids must be discarded'}
    if((Last-Prompt) -notmatch 'cmd-fetch: Fetch'){throw 'Command catalog not sent'}

    # ---- 8. Reflog: only real hashes come back -------------------------------------------------------------
    $short=(Invoke-GitOrThrow $repo @('rev-parse','--short','HEAD')).Trim()
    Reply ('{"answer":"It is at '+$short+'.","candidates":[{"hash":"'+$short+'","reason":"latest"},{"hash":"deadbee","reason":"made up"}]}')
    $reflog=Get-GitDeckAiReflogAnswer $repo 'where did my work go'
    if(@($reflog.candidates).Count -ne 1 -or $reflog.candidates[0].hash -ne $short -or -not $reflog.candidates[0].fullHash){throw 'Reflog candidates not validated'}

    # ---- 9. Release notes from a tag to HEAD ------------------------------------------------------------------
    Run-Git $repo @('merge','-q','--no-edit','feature/login')
    Reply "### Features`n- Login form"
    $notes=New-GitDeckAiReleaseNotes $repo 'v1' ''
    if($notes.range -ne 'v1..HEAD' -or (Last-Prompt) -notmatch 'Add login form' -or (Last-Prompt) -match '- init'){throw 'Release notes range wrong'}

    # ---- 4. Conflict proposal: never with markers ---------------------------------------------------------------
    Run-Git $repo @('switch','-q','-c','other','v1')
    Write-Text (Join-Path $repo 'a.txt') "theirs`n";Run-Git $repo @('commit','-q','-am','theirs')
    Run-Git $repo @('switch','-q','main')
    Write-Text (Join-Path $repo 'a.txt') "ours`n";Run-Git $repo @('commit','-q','-am','ours')
    [void](Invoke-GitCapture $repo @('merge','other'))
    Reply '{"explanation":"x","merged":"<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n"}'
    Expect-Throw {Get-GitDeckAiConflictProposal $repo 'a.txt'} 'conflict markers' 'markers in proposal'
    Reply '{"explanation":"Kept both lines.","merged":"ours\ntheirs\n"}'
    $proposal=Get-GitDeckAiConflictProposal $repo 'a.txt'
    if($proposal.merged -ne "ours`ntheirs`n" -or (Last-Prompt) -notmatch '<theirs>'){throw 'Conflict proposal wrong'}
    if(-not (Get-GitOperationState $repo).active){throw 'A proposal must not resolve anything by itself'}

    # ---- Actions route through Invoke-GitDeckAiAction -----------------------------------------------------------
    if($null -ne (Invoke-GitDeckAiAction ([pscustomobject]@{action='push';path=$repo}))){throw 'Unknown actions must fall through'}
    if($script:replies.Count){throw "Unused mock replies: $($script:replies.Count)"}
    'PASS: AI policy, secret blocking, schema requests, explain/PR/commit/review/split/command/reflog/notes/conflict with validated answers'
}finally{
    $env:ANTHROPIC_API_KEY=''
    if(Test-Path -LiteralPath $base){Get-ChildItem -LiteralPath $base -Recurse -Force|ForEach-Object{$_.Attributes='Normal'};Remove-Item -LiteralPath $base -Recurse -Force}
}
