$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Server parse failed'}
foreach($name in @('Invoke-GitCapture','Invoke-GitOrThrow','Convert-LogLines')){
    $fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)[0]
    if(-not $fn){throw "Missing server function $name"}
    $definition=$fn.Extent.Text
    if($name -eq 'Invoke-GitCapture'){$definition=$definition.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))}
    . ([scriptblock]::Create($definition))
}
. (Join-Path $root 'lib\GitDeck.MultiRepo.ps1')
. (Join-Path $root 'lib\GitDeck.Fleet.ps1')
function Assert-Registered($Path){}
function Run-Git([string]$Path,[string[]]$Arguments){[void](Invoke-GitOrThrow $Path $Arguments)}
function Write-Text([string]$File,[string]$Text){[IO.File]::WriteAllText($File,$Text)}

$base=Join-Path $root ('output\fleet-test-'+[guid]::NewGuid().ToString('N'))
try{
    [void](New-Item -ItemType Directory -Path $base)
    $remote=Join-Path $base 'remote.git';$local=Join-Path $base 'local'
    Run-Git $base @('init','-q','--bare','-b','main',$remote)
    Run-Git $base @('clone','-q','-c','core.autocrlf=false',$remote,$local)
    Run-Git $local @('config','user.email','t@example.test');Run-Git $local @('config','user.name','Test')
    Write-Text (Join-Path $local 'pom.xml') "<project><version>1</version></project>`n";Run-Git $local @('add','.');Run-Git $local @('commit','-qm','AP-7 first')
    Run-Git $local @('push','-q','-u','origin','main')
    Run-Git $local @('tag','-a','v1.0.0','-m','release')
    # A pushed ticket commit (in tag v1.0.0) and an unpushed one on a local ticket branch.
    Run-Git $local @('switch','-qc','feature/AP-7-login');Write-Text (Join-Path $local 'b.txt') "two`n";Run-Git $local @('add','.');Run-Git $local @('commit','-qm','AP-7 login form')

    # Ticket: branches, commits (pushed or not) and the tags that contain the newest commit.
    $ticket=Get-GitDeckTicket $local 'AP-7'
    if(@($ticket.branches).Count -ne 1 -or $ticket.branches[0].name -ne 'feature/AP-7-login' -or $ticket.branches[0].remote){throw 'Ticket branch not found'}
    if(@($ticket.commits).Count -ne 2){throw "Ticket commits: $(@($ticket.commits).Count)"}
    $unpushed=@($ticket.commits|Where-Object{-not $_.pushed})
    if($unpushed.Count -ne 1 -or $unpushed[0].subject -ne 'AP-7 login form'){throw 'Unpushed ticket commit not marked'}
    if($ticket.current -ne 'feature/AP-7-login'){throw 'Current branch missing'}
    $none=Get-GitDeckTicket $local 'ZZ-1';if(@($none.commits).Count -or @($none.branches).Count){throw 'Unrelated key matched'}
    $bad=$false;try{[void](Get-GitDeckTicket $local '-p')}catch{$bad=$true};if(-not $bad){throw 'Unsafe key accepted'}

    # Files: working tree, a ref, missing files, and paths outside the repository are refused.
    $file=Get-GitDeckRepoFile $local 'pom.xml' ''
    if(-not $file.exists -or $file.content -notmatch '<version>1</version>'){throw 'Working tree file not read'}
    Write-Text (Join-Path $local 'pom.xml') "<project><version>2</version></project>`n"
    $atMain=Get-GitDeckRepoFile $local 'pom.xml' 'main'
    if(-not $atMain.exists -or $atMain.content -notmatch '<version>1</version>'){throw 'File at ref not read'}
    if((Get-GitDeckRepoFile $local 'nope.txt' '').exists){throw 'Missing file reported as present'}
    foreach($unsafe in @('../secret.txt','C:/Windows/win.ini','-x','a/../../b')){$refused=$false;try{[void](Get-GitDeckRepoFile $local $unsafe '')}catch{$refused=$true};if(-not $refused){throw "Unsafe path accepted: $unsafe"}}
    $refused=$false;try{[void](Get-GitDeckRepoFile $local 'pom.xml' '--output=x')}catch{$refused=$true};if(-not $refused){throw 'Unsafe ref accepted'}
    $found=@(Find-GitDeckRepoFiles $local 'pom');if($found -notcontains 'pom.xml'){throw 'File search failed'}
    Write-Host 'PASS: ticket view, file reading for compare, unsafe input refused'
}finally{
    if(Test-Path -LiteralPath $base){Remove-Item -LiteralPath $base -Recurse -Force}
}
