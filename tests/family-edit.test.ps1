$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$null,[ref]$null)
foreach($name in @('Invoke-GitCapture','Invoke-GitOrThrow','Resolve-GitRef')){
    $fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)[0]
    $definition=$fn.Extent.Text;if($name -eq 'Invoke-GitCapture'){$definition=$definition.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))}
    . ([scriptblock]::Create($definition))
}
. (Join-Path $root 'lib\GitDeck.MultiRepo.ps1')
. (Join-Path $root 'lib/GitDeck.Fleet.ps1')
. (Join-Path $root 'lib\GitDeck.Agents.ps1')
$script:Registered=New-Object System.Collections.Generic.List[string]
function Assert-Registered($Path){}
function Add-Repository([string]$Path){ $full=[IO.Path]::GetFullPath($Path).TrimEnd('\'); if(-not $script:Registered.Contains($full)){$script:Registered.Add($full)}; return $full }
function Run-Git([string]$Path,[string[]]$Arguments){$r=Invoke-GitCapture $Path $Arguments;if($r.Code -ne 0){throw "git $($Arguments -join ' '): $($r.Output)"}}

$base=Join-Path $root ('output\family-edit-test-'+[guid]::NewGuid().ToString('N'))
try{
    $remote=Join-Path $base 'remote.git';$repo=Join-Path $base 'depinq-a'
    [void](New-Item -ItemType Directory -Force -Path $base)
    Run-Git $base @('init','-q','--bare','-b','main',$remote);Run-Git $base @('clone','-q',$remote,$repo)
    Run-Git $repo @('config','user.email','t@example.test');Run-Git $repo @('config','user.name','T');Run-Git $repo @('config','core.autocrlf','false')
    $docker="FROM maven:3 AS build`r`nFROM eclipse-temurin:17-scb-1.40`r`nCOPY a b`r`n"
    [IO.File]::WriteAllText((Join-Path $repo 'Dockerfile'),$docker);[IO.File]::WriteAllText((Join-Path $repo 'other.txt'),"x`n")
    Run-Git $repo @('add','.');Run-Git $repo @('commit','-qm','first');Run-Git $repo @('push','-q','-u','origin','main')
    Run-Git $repo @('switch','-qc','develop');Run-Git $repo @('push','-q','-u','origin','develop');Run-Git $repo @('switch','-q','main')
    [void](Add-Repository $repo)

    # Preview source: no worktree yet, so the file at origin/develop.
    $source=Get-GitDeckFamilyEditSource $repo 'PAY-20' 'Dockerfile' ''
    if($source.from -ne 'ref' -or $source.ref -ne 'origin/develop' -or -not $source.exists -or $source.content -notmatch '1\.40'){throw "Source: $($source|ConvertTo-Json -Compress)"}
    $after=$source.content.Replace('17-scb-1.40','17-scb-1.53')
    # Apply: worktree, CRLF kept, only that file committed, pushed.
    [IO.File]::WriteAllText((Join-Path $repo 'other.txt'),"dirty`n")
    $done=Invoke-GitDeckFamilyEdit $repo 'PAY-20' 'Dockerfile' $source.content $after 'PAY-20 bump base image' $true ''
    $worktree=Join-Path $base 'depinq-a.worktrees\PAY-20'
    if($done.path -ne $worktree -or $done.branch -ne 'feature/PAY-20' -or -not $done.commit){throw "Done: $($done|ConvertTo-Json -Compress)"}
    if([IO.File]::ReadAllText((Join-Path $worktree 'Dockerfile')) -ne $docker.Replace('1.40','1.53')){throw 'Line endings or content not kept'}
    $shown=[string](Invoke-GitCapture $repo @('show','--stat','--format=%s','origin/feature/PAY-20')).Output
    if($shown -notmatch 'PAY-20 bump base image' -or $shown -notmatch 'Dockerfile' -or $shown -match 'other.txt'){throw "Pushed commit: $shown"}
    if([IO.File]::ReadAllText((Join-Path $repo 'Dockerfile')) -ne $docker){throw 'Main folder was changed'}
    # Next preview reads the worktree; a stale preview is refused; no change is refused.
    $again=Get-GitDeckFamilyEditSource $repo 'PAY-20' 'Dockerfile' ''
    if($again.from -ne 'worktree' -or $again.content -notmatch '1\.53'){throw 'Source after apply'}
    $refused=$false;try{[void](Invoke-GitDeckFamilyEdit $repo 'PAY-20' 'Dockerfile' $source.content $after '' $false '')}catch{$refused=$_.Exception.Message -match 'changed since the preview'};if(-not $refused){throw 'Stale preview accepted'}
    $refused=$false;try{[void](Invoke-GitDeckFamilyEdit $repo 'PAY-20' 'Dockerfile' $after $after '' $false '')}catch{$refused=$true};if(-not $refused){throw 'Empty change accepted'}
    $refused=$false;try{[void](Get-GitDeckFamilyEditSource $repo 'PAY-20' '../x' '')}catch{$refused=$true};if(-not $refused){throw 'Path outside accepted'}
    Write-Host 'PASS: family edit (source from origin/develop then the worktree, write with line endings kept, commit one file, push, stale preview refused)'
}finally{
    if(Test-Path -LiteralPath $base){Remove-Item -LiteralPath $base -Recurse -Force}
}
