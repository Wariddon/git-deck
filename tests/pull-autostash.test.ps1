$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Server parse failed'}
foreach($name in @('Invoke-GitCapture','Invoke-GitOrThrow','Get-GitOperationState','Get-GitDeckVisibleStatusLines','Test-GitDeckProtectedStatusLine','ConvertFrom-GitQuotedPath','Get-GitDeckStatusPath','Test-GitDeckProtectedPath','Assert-RemoteName','Assert-BranchName')){
    $fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)[0]
    if(-not $fn){throw "Missing server function $name"}
    $definition=$fn.Extent.Text
    if($name -eq 'Invoke-GitCapture'){$definition=$definition.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))}
    . ([scriptblock]::Create($definition))
}
. (Join-Path $root 'lib\GitDeck.Pull.ps1')
function Assert-Registered($Path){}
function Run-Git([string]$Path,[string[]]$Arguments){[void](Invoke-GitOrThrow $Path $Arguments)}
function Write-Text([string]$File,[string]$Text){[IO.File]::WriteAllText($File,$Text)}

$base=Join-Path $root ('output\pull-test-'+[guid]::NewGuid().ToString('N'))
try{
    [void](New-Item -ItemType Directory -Path $base)
    $remote=Join-Path $base 'remote.git';$up=Join-Path $base 'up';$local=Join-Path $base 'local'
    Run-Git $base @('init','-q','--bare','-b','main',$remote)
    # autocrlf must be off at clone time, or the checkout itself looks modified.
    Run-Git $base @('clone','-q','-c','core.autocrlf=false',$remote,$up)
    Run-Git $up @('config','user.email','t@example.test');Run-Git $up @('config','user.name','Test')
    Write-Text (Join-Path $up 'shared.txt') "one`ntwo`nthree`n";Write-Text (Join-Path $up 'other.txt') "other`n"
    Run-Git $up @('add','.');Run-Git $up @('commit','-q','-m','init');Run-Git $up @('push','-q','origin','main')
    Run-Git $base @('clone','-q','-c','core.autocrlf=false',$remote,$local)
    Run-Git $local @('config','user.email','t@example.test');Run-Git $local @('config','user.name','Test')
    $start=(Invoke-GitOrThrow $local @('rev-parse','HEAD')).Trim()
    Write-Text (Join-Path $up 'shared.txt') "one`nUPSTREAM`nthree`n";Write-Text (Join-Path $up 'incoming.txt') "new`n"
    Run-Git $up @('add','.');Run-Git $up @('commit','-q','-m','upstream');Run-Git $up @('push','-q','origin','main')
    Run-Git $local @('fetch','-q')
    function Reset-Local{Run-Git $local @('reset','-q','--hard',$start);Run-Git $local @('clean','-qfd');Run-Git $local @('stash','clear')}

    # Clean tree: pulls without autostash.
    $result=Invoke-GitDeckPull $local 'ff-only' $false
    if($result.stashKept -or $result.message -notmatch 'Pulled the upstream branch using ff-only\.$'){throw "Clean pull: $($result.message)"}
    Reset-Local

    # Preview reports overlap, untracked blockers and non-overlapping edits.
    Write-Text (Join-Path $local 'shared.txt') "one`nLOCAL`nthree`n";Write-Text (Join-Path $local 'other.txt') "mine`n";Write-Text (Join-Path $local 'incoming.txt') "untracked`n"
    $preview=Get-GitDeckPullPreview $local
    if($preview.target -ne 'origin/main' -or -not $preview.knownTarget -or $preview.behind -ne 1 -or $preview.incomingCount -ne 2){throw "Preview target/counts wrong: $($preview|ConvertTo-Json -Compress)"}
    if(@($preview.overlap) -join ',' -ne 'shared.txt'){throw "Overlap wrong: $(@($preview.overlap) -join ',')"}
    if(@($preview.blockingUntracked) -join ',' -ne 'incoming.txt'){throw 'Untracked blocker missing'}
    if(@($preview.dirty).Count -ne 3){throw 'Dirty list wrong'}
    $refPreview=Get-GitDeckPullPreview $local 'origin' 'main'
    if($refPreview.target -ne 'origin/main' -or $refPreview.behind -ne 1){throw 'Explicit remote/branch preview wrong'}

    # Dirty tree without consent is refused and leaves HEAD alone.
    $refused=$false;try{Invoke-GitDeckPull $local 'ff-only' $false|Out-Null}catch{$refused=$_.Exception.Message -match 'stash and restore'}
    if(-not $refused -or (Invoke-GitOrThrow $local @('rev-parse','HEAD')).Trim() -ne $start){throw 'Dirty pull without autostash must be refused'}

    # Untracked file in the way: git refuses, local work stays intact.
    $failed=$false;try{Invoke-GitDeckPull $local 'ff-only' $true|Out-Null}catch{$failed=$true}
    if(-not $failed -or [IO.File]::ReadAllText((Join-Path $local 'shared.txt')) -notmatch 'LOCAL'){throw 'Untracked collision must fail without losing changes'}
    if((Invoke-GitOrThrow $local @('rev-parse','HEAD')).Trim() -ne $start){throw 'Failed pull moved HEAD'}
    Remove-Item -LiteralPath (Join-Path $local 'incoming.txt')
    Run-Git $local @('stash','clear')

    # Non-overlapping local edit is stashed and restored.
    Run-Git $local @('checkout','-q','--','shared.txt')
    foreach($strategy in @('ff-only','merge','rebase')){
        Write-Text (Join-Path $local 'other.txt') "mine`n"
        $result=Invoke-GitDeckPull $local $strategy $true
        if($result.stashKept -or @($result.conflicts).Count -or $result.message -notmatch 'stashed and restored'){throw "$strategy clean autostash: $($result.message)"}
        if([IO.File]::ReadAllText((Join-Path $local 'other.txt')) -ne "mine`n"){throw "$strategy lost the local edit"}
        if((Invoke-GitOrThrow $local @('stash','list'))){throw "$strategy left a stash behind"}
        Reset-Local
    }

    # Overlapping edit: pull lands, conflicts are reported and the stash is kept.
    Write-Text (Join-Path $local 'shared.txt') "one`nLOCAL`nthree`n"
    $result=Invoke-GitDeckPull $local 'ff-only' $true
    if(-not $result.stashKept -or @($result.conflicts) -join ',' -ne 'shared.txt' -or $result.message -notmatch 'conflicted in 1 file'){throw "Conflict result wrong: $($result.message)"}
    if((Invoke-GitOrThrow $local @('rev-parse','HEAD')).Trim() -eq $start){throw 'Pull did not land'}
    if((Invoke-GitOrThrow $local @('stash','list')) -notmatch 'autostash'){throw 'Autostash entry must be kept'}

    # Last fetch time comes from FETCH_HEAD; a repository that never fetched has none.
    $fetchedAt=Get-GitDeckLastFetchAt $local
    if(-not $fetchedAt -or ([datetime]::UtcNow-[datetime]::Parse($fetchedAt).ToUniversalTime()).TotalMinutes -gt 10){throw "Unexpected last fetch time '$fetchedAt'"}
    $fresh=Join-Path $base 'fresh';Run-Git $base @('init','-q',$fresh)
    if($null -ne (Get-GitDeckLastFetchAt $fresh)){throw 'A repository that never fetched must report no fetch time'}

    # Invalid input.
    $bad=$false;try{Invoke-GitDeckPull $local 'octopus' $true|Out-Null}catch{$bad=$_.Exception.Message -match 'Invalid pull strategy'};if(-not $bad){throw 'Strategy must be validated'}
    'PASS: pull preview overlap/blockers, consent gate, autostash restore for ff-only/merge/rebase, conflict keeps stash'
}finally{
    if(Test-Path -LiteralPath $base){Get-ChildItem -LiteralPath $base -Recurse -Force|ForEach-Object{$_.Attributes='Normal'};Remove-Item -LiteralPath $base -Recurse -Force}
}
