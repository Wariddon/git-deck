$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Server parse failed'}
foreach($name in @('Invoke-GitCapture','Invoke-GitOrThrow','Get-GitOperationState','Get-GitDeckVisibleStatusLines','Test-GitDeckProtectedStatusLine','ConvertFrom-GitQuotedPath','Get-GitDeckStatusPath','Test-GitDeckProtectedPath')){
    $fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)[0]
    if(-not $fn){throw "Missing server function $name"}
    $definition=$fn.Extent.Text
    if($name -eq 'Invoke-GitCapture'){$definition=$definition.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))}
    . ([scriptblock]::Create($definition))
}
. (Join-Path $root 'lib\GitDeck.Pull.ps1')
. (Join-Path $root 'lib\GitDeck.Switch.ps1')
function Run-Git([string]$Path,[string[]]$Arguments){[void](Invoke-GitOrThrow $Path $Arguments)}
function Write-Text([string]$File,[string]$Text){$dir=Split-Path $File -Parent;if(-not (Test-Path $dir)){[void](New-Item -ItemType Directory -Path $dir)};[IO.File]::WriteAllText($File,$Text)}
function Read-Text([string]$File){[IO.File]::ReadAllText($File)}
function Current([string]$Path){(Invoke-GitOrThrow $Path @('branch','--show-current')).Trim()}
function Stashes([string]$Path){@((Invoke-GitOrThrow $Path @('stash','list')) -split "`r?`n" | Where-Object {$_}).Count}
function Hash([string]$Path,[string]$Ref){(Invoke-GitOrThrow $Path @('rev-parse',$Ref)).Trim()}

$base=Join-Path $root ('output\switch-test-'+[guid]::NewGuid().ToString('N'))
try{
    [void](New-Item -ItemType Directory -Path $base)
    $repo=Join-Path $base 'repo'
    Run-Git $base @('init','-q','-b','main',$repo)
    Run-Git $repo @('config','user.email','t@example.test');Run-Git $repo @('config','user.name','Test');Run-Git $repo @('config','core.autocrlf','false')
    Write-Text (Join-Path $repo 'shared.txt') "one`ntwo`nthree`nfour`nfive`nsix`nseven`n";Write-Text (Join-Path $repo 'other.txt') "other`n"
    Run-Git $repo @('add','.');Run-Git $repo @('commit','-q','-m','init')
    # target: changes line 1 and 2 of shared.txt and adds new.txt and output/report.txt
    Run-Git $repo @('switch','-q','-c','target')
    Write-Text (Join-Path $repo 'shared.txt') "ONE`nTWO`nthree`nfour`nfive`nsix`nseven`n";Write-Text (Join-Path $repo 'new.txt') "from target`n";Write-Text (Join-Path $repo 'output\report.txt') "report`n"
    Run-Git $repo @('add','.');Run-Git $repo @('commit','-q','-m','target work')
    Run-Git $repo @('switch','-q','main')
    $target=Hash $repo 'target'

    # 1. Unrelated change: carried along, like plain git / Sourcetree.
    Write-Text (Join-Path $repo 'other.txt') "other edited`n"
    $plan=Get-GitDeckSwitchPlan $repo $target
    if($plan.mode -ne 'carry' -or $plan.overlap.Count){throw "Unrelated change should be carried, got $($plan.mode)"}
    $result=Invoke-GitDeckSwitch $repo @('target') 'carry' 'target'
    if((Current $repo) -ne 'target' -or (Read-Text (Join-Path $repo 'other.txt')) -ne "other edited`n"){throw 'Carry did not switch or lost the change'}
    if($result.message -notmatch 'came along'){throw "Unexpected carry message: $($result.message)"}
    Run-Git $repo @('switch','-q','main')
    Run-Git $repo @('checkout','--','other.txt')

    # 2. No local changes: plain switch.
    if((Get-GitDeckSwitchPlan $repo $target).mode -ne 'clean'){throw 'Clean tree should plan clean'}

    # 3. Overlap that restores cleanly: edit line 7 (target changed lines 1-2).
    Write-Text (Join-Path $repo 'shared.txt') "one`ntwo`nthree`nfour`nfive`nsix`nseven local`n"
    $plan=Get-GitDeckSwitchPlan $repo $target
    if($plan.mode -ne 'stash' -or $plan.overlap -notcontains 'shared.txt'){throw 'Overlapping edit should need stash'}
    $refused=$false;try{Invoke-GitDeckSwitch $repo @('target') 'carry' 'target'|Out-Null}catch{$refused=$true}
    if(-not $refused -or (Current $repo) -ne 'main' -or (Read-Text (Join-Path $repo 'shared.txt')) -ne "one`ntwo`nthree`nfour`nfive`nsix`nseven local`n"){throw 'Carry over an overlap must be refused by git without changing anything'}
    $result=Invoke-GitDeckSwitch $repo @('target') 'stash' 'target'
    if((Current $repo) -ne 'target' -or $result.stashKept -or $result.conflicts.Count){throw 'Stash-switch-restore should succeed cleanly'}
    if((Read-Text (Join-Path $repo 'shared.txt')) -ne "ONE`nTWO`nthree`nfour`nfive`nsix`nseven local`n"){throw 'Local edit was not restored on top of the target'}
    if((Stashes $repo) -ne 0){throw 'Stash should be dropped after a clean restore'}
    Run-Git $repo @('checkout','--','shared.txt');Run-Git $repo @('switch','-q','main')

    # 4. Overlap that conflicts: edit line 2 too. Switch happens, conflict is reported, the stash is kept.
    Write-Text (Join-Path $repo 'shared.txt') "one`ntwo local`nthree`nfour`nfive`nsix`nseven`n"
    $result=Invoke-GitDeckSwitch $repo @('target') 'stash' 'target'
    if((Current $repo) -ne 'target' -or -not $result.stashKept -or $result.conflicts -notcontains 'shared.txt'){throw 'Conflicting restore must report the file and keep the stash'}
    if((Stashes $repo) -ne 1){throw 'The stash copy must be kept after a conflict'}
    Run-Git $repo @('checkout','-f','main');Run-Git $repo @('stash','drop','-q')

    # 5. Untracked file the target also has: git would refuse; stash mode switches and keeps the copy.
    Write-Text (Join-Path $repo 'new.txt') "mine`n"
    $plan=Get-GitDeckSwitchPlan $repo $target
    if($plan.mode -ne 'stash' -or $plan.blockingUntracked -notcontains 'new.txt'){throw 'Untracked file clashing with the target should need stash'}
    $result=Invoke-GitDeckSwitch $repo @('target') 'stash' 'target'
    if((Current $repo) -ne 'target' -or -not $result.stashKept){throw 'Untracked clash: switch must happen and the stash must be kept'}
    $kept=(Invoke-GitOrThrow $repo @('show','stash@{0}^3:new.txt'))
    if($kept.Trim() -ne 'mine'){throw 'The untracked file must be recoverable from the stash'}
    Run-Git $repo @('switch','-q','main');Run-Git $repo @('stash','drop','-q')

    # 6. Untracked folder with a file the target adds inside it.
    Write-Text (Join-Path $repo 'output\mine.txt') "local output`n"
    $plan=Get-GitDeckSwitchPlan $repo $target
    if($plan.mode -ne 'stash' -or $plan.blockingUntracked -notcontains 'output/'){throw 'Untracked folder clashing with target files should need stash'}
    Remove-Item -Recurse -Force (Join-Path $repo 'output')

    # 7. Without a mode, a dirty tree still refuses (old callers keep the old behaviour).
    Write-Text (Join-Path $repo 'other.txt') "dirty`n"
    $refused=$false;try{Invoke-GitDeckSwitch $repo @('target') '' 'target'|Out-Null}catch{$refused=$_.Exception.Message -match 'Commit or stash'}
    if(-not $refused -or (Current $repo) -ne 'main'){throw 'Dirty switch without a mode must be refused'}
    Run-Git $repo @('checkout','--','other.txt')

    # 8. An unfinished merge always blocks.
    Run-Git $repo @('switch','-q','-c','side');Write-Text (Join-Path $repo 'shared.txt') "one`nSIDE`nthree`nfour`nfive`nsix`nseven`n";Run-Git $repo @('commit','-qam','side')
    $merge=Invoke-GitCapture $repo @('merge','--no-edit','target');if($merge.Code -eq 0){throw 'Expected a merge conflict for the fixture'}
    $refused=$false;try{Invoke-GitDeckSwitch $repo @('main') 'stash' 'main'|Out-Null}catch{$refused=$_.Exception.Message -match 'in progress'}
    if(-not $refused){throw 'An unfinished merge must block switching'}
    Run-Git $repo @('merge','--abort')
    'PASS: switch carries unrelated changes, stash-switch-restore for overlaps, conflicts keep the stash, untracked clashes, merge in progress blocks'
} finally {
    if(Test-Path $base){Remove-Item -Recurse -Force $base -ErrorAction SilentlyContinue}
}
