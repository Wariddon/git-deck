$ErrorActionPreference='Stop'
# Opening a repository asks Git its questions together (Invoke-GitBatch): every answer must be the same as
# asking one by one, including quotes, spaces, non-ASCII text, a failing command and the ahead/behind lists.
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\git-dashboard-server.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Server syntax errors'}
foreach($definition in $ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst]},$false)){. ([scriptblock]::Create($definition.Extent.Text))}
foreach($library in @('GitDeck.MultiRepo.ps1','GitDeck.Pull.ps1')){
    $libraryAst=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot "..\lib\$library"),[ref]$tokens,[ref]$errors)
    foreach($definition in $libraryAst.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst]},$false)){. ([scriptblock]::Create($definition.Extent.Text))}
}
function Assert-Registered($Path) {}
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
function Expect($Actual,$Wanted,[string]$Label){if([string]$Actual -ne [string]$Wanted){throw "$Label`: got [$Actual], wanted [$Wanted]"}}

Expect (ConvertTo-GitDeckCommandArgument 'plain') 'plain' 'plain argument'
Expect (ConvertTo-GitDeckCommandArgument '%h %s') '"%h %s"' 'argument with a space'
Expect (ConvertTo-GitDeckCommandArgument 'say "hi"') '"say \"hi\""' 'argument with quotes'
Expect (ConvertTo-GitDeckCommandArgument 'C:\a b\') '"C:\a b\\"' 'trailing backslash'
Expect (ConvertTo-GitDeckCommandArgument '') '""' 'empty argument'

$base=Join-Path ([IO.Path]::GetTempPath()) ('gitdeck-batch-'+[guid]::NewGuid().ToString('N'))
try{
    $ErrorActionPreference='Continue'
    $origin=Join-Path $base 'origin.git';$repo=Join-Path $base 'my repo'
    & git init -q --bare $origin
    & git clone -q $origin $repo 2>$null
    & git -C $repo config user.name 'Tester "Q"'; & git -C $repo config user.email 't@example.com'
    [IO.File]::WriteAllText((Join-Path $repo 'a.txt'),'one')
    & git -C $repo add -A; & git -C $repo commit -qm 'first'; & git -C $repo push -q origin HEAD 2>$null
    & git -C $repo branch -q side
    $subject='fix "quoted" ' + [char]0x0E17 + [char]0x0E14 + ' and spaces'
    [IO.File]::WriteAllText((Join-Path $repo 'a.txt'),'two')
    # From a file: Windows PowerShell 5.1 drops the quotes of a native argument.
    $messageFile=Join-Path $base 'message.txt';[IO.File]::WriteAllText($messageFile,$subject,(New-Object Text.UTF8Encoding($false)))
    & git -C $repo commit -qa -F $messageFile
    & git -C $repo tag v1
    [IO.File]::WriteAllText((Join-Path $repo 'new file.txt'),'x')
    & git -C $repo switch -q side; & git -C $repo switch -q -

    $ErrorActionPreference='Stop'
    $batch=Invoke-GitBatch $repo ([ordered]@{subject=@('log','-1','--format=%s');missing=@('rev-parse','--verify','no-such-ref');spaced=@('log','-1','--format=%h %s')})
    Expect $batch.subject.Code 0 'exit code'
    Expect $batch.subject.Output $subject 'quotes, spaces and Thai come back intact'
    if($batch.missing.Code -eq 0 -or -not $batch.missing.Output){throw 'A failing command reports its code and error text'}
    if($batch.spaced.Output -notmatch ' fix "quoted"'){throw "A format with a space: $($batch.spaced.Output)"}

    $workspace=Get-WorkspaceDetails $repo $false
    $branch=$workspace.branch
    if(-not $branch){throw 'No branch'}
    Expect $workspace.previousBranch 'side' 'previous branch'
    Expect $workspace.sync.ahead 1 'ahead'
    if(@($workspace.sync.outgoing).Count -ne 1 -or $workspace.sync.outgoing[0] -notlike "*$subject"){throw "Outgoing: $($workspace.sync.outgoing)"}
    Expect @($workspace.sync.incoming).Count 0 'incoming'
    Expect $workspace.headMessage $subject 'head message'
    Expect @($workspace.history).Count 2 'history'
    Expect $workspace.history[0].subject $subject 'history subject'
    Expect (@($workspace.files | Where-Object { $_.path -eq 'new file.txt' }).Count) 1 'untracked file with a space'
    Expect (@($workspace.tags) -join ',') 'v1' 'tags'
    Expect (@($workspace.remotes | ForEach-Object { $_.name }) -join ',') 'origin' 'remotes'
    Expect (@($workspace.remoteBranches).Count) 1 'remote branches'
    Expect (@($workspace.branches).Count) 2 'branches'
    Write-Output 'PASS: Git questions asked together (quoting, Thai text, failures, same workspace as one by one)'
}finally{Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue}
