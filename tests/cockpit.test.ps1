$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
. (Join-Path $root 'lib/GitDeck.Cockpit.ps1')
. (Join-Path $root 'lib/GitDeck.Fleet.ps1')
. (Join-Path $root 'lib/GitDeck.Integrations.ps1')
$base=Join-Path $root ('output/cockpit-test-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $base)
$script:CockpitFile=Join-Path $base 'tasks.json'
$repo=Join-Path $base 'billing';[void](New-Item -ItemType Directory -Path $repo)
$script:FixtureRepo=$repo
function Assert-Registered($Path){if($Path -ne $script:FixtureRepo){throw 'Not registered'}}
function Invoke-GitCapture([string]$Path,[string[]]$Arguments){$ErrorActionPreference='Continue';$output=& git -c core.quotepath=false -C $Path @Arguments 2>&1|Out-String;return @{Code=$LASTEXITCODE;Output=$output.TrimEnd()}}
function Get-GitOperationState($Path){return @{active=$false}}
function Throws([scriptblock]$Code){$caught=$false;try{& $Code|Out-Null}catch{$caught=$true};if(-not $caught){throw 'Expected rejection'}}
function Get-GitDeckLines($Result){if($Result.Code -ne 0){return @()};return @($Result.Output -split "`r?`n"|Where-Object {$_})}
function Convert-LogLines($Text){return @($Text -split "`r?`n"|Where-Object {$_}|ForEach-Object {$f=$_ -split [char]31;@{hash=$f[0];fullHash=$f[1];date=$f[2];author=$f[3];subject=$f[4];refs=$f[5]}})}
$utf8=New-Object Text.UTF8Encoding($false)
try {
    $init=Invoke-GitCapture $repo @('init','-q','-b','main');if($init.Code){throw 'Init failed'}
    [void](Invoke-GitCapture $repo @('config','user.name','Fixture User'));[void](Invoke-GitCapture $repo @('config','user.email','fixture@example.test'))
    [IO.File]::WriteAllText((Join-Path $repo 'README.md'),"# Fixture`n",$utf8)
    [void](Invoke-GitCapture $repo @('add','.'));[void](Invoke-GitCapture $repo @('commit','-qm','PAY-123 initial fixture'))
    [void](Invoke-GitCapture $repo @('branch','feature/PAY-123'));[void](Invoke-GitCapture $repo @('branch','feature/PAY-1234'))
    $ticket=Get-GitDeckTicket $repo 'PAY-123'
    if($ticket.branches.Count -ne 1 -or $ticket.branches[0].name -ne 'feature/PAY-123' -or $ticket.branches[0].sha.Length -ne 40){throw 'Ticket boundary or branch SHA failed'}
    $snap=Get-GitDeckTaskSnapshot $repo
    if($snap.branch -ne 'main' -or $snap.changed -ne 0 -or $snap.head.Length -ne 40){throw 'Snapshot failed'}
    $body=@{key='PAY-123';next='review';paths=@($repo);views=@(@{path=$repo;tab='history';commit=$snap.head;file='README.md';scroll=42})}
    $saved=Save-GitDeckTaskCapsule $body
    if($saved.capsule.repos[0].head -ne $snap.head -or @(Get-GitDeckTaskStore).capsules[0].views[0].scroll -ne 42){throw 'Capsule state lost'}
    $bad=$body.Clone();$bad.views=@(@{path=$repo;tab='history';file='../secret'});Throws {Save-GitDeckTaskCapsule $bad}
    $bad=$body.Clone();$bad.key='PAY-123 token=x';Throws {Save-GitDeckTaskCapsule $bad}
    Throws {Save-GitDeckTaskCapsule @{key='PAY-123';next='deploy';paths=@($repo)}}
    Throws {Save-GitDeckTaskCapsule @{key='PAY-123';next='review';paths=@('C:/not-registered')}}
    Throws {Remove-GitDeckTaskCapsule @{id=$saved.capsule.id;expectedUpdatedAt='old'}}
    [void](Remove-GitDeckTaskCapsule @{id=$saved.capsule.id;expectedUpdatedAt=$saved.capsule.updatedAt})
    if(@((Get-GitDeckTaskStore).capsules).Count){throw 'Capsule remove failed'}
    $plan=(New-GitDeckFleetRecipe @{recipe='review-changes';paths=@($repo)}).plan
    Throws {Invoke-GitDeckFleetRecipe @{id=$plan.id;approved=$false;expectedUpdatedAt=$plan.updatedAt}}
    $run=(Invoke-GitDeckFleetRecipe @{id=$plan.id;approved=$true;expectedUpdatedAt=$plan.updatedAt}).plan
    if($run.state -ne 'completed'){throw ('Read-only recipe failed: '+($run|ConvertTo-Json -Depth 8))}
    $headAfter=Get-GitDeckTaskSnapshot $repo;if($headAfter.head -ne $snap.head -or $headAfter.changed){throw 'Recipe mutated repository'}
    Throws {Invoke-GitDeckFleetRecipe @{id=$plan.id;approved=$true;expectedUpdatedAt=$plan.updatedAt}}
    [IO.File]::WriteAllText((Join-Path $repo 'README.md'),"# Changed`n",$utf8)
    $plan=(New-GitDeckFleetRecipe @{recipe='review-changes';paths=@($repo)}).plan
    [IO.File]::WriteAllText((Join-Path $repo 'README.md'),"# Changed again`n",$utf8)
    $run=(Invoke-GitDeckFleetRecipe @{id=$plan.id;approved=$true;expectedUpdatedAt=$plan.updatedAt}).plan
    if($run.state -ne 'blocked' -or $run.repos[0].steps[0].state -ne 'pending'){throw 'Changed tracked contents bypassed preview'}
    Throws {New-GitDeckFleetRecipe @{recipe='execute-shell';paths=@($repo)}}
    # Provider fixtures exercise the actual Failure Lens transformation, not live GitLab.
    function Get-GitDeckCiStatus($Path,$Ref){return @{id=12;ref='main';sha=$snap.head;status='failed'}}
    function Get-OriginUrl($Path){return 'https://gitlab.example.test/team/billing.git'}
    function ConvertTo-WebUrl($Value){return $Value}
    function Get-GitLabProjectApi($Value){return @{encoded='team%2Fbilling';host='gitlab.example.test'}}
    function Invoke-GlabCapture($Arguments){return @{Code=0;Output='[{"name":"test","stage":"verify","status":"failed","failure_reason":"script_failure","web_url":"https://gitlab.example.test/jobs/12"},{"name":"build","status":"success"}]'}}
    $failure=Get-GitDeckFailureLens $repo 'main'
    if(-not $failure.matchesLocalRef -or $failure.jobs.Count -ne 1 -or $failure.jobs[0].reason -ne 'script_failure'){throw ('Failure Lens source or failed-job filtering failed: '+($failure|ConvertTo-Json -Depth 6))}
    function Get-GitDeckCiStatus($Path,$Ref){return @{ref='main';sha='';status='none'}}
    $failure=Get-GitDeckFailureLens $repo 'main'
    if($failure.matchesLocalRef -or $failure.jobs.Count){throw 'Missing pipeline was treated as matched'}
    function Invoke-GlabCapture($Arguments){return @{Code=0;Output='[{"iid":42,"title":"PAY-123 A","source_branch":"feature/PAY-123","target_branch":"main","user_notes_count":0},{"iid":43,"title":"PAY-123 B","source_branch":"feature/PAY-123-web","target_branch":"main","user_notes_count":0}]'}}
    $mrs=@(Get-GitDeckMergeRequests $repo)
    if($mrs.Count -ne 2 -or $mrs[0].iid -ne 42 -or $mrs[1].source -ne 'feature/PAY-123-web'){throw 'GitLab JSON array flattened incorrectly'}
    $before=[IO.File]::ReadAllText($script:CockpitFile)
    if($before -match 'Changed again'){throw 'Raw file contents persisted'}
    [IO.File]::WriteAllText($script:CockpitFile,'broken',$utf8)
    Throws {Save-GitDeckTaskCapsule $body}
    if([IO.File]::ReadAllText($script:CockpitFile) -ne 'broken'){throw 'Corrupt task data overwritten'}
    Write-Host 'PASS: actual Git ticket boundaries, snapshots, capsule validation, optimistic removal, approval, immutable recipe basis and corrupt-store preservation'
} finally {
    $resolved=[IO.Path]::GetFullPath($base);$allowed=[IO.Path]::GetFullPath((Join-Path $root 'output'))+'\'
    if(-not $resolved.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe fixture cleanup'}
    if(Test-Path -LiteralPath $resolved){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
