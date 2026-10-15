$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$null,[ref]$null)
foreach($name in @('Invoke-GitCapture','Invoke-GitOrThrow')){
    $fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)[0]
    $definition=$fn.Extent.Text;if($name -eq 'Invoke-GitCapture'){$definition=$definition.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))}
    . ([scriptblock]::Create($definition))
}
. (Join-Path $root 'lib\GitDeck.MultiRepo.ps1')
. (Join-Path $root 'lib\GitDeck.Stack.ps1')
function Assert-Registered($Path){}
function Run-Git([string]$Path,[string[]]$Arguments){$r=Invoke-GitCapture $Path $Arguments;if($r.Code -ne 0){throw "git $($Arguments -join ' '): $($r.Output)"};([string]$r.Output).Trim()}
function Commit([string]$Repo,[string]$File,[string]$Text,[string]$Message){[IO.File]::WriteAllText((Join-Path $Repo $File),"$Text`n");[void](Run-Git $Repo @('add','.'));[void](Run-Git $Repo @('commit','-qm',$Message))}

$base=Join-Path $root ('output\stack-test-'+[guid]::NewGuid().ToString('N'))
try{
    $remote=Join-Path $base 'remote.git';$repo=Join-Path $base 'repo'
    [void](New-Item -ItemType Directory -Force -Path $base)
    [void](Run-Git $base @('init','-q','--bare','-b','main',$remote));[void](Run-Git $base @('clone','-q',$remote,$repo))
    foreach($c in @(@('user.email','t@example.test'),@('user.name','T'))){[void](Run-Git $repo @('config',$c[0],$c[1]))}
    Commit $repo 'base.txt' 'b' 'base';[void](Run-Git $repo @('push','-q','origin','main'))
    [void](Run-Git $repo @('switch','-qc','develop'));[void](Run-Git $repo @('push','-q','-u','origin','develop'))
    # Stack: develop -> PAY-1-api (2 commits) -> PAY-1-ui (1) -> PAY-1-docs (1); a side branch off api.
    [void](Run-Git $repo @('switch','-qc','feature/PAY-1-api'));Commit $repo 'api.txt' '1' 'api 1';Commit $repo 'api.txt' '2' 'api 2'
    [void](Run-Git $repo @('switch','-qc','feature/PAY-1-ui'));Commit $repo 'ui.txt' '1' 'ui'
    [void](Run-Git $repo @('switch','-qc','feature/PAY-1-docs'));Commit $repo 'docs.txt' '1' 'docs'
    [void](Run-Git $repo @('switch','-qc','side','feature/PAY-1-api'));Commit $repo 'side.txt' '1' 'side'
    [void](Run-Git $repo @('switch','-q','feature/PAY-1-ui'))

    $stack=Get-GitDeckBranchStack $repo ''
    $names=@($stack.branches|ForEach-Object{"$($_.name)<$($_.target):$($_.commits)"})
    if($stack.base -ne 'origin/develop' -or ($names -join ',') -ne 'feature/PAY-1-api<develop:2,feature/PAY-1-ui<feature/PAY-1-api:1,feature/PAY-1-docs<feature/PAY-1-ui:1'){throw "Stack: $($stack.base) $($names -join ',')"}
    if(-not @($stack.branches)[1].current){throw 'Current branch not marked'}

    # develop moves on; restack moves all three branches onto it and keeps the current branch checked out.
    [void](Run-Git $repo @('switch','-q','develop'));Commit $repo 'dev.txt' 'd' 'develop moved';[void](Run-Git $repo @('push','-q','origin','develop'))
    [void](Run-Git $repo @('switch','-q','feature/PAY-1-ui'))
    if((Get-GitDeckBranchStack $repo '').baseAhead -ne 1){throw 'Base ahead not reported'}
    $result=Invoke-GitDeckRestack $repo ''
    foreach($branch in @('feature/PAY-1-api','feature/PAY-1-ui','feature/PAY-1-docs')){if((Invoke-GitCapture $repo @('merge-base','--is-ancestor','origin/develop',$branch)).Code -ne 0){throw "$branch not on develop"}}
    if((Run-Git $repo @('branch','--show-current')) -ne 'feature/PAY-1-ui'){throw 'Current branch changed'}
    if((Run-Git $repo @('rev-list','--count','feature/PAY-1-api..feature/PAY-1-docs')) -ne '2'){throw 'Stack shape lost'}
    # Local changes block a restack.
    [IO.File]::WriteAllText((Join-Path $repo 'ui.txt'),"dirty`n")
    $refused=$false;try{[void](Invoke-GitDeckRestack $repo '')}catch{$refused=$true};if(-not $refused){throw 'Restack over local changes'}
    [void](Run-Git $repo @('checkout','--','ui.txt'))
    # Push the whole stack.
    [void](Invoke-GitDeckStackPush $repo '')
    if((Run-Git $repo @('ls-remote','--heads','origin','feature/PAY-1-docs')) -notmatch 'feature/PAY-1-docs'){throw 'Stack not pushed'}
    Write-Host 'PASS: stacked branches (chain and targets, side branch ignored, restack with --update-refs, push with lease)'
}finally{
    if(Test-Path -LiteralPath $base){Remove-Item -LiteralPath $base -Recurse -Force}
}
