$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Server parse failed'}
foreach($name in @('Invoke-GitCapture','Invoke-GitOrThrow','Get-GitOperationState','Assert-BranchName','Convert-LogLines','Search-HistoryContent')){
    $fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)[0]
    if(-not $fn){throw "Missing server function $name"}
    $definition=$fn.Extent.Text
    if($name -eq 'Invoke-GitCapture'){$definition=$definition.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))}
    . ([scriptblock]::Create($definition))
}
. (Join-Path $root 'lib\GitDeck.Activity.ps1')
. (Join-Path $root 'lib\GitDeck.MultiRepo.ps1')
function Assert-Registered($Path){}
function Run-Git([string]$Path,[string[]]$Arguments){[void](Invoke-GitOrThrow $Path $Arguments)}
function Write-Text([string]$File,[string]$Text){[IO.File]::WriteAllText($File,$Text)}

$base=Join-Path $root ('output\multi-test-'+[guid]::NewGuid().ToString('N'))
try{
    [void](New-Item -ItemType Directory -Path $base)
    $remote=Join-Path $base 'remote.git';$local=Join-Path $base 'local'
    Run-Git $base @('init','-q','--bare','-b','main',$remote)
    Run-Git $base @('clone','-q','-c','core.autocrlf=false',$remote,$local)
    Run-Git $local @('config','user.email','t@example.test');Run-Git $local @('config','user.name','Test')
    Write-Text (Join-Path $local 'a.txt') "one`n";Run-Git $local @('add','.');Run-Git $local @('commit','-qm','AP-1 first')
    Run-Git $local @('push','-q','-u','origin','main')
    # A merged branch, an unpushed branch, a pushed-and-merged remote branch, a stash and a dirty file.
    Run-Git $local @('branch','done-work')
    Run-Git $local @('switch','-qc','feature/AP-2');Write-Text (Join-Path $local 'b.txt') "two`n";Run-Git $local @('add','.');Run-Git $local @('commit','-qm','AP-2 login')
    Run-Git $local @('switch','-q','main')
    Run-Git $local @('push','-q','origin','main:old-remote')
    Write-Text (Join-Path $local 'a.txt') "one`nstash`n";Run-Git $local @('stash','push','-q','-m','wip')
    Write-Text (Join-Path $local 'a.txt') "changed`n";Write-Text (Join-Path $local 'new.txt') "n`n"
    Run-Git $local @('fetch','-q')

    $p=Get-GitDeckPendingWork $local
    if($p.branch -ne 'main' -or $p.changed -ne 1 -or $p.untracked -ne 1){throw "Pending files wrong: $($p.changed)/$($p.untracked)"}
    if(@($p.unpushedBranches).Count -ne 1 -or $p.unpushedBranches[0].branch -ne 'feature/AP-2' -or $p.unpushedBranches[0].commits -ne 1){throw 'Unpushed branch not found'}
    if(@($p.stashes).Count -ne 1 -or $p.stashes[0].message -notmatch 'wip'){throw 'Stash not listed'}
    if((@($p.mergedBranches) -join ',') -ne 'done-work'){throw "Merged branches wrong: $(@($p.mergedBranches) -join ',')"}
    if($p.mainline -ne 'origin/main'){throw "Mainline wrong: $($p.mainline)"}
    if($p.latestTag -ne '' -or $p.tagCount -ne 0){throw 'No tags expected yet'}
    Run-Git $local @('tag','-a','v1.0.0','-m','first release','HEAD~0')
    Run-Git $local @('commit','-q','--allow-empty','-m','after tag')
    $t=Get-GitDeckPendingWork $local
    if($t.latestTag -ne 'v1.0.0' -or $t.commitsSinceTag -ne 1 -or $t.tagCount -ne 1 -or -not $t.latestTagDate){throw "Latest tag wrong: $($t.latestTag) / $($t.commitsSinceTag) / $($t.latestTagDate)"}

    $tidy=Join-Path $base 'tidy';Run-Git $base @('clone','-q','-c','core.autocrlf=false',$remote,$tidy)
    $q=Get-GitDeckPendingWork $tidy
    if($q.branch -ne 'main' -or $q.changed -ne 0 -or $q.untracked -ne 0 -or $q.upstream -ne 'origin/main'){throw "Clean repository misread: $($q | ConvertTo-Json -Compress)"}
    $c=Get-GitDeckBranchCleanup $local
    $byName=@{};foreach($b in $c.branches){$byName[$b.name]=$b}
    if(-not $byName['done-work'].merged -or $byName['done-work'].protected){throw 'done-work should be merged and deletable'}
    if($byName['feature/AP-2'].merged){throw 'feature/AP-2 is not merged'}
    if(-not $byName['main'].protected -or -not $byName['origin/main'].protected){throw 'main must be protected'}
    if(-not $byName['origin/old-remote'].remote -or -not $byName['origin/old-remote'].merged){throw 'Merged remote branch missing'}

    $s=Search-GitDeckRepository $local 'ap-2' 'message'
    if(@($s.commits).Count -ne 1 -or @($s.commits)[0].subject -ne 'AP-2 login'){throw "Message search failed: $(@($s.commits).Count) $($s.commits | ConvertTo-Json -Compress)"}
    if((@($s.branches) -join ',') -ne 'feature/AP-2'){throw "Branch search failed: $(@($s.branches) -join ',')"}
    $blocked=$false;try{[void](Search-GitDeckRepository $local '--output=x' 'message')}catch{$blocked=$true};if(-not $blocked){throw 'Option-like search accepted'}

    $f=Find-GitDeckBranch $local 'old-remote'
    if($f.local -or $f.remote -ne 'origin/old-remote' -or -not $f.dirty){throw 'Find branch (remote only) wrong'}
    $f=Find-GitDeckBranch $local 'feature/AP-2'
    if(-not $f.local -or $f.remote){throw 'Find branch (local only) wrong'}
}finally{Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue}
'PASS: multi-repository pending work, branch cleanup, search and branch lookup'
