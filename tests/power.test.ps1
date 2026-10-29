$ErrorActionPreference='Stop'
# Power tools on real repositories: save point round trip (branch, commit and uncommitted changes),
# sibling patch check and apply, recent journal across repositories.
$root=Split-Path $PSScriptRoot -Parent
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$null,[ref]$null)
foreach($name in @('Invoke-GitCapture','Invoke-GitOrThrow','Assert-CommitHash','Get-GitOperationState','Get-GitSnapshot','Get-ActionJournal')){
    $fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)[0]
    if(-not $fn){throw "Missing $name"}
    $text=$fn.Extent.Text;if($name -eq 'Invoke-GitCapture'){$text=$text.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))}
    . ([scriptblock]::Create($text))
}
. (Join-Path $root 'lib\GitDeck.Activity.ps1')
. (Join-Path $root 'lib\GitDeck.MultiRepo.ps1')
. (Join-Path $root 'lib\GitDeck.Power.ps1')
function Assert-Registered($Path){}
function Run-Git([string]$Path,[string[]]$Arguments){$r=Invoke-GitCapture $Path $Arguments;if($r.Code -ne 0){throw "git $($Arguments -join ' '): $($r.Output)"}}
$base=Join-Path $root ('output\power-test-'+[guid]::NewGuid().ToString('N'))
try{
    $repo=Join-Path $base 'src-svc-x';[void](New-Item -ItemType Directory -Force -Path $repo);Run-Git $repo @('init','-q','-b','main')
    Run-Git $repo @('config','user.email','t@example.test');Run-Git $repo @('config','user.name','Tee')
    [IO.File]::WriteAllText((Join-Path $repo 'Client.java'),"class Client {`n  String method = `"GET`";`n  String path = `"/v2/proxy`";`n}`n");Run-Git $repo @('add','.');Run-Git $repo @('commit','-q','-m','base')
    $sibling=Join-Path $base 'txi-svc-x';Run-Git $base @('clone','-q',$repo,$sibling)

    # Save point: on main with a local edit; then move away and come back.
    [IO.File]::WriteAllText((Join-Path $repo 'Client.java'),"class Client {`n  String method = `"GET`";`n  String path = `"/v2/proxy`"; // wip`n}`n")
    $point=New-GitDeckSavePoint $repo 'sp-test-1'
    if($point.branch -ne 'main' -or -not $point.stash -or -not $point.head){throw "Save point: $($point|ConvertTo-Json -Compress)"}
    $kept=(Invoke-GitCapture $repo @('rev-parse','refs/gitdeck/savepoints/sp-test-1')).Output.Trim()
    if($kept -ne $point.stash){throw 'Save point ref does not keep the stash commit'}
    if(-not ([IO.File]::ReadAllText((Join-Path $repo 'Client.java'))).Contains('// wip')){throw 'Creating a save point touched the working tree'}
    Run-Git $repo @('checkout','-q','--','.');Run-Git $repo @('switch','-q','-c','feature/other')
    [IO.File]::WriteAllText((Join-Path $repo 'Other.txt'),'x');Run-Git $repo @('add','.');Run-Git $repo @('commit','-q','-m','other')
    $loaded=Restore-GitDeckSavePoint $repo 'sp-test-1' $point.head $point.branch $point.stash
    $now=Get-GitSnapshot $repo
    if($now.branch -ne 'main' -or $now.head -ne $point.head){throw "Load did not return to main: $($now|ConvertTo-Json -Compress)"}
    if(-not ([IO.File]::ReadAllText((Join-Path $repo 'Client.java'))).Contains('// wip')){throw 'Load did not bring the uncommitted change back'}
    if(-not $loaded.message.Contains('saved changes')){throw "Message: $($loaded.message)"}
    [void](Remove-GitDeckSavePoint $repo 'sp-test-1')
    if((Invoke-GitCapture $repo @('rev-parse','--verify','--quiet','refs/gitdeck/savepoints/sp-test-1')).Code -eq 0){throw 'Save point ref not removed'}
    $failed=$false;try{[void](New-GitDeckSavePoint $repo 'bad id;rm')}catch{$failed=$true};if(-not $failed){throw 'Unsafe save point id accepted'}
    Run-Git $repo @('checkout','-q','--','.')

    # Sibling patch: GET v2 -> POST v1 in src, copied to txi.
    [IO.File]::WriteAllText((Join-Path $repo 'Client.java'),"class Client {`n  String method = `"POST`";`n  String path = `"/v1/proxy`";`n}`n");Run-Git $repo @('commit','-q','-am','AP-1 findByProxy POST v1')
    $head=(Invoke-GitCapture $repo @('rev-parse','HEAD')).Output.Trim()
    $patch=Get-GitDeckCommitPatch $repo $head
    if($patch.subject -ne 'AP-1 findByProxy POST v1' -or @($patch.files) -notcontains 'Client.java' -or -not $patch.patch.StartsWith('diff --git ')){throw "Patch: $($patch|ConvertTo-Json -Compress)"}
    $check=Test-GitDeckPatch $sibling $patch.patch
    if(-not $check.ok -or $check.mode -ne 'clean'){throw "Check: $($check|ConvertTo-Json -Compress)"}
    [void](Invoke-GitDeckSiblingPatch $sibling $patch.patch $false)
    $text=[IO.File]::ReadAllText((Join-Path $sibling 'Client.java'))
    if(-not $text.Contains('"/v1/proxy"')){throw 'Sibling patch not applied'}
    if((Invoke-GitCapture $sibling @('log','-1','--format=%s')).Output.Trim() -ne 'base'){throw 'Sibling patch committed something'}
    $again=Test-GitDeckPatch $sibling $patch.patch
    if($again.ok){throw 'An already applied change still reported as fitting'}

    # A merge commit copies what it brought into the main line.
    Run-Git $repo @('switch','-q','-c','feature/merge-me');[IO.File]::WriteAllText((Join-Path $repo 'Merged.txt'),"m`n");Run-Git $repo @('add','.');Run-Git $repo @('commit','-q','-m','merged file')
    Run-Git $repo @('switch','-q','main');Run-Git $repo @('merge','-q','--no-ff','-m','Merge feature','feature/merge-me')
    $merge=Get-GitDeckCommitPatch $repo ((Invoke-GitCapture $repo @('rev-parse','HEAD')).Output.Trim())
    if(@($merge.files) -notcontains 'Merged.txt' -or -not $merge.patch.StartsWith('diff --git ')){throw "Merge patch: $($merge|ConvertTo-Json -Compress)"}

    # Recent journal: entries from the window only.
    $script:ActionJournal=Join-Path $base 'journal.json'
    $fresh=[ordered]@{id=[guid]::NewGuid().ToString();path=$repo;repository='src-svc-x';action='pull';beforeHead='a';afterHead='b';beforeBranch='main';afterBranch='main';createdAt=(Get-Date).ToUniversalTime().ToString('o')}
    $old=[ordered]@{id=[guid]::NewGuid().ToString();path=$repo;repository='src-svc-x';action='merge';beforeHead='c';afterHead='d';beforeBranch='main';afterBranch='main';createdAt=(Get-Date).ToUniversalTime().AddHours(-3).ToString('o')}
    [IO.File]::WriteAllText($script:ActionJournal,(@($fresh,$old)|ConvertTo-Json -Compress))
    $recent=@(Get-GitDeckRecentJournal 30)
    if($recent.Count -ne 1 -or $recent[0].action -ne 'pull'){throw "Journal: $($recent|ConvertTo-Json -Compress)"}
    if(@(Get-GitDeckRecentJournal 1440).Count -ne 2){throw 'Journal day window'}

    # Branch cleanup now carries the commit, so a buried branch can be revived.
    Run-Git $repo @('branch','-q','old-work','HEAD~1')
    $cleanup=Get-GitDeckBranchCleanup $repo
    $old=@($cleanup.branches|Where-Object{$_.name -eq 'old-work'})[0]
    if(-not $old -or $old.hash -notmatch '^[0-9a-f]{40}$'){throw "Cleanup hash: $($old|ConvertTo-Json -Compress)"}
    Write-Output 'PASS: power tools (save point round trip, sibling patch, recent journal, branch hash)'
}finally{Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue}
