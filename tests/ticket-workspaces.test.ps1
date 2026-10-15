$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$null,[ref]$null)
foreach($name in @('Invoke-GitCapture','Invoke-GitOrThrow','Resolve-GitRef')){
    $fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)[0]
    $definition=$fn.Extent.Text;if($name -eq 'Invoke-GitCapture'){$definition=$definition.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))}
    . ([scriptblock]::Create($definition))
}
. (Join-Path $root 'lib\GitDeck.MultiRepo.ps1')
. (Join-Path $root 'lib\GitDeck.Agents.ps1')
$script:Registered=New-Object System.Collections.Generic.List[string]
function Assert-Registered($Path){}
function Get-Repositories{ return $script:Registered.ToArray() }
function Add-Repository([string]$Path){ $full=[IO.Path]::GetFullPath($Path).TrimEnd('\'); if(-not $script:Registered.Contains($full)){$script:Registered.Add($full)}; return $full }
function Run-Git([string]$Path,[string[]]$Arguments){$r=Invoke-GitCapture $Path $Arguments;if($r.Code -ne 0){throw "git $($Arguments -join ' '): $($r.Output)"}}

$base=Join-Path $root ('output\ticket-ws-test-'+[guid]::NewGuid().ToString('N'))
try{
    $remote=Join-Path $base 'remote.git';$repo=Join-Path $base 'billing'
    [void](New-Item -ItemType Directory -Force -Path $base)
    Run-Git $base @('init','-q','--bare','-b','main',$remote);Run-Git $base @('clone','-q',$remote,$repo)
    Run-Git $repo @('config','user.email','t@example.test');Run-Git $repo @('config','user.name','T')
    [IO.File]::WriteAllText((Join-Path $repo 'a.txt'),"1`n");Run-Git $repo @('add','.');Run-Git $repo @('commit','-qm','first');Run-Git $repo @('push','-q','origin','main')
    Run-Git $repo @('switch','-qc','develop');[IO.File]::WriteAllText((Join-Path $repo 'a.txt'),"dev`n");Run-Git $repo @('commit','-qam','develop work');Run-Git $repo @('push','-q','-u','origin','develop');Run-Git $repo @('switch','-q','main')
    [void](Add-Repository $repo)

    # New worktree next to the repository, from origin/develop, registered; the main folder stays on main.
    $made=New-GitDeckTicketWorkspace $repo 'pay-12' ''
    $expected=Join-Path $base 'billing.worktrees\PAY-12'
    if(-not $made.created -or $made.path -ne $expected -or $made.branch -ne 'feature/PAY-12'){throw "Created: $($made|ConvertTo-Json -Compress)"}
    if(([IO.File]::ReadAllText((Join-Path $expected 'a.txt'))).Trim() -ne 'dev'){throw 'Worktree did not start from origin/develop'}
    if(([string](Invoke-GitCapture $repo @('branch','--show-current')).Output).Trim() -ne 'main'){throw 'Main folder changed branch'}
    if(-not $script:Registered.Contains($expected)){throw 'Worktree not registered'}
    if((Invoke-GitCapture $expected @('rev-parse','--abbrev-ref','@{upstream}')).Code -eq 0){throw 'New ticket branch tracks origin/develop'}
    # Asking again reuses it.
    if((New-GitDeckTicketWorkspace $repo 'PAY-12' '').created){throw 'Existing worktree created twice'}
    # List: main repository, ticket key, changes.
    [IO.File]::WriteAllText((Join-Path $expected 'b.txt'),"new`n")
    $list=@(Get-GitDeckTicketWorkspaces)
    if($list.Count -ne 1 -or $list[0].key -ne 'PAY-12' -or $list[0].mainName -ne 'billing' -or $list[0].changes -ne 1){throw "Workspaces: $($list|ConvertTo-Json -Compress)"}
    # An existing remote ticket branch is tracked instead of created from develop.
    Run-Git $repo @('push','-q','origin','main:feature/PAY-13')
    $tracked=New-GitDeckTicketWorkspace $repo 'PAY-13' ''
    if(([string](Invoke-GitCapture $tracked.path @('rev-parse','--abbrev-ref','@{upstream}')).Output).Trim() -ne 'origin/feature/PAY-13'){throw 'Remote ticket branch not tracked'}
    foreach($bad in @('PAY','pay 1','../X-1')){$refused=$false;try{[void](New-GitDeckTicketWorkspace $repo $bad '')}catch{$refused=$true};if(-not $refused){throw "Bad key accepted: $bad"}}
    $refused=$false;try{[void](Start-GitDeckAgent $expected 'no-such-agent' '')}catch{$refused=$true};if(-not $refused){throw 'Unknown agent started'}
    Write-Host 'PASS: ticket workspaces (worktree beside the repository from origin/develop, reuse, remote branch tracked, list with key/main/changes, guards)'
}finally{
    if(Test-Path -LiteralPath $base){Remove-Item -LiteralPath $base -Recurse -Force}
}
