$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$null,[ref]$null)
foreach($name in @('Invoke-GitCapture','Invoke-GitOrThrow')){
    $fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)[0]
    $definition=$fn.Extent.Text;if($name -eq 'Invoke-GitCapture'){$definition=$definition.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))}
    . ([scriptblock]::Create($definition))
}
. (Join-Path $root 'lib\GitDeck.MultiRepo.ps1')
. (Join-Path $root 'lib\GitDeck.Absorb.ps1')
function Assert-Registered($Path){}
function Run-Git([string]$Path,[string[]]$Arguments){$r=Invoke-GitCapture $Path $Arguments;if($r.Code -ne 0){throw "git $($Arguments -join ' '): $($r.Output)"};$r.Output}
function Write-Lines([string]$File,[string[]]$Lines){[IO.File]::WriteAllText($File,(($Lines -join "`n")+"`n"))}

$base=Join-Path $root ('output\absorb-test-'+[guid]::NewGuid().ToString('N'))
try{
    $remote=Join-Path $base 'remote.git';$repo=Join-Path $base 'repo'
    [void](New-Item -ItemType Directory -Force -Path $base)
    [void](Run-Git $base @('init','-q','--bare','-b','main',$remote));[void](Run-Git $base @('clone','-q',$remote,$repo))
    foreach($c in @(@('user.email','t@example.test'),@('user.name','T'),@('core.autocrlf','false'))){[void](Run-Git $repo @('config',$c[0],$c[1]))}
    $one=Join-Path $repo 'one.txt';$two=Join-Path $repo 'two.txt';$old=Join-Path $repo 'old.txt'
    Write-Lines $old @('o1','o2','o3');Write-Lines $one @('a1','a2','a3','a4','a5','a6','a7','a8');Write-Lines $two @('b1','b2','b3','b4','b5','b6','b7','b8')
    [void](Run-Git $repo @('add','.'));[void](Run-Git $repo @('commit','-qm','base'));[void](Run-Git $repo @('push','-q','-u','origin','main'))
    Write-Lines $one @('a1','A2','a3','a4','a5','a6','a7','a8');[void](Run-Git $repo @('commit','-qam','feat: one'))
    Write-Lines $two @('b1','b2','b3','b4','b5','b6','B7','b8');[void](Run-Git $repo @('commit','-qam','feat: two'))

    # Nothing staged / ready.
    if((Get-GitDeckAbsorbPlan $repo).ready){throw 'Plan ready without staged changes'}
    # Fixes to both commits, a change to a pushed line, and a new file.
    Write-Lines $one @('a1','A2-fixed','a3','a4','a5','a6','a7','a8');Write-Lines $two @('b1','b2','b3','b4','b5','b6','B7-fixed','b8');Write-Lines $old @('o1','O2','o3')
    [IO.File]::WriteAllText((Join-Path $repo 'new.txt'),"n`n")
    [void](Run-Git $repo @('add','-A'))
    $plan=Get-GitDeckAbsorbPlan $repo
    if(-not $plan.ready -or @($plan.targets).Count -ne 2){throw "Targets: $(@($plan.targets|ForEach-Object{$_.subject}) -join ',')"}
    if((@($plan.targets|ForEach-Object{$_.subject}) -join ',') -ne 'feat: two,feat: one'){throw 'Targets not newest first'}
    $reasons=@($plan.unassigned|ForEach-Object{"$($_.file):$($_.reason)"}|Sort-Object)
    if(($reasons -join ',') -ne 'new.txt:new file,old.txt:lines from a pushed commit'){throw "Unassigned: $($reasons -join ',')"}

    $result=Invoke-GitDeckAbsorb $repo $plan.fingerprint
    $log=@((Run-Git $repo @('log','--format=%s','origin/main..HEAD')) -split "`r?`n"|Where-Object{$_})
    if(($log -join ',') -ne 'feat: two,feat: one'){throw "Commits after absorb: $($log -join ',')"}
    if((Run-Git $repo @('show','HEAD~1:one.txt')) -notmatch 'A2-fixed'){throw 'Fix not in feat: one'}
    if((Run-Git $repo @('show','HEAD:two.txt')) -notmatch 'B7-fixed'){throw 'Fix not in feat: two'}
    if((Run-Git $repo @('show','HEAD:old.txt')) -cmatch 'O2'){throw 'Pushed-line change was absorbed'}
    $status=@((Run-Git $repo @('status','--porcelain')) -split "`r?`n"|Where-Object{$_})
    if(($status -join ',') -ne ' M old.txt,?? new.txt'){throw "Left over: $($status -join ',')"}
    if($result.message -notmatch 'Absorbed 2 change\(s\) into 2 commit\(s\)\. 2 change\(s\) stay'){throw "Message: $($result.message)"}
    # A changed index after the preview is refused.
    Write-Lines $one @('a1','A2-again','a3','a4','a5','a6','a7','a8');[void](Run-Git $repo @('add','one.txt'))
    $refused=$false;try{[void](Invoke-GitDeckAbsorb $repo 'stale')}catch{$refused=$true};if(-not $refused){throw 'Stale preview accepted'}
    Write-Host 'PASS: absorb (owners by blame, newest first, pushed lines and new files left, fixups squashed, stale preview refused)'
}finally{
    if(Test-Path -LiteralPath $base){Remove-Item -LiteralPath $base -Recurse -Force}
}
