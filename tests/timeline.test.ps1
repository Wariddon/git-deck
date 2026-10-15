$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$null,[ref]$null)
foreach($name in @('Invoke-GitCapture','Invoke-GitOrThrow','Get-GitSnapshot','Get-ActionJournalEntry')){
    $fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)[0]
    $definition=$fn.Extent.Text;if($name -eq 'Invoke-GitCapture'){$definition=$definition.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))}
    . ([scriptblock]::Create($definition))
}
. (Join-Path $root 'lib\GitDeck.Timeline.ps1')
function Assert-Registered($Path){}
$script:Journal=@();$script:Repos=@()
function Get-ActionJournal{ return @($script:Journal) }
function Get-Repositories{ return @($script:Repos) }
function Invoke-UndoLast($Path,$Id){ $script:UndoCalled=$Id; return @{message='undone'} }
function Run-Git([string]$Path,[string[]]$Arguments){$r=Invoke-GitCapture $Path $Arguments;if($r.Code -ne 0){throw "git $($Arguments -join ' '): $($r.Output)"};([string]$r.Output).Trim()}

$base=Join-Path $root ('output\timeline-test-'+[guid]::NewGuid().ToString('N'))
try{
    $repo=Join-Path $base 'repo';[void](New-Item -ItemType Directory -Force -Path $repo)
    [void](Run-Git $repo @('init','-q','-b','main'));[void](Run-Git $repo @('config','user.email','t@example.test'));[void](Run-Git $repo @('config','user.name','T'))
    [IO.File]::WriteAllText((Join-Path $repo 'a.txt'),"1`n");[void](Run-Git $repo @('add','.'));[void](Run-Git $repo @('commit','-qm','one'));$c1=Run-Git $repo @('rev-parse','HEAD')
    [IO.File]::WriteAllText((Join-Path $repo 'a.txt'),"2`n");[void](Run-Git $repo @('commit','-qam','two'));$c2=Run-Git $repo @('rev-parse','HEAD')
    [IO.File]::WriteAllText((Join-Path $repo 'a.txt'),"3`n");[void](Run-Git $repo @('commit','-qam','three'));$c3=Run-Git $repo @('rev-parse','HEAD')
    $script:Repos=@($repo)
    $e1=[pscustomobject]@{id=[guid]::NewGuid().ToString();path=$repo;repository='repo';action='commit';beforeHead=$c1;afterHead=$c2;beforeBranch='main';afterBranch='main';createdAt='2026-10-15 10:00:00';summary='two'}
    $e2=[pscustomobject]@{id=[guid]::NewGuid().ToString();path=$repo;repository='repo';action='commit';beforeHead=$c2;afterHead=$c3;beforeBranch='main';afterBranch='main';createdAt='2026-10-15 10:05:00';summary='three'}
    $gone=[pscustomobject]@{id=[guid]::NewGuid().ToString();path='C:\no\such';repository='such';action='pull';beforeHead=$c1;afterHead=$c2;beforeBranch='main';afterBranch='main';createdAt='2026-10-15 09:00:00';summary=''}
    $script:Journal=@($e2,$e1,$gone)
    $timeline=@(Get-GitDeckTimeline 200)
    if((@($timeline|ForEach-Object{$_.status}) -join ',') -ne 'latest,moved,missing'){throw "Statuses: $(@($timeline|ForEach-Object{$_.status}) -join ',')"}
    # Right after an exact undo the newest entry reads as already undone.
    [void](Run-Git $repo @('reset','-q','--soft',$c2))
    if(@(Get-GitDeckTimeline 200)[0].status -ne 'undone'){throw 'Undone entry not recognised'}
    [void](Run-Git $repo @('reset','-q','--soft',$c3))
    # The newest entry is undone exactly; an older one moves the branch back with a backup ref.
    [void](Invoke-GitDeckTimelineRestore $repo $e2.id);if($script:UndoCalled -ne $e2.id){throw 'Latest entry not undone exactly'}
    $result=Invoke-GitDeckTimelineRestore $repo $e1.id
    if((Run-Git $repo @('rev-parse','HEAD')) -ne $c1){throw 'Branch not moved back'}
    $backups=@((Run-Git $repo @('for-each-ref','--format=%(objectname)','refs/gitdeck/backup')) -split "`r?`n"|Where-Object{$_})
    if($backups.Count -ne 1 -or $backups[0] -ne $c3){throw 'Newer commits not kept in a backup ref'}
    # Local changes that would be lost are refused, and nothing is left behind.
    [void](Run-Git $repo @('reset','-q','--hard',$c3));[IO.File]::WriteAllText((Join-Path $repo 'a.txt'),"local`n")
    $refused=$false;try{[void](Invoke-GitDeckTimelineRestore $repo $e1.id)}catch{$refused=$true}
    if(-not $refused -or (Run-Git $repo @('rev-parse','HEAD')) -ne $c3){throw 'Going back over local changes was not refused'}
    if(@((Run-Git $repo @('for-each-ref','refs/gitdeck/backup')) -split "`r?`n"|Where-Object{$_}).Count -ne 1){throw 'Backup ref left behind after a refused restore'}
    Write-Host 'PASS: undo timeline (latest/moved/missing, exact undo, go back with backup ref, local changes protected)'
}finally{
    if(Test-Path -LiteralPath $base){Remove-Item -LiteralPath $base -Recurse -Force}
}
